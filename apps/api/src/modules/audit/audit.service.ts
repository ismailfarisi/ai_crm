import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { EventOutboxService } from '@/common/events/event-outbox.service';
import {
  Brackets,
  DataSource,
  EntityManager,
  Repository,
  type EntityTarget,
  type ObjectLiteral,
} from 'typeorm';
import {
  changedFields,
  redactForAudit,
  type AuditChannel,
  type AuditLogDto,
  type AuditOrigin,
  type AuditPageDto,
  type AuditQueryPayload,
} from '@saas/shared';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditRecordInput {
  tenantId: string;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  summary?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  origin?: AuditOrigin;
  channel?: AuditChannel;
  messageId?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  confidence?: number | null;
}

/** Outbox kind for audit rows whose first insert failed. */
export const AUDIT_OUTBOX_KIND = 'audit';

/** Never copied into a snapshot: ciphertext and credentials have no business in the trail. */
export const AUDIT_REDACTED_COLUMNS = new Set(['ibanEncrypted', 'passwordHash']);

interface QueuedAuditRow {
  row: Record<string, unknown> & { id: string };
  /** When the change happened, so a late retry is still filed in order. */
  occurredAt: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
    private readonly dataSource: DataSource,
    @Optional() private readonly outbox?: EventOutboxService,
  ) {
    this.outbox?.registerHandler(AUDIT_OUTBOX_KIND, (message) =>
      this.replay(message.payload as QueuedAuditRow),
    );
  }

  /**
   * Writes one row. Never throws.
   *
   * An audit failure must not fail the request that caused it: the change has
   * already happened, and turning a logging problem into a 500 would tell the
   * user their invoice was not issued when it was.
   *
   * A failed insert is not dropped: the row is queued in the outbox and the
   * dispatcher retries it, with the same id (so a retry after an insert that
   * did land is a no-op) and the original time. Only if the outbox cannot be
   * written either — the database is unreachable — is the row lost, loudly.
   */
  async record(input: AuditRecordInput): Promise<void> {
    let row: QueuedAuditRow['row'] | undefined;
    const occurredAt = new Date().toISOString();
    try {
      const before = (redactForAudit(input.before ?? null) ?? null) as Record<
        string,
        unknown
      > | null;
      const after = (redactForAudit(input.after ?? null) ?? null) as Record<
        string,
        unknown
      > | null;
      const fields = changedFields(before, after);
      row = {
        // Chosen here rather than by the database so a retry can be
        // idempotent.
        id: randomUUID(),
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        action: input.action.slice(0, 80),
        subjectType: input.subjectType.slice(0, 40),
        subjectId: input.subjectId ?? null,
        summary: input.summary?.slice(0, 200) ?? null,
        changedFields: fields.length ? fields : null,
        before: before as never,
        after: after as never,
        ip: input.ip?.slice(0, 64) ?? null,
        origin: input.origin ?? 'HUMAN',
        originChannel: input.channel ?? 'WEB',
        originMessageId: input.messageId ?? null,
        model: input.model ?? null,
        promptVersion: input.promptVersion ?? null,
        confidence: input.confidence ?? null,
      };
      // `insert` types jsonb columns as deep-partial, which a free-form
      // record does not satisfy; the shape is checked by `redactForAudit`.
      await this.logs.insert(row as never);
    } catch (error) {
      await this.queueForRetry(input, row, occurredAt, error);
    }
  }

  private async queueForRetry(
    input: AuditRecordInput,
    row: QueuedAuditRow['row'] | undefined,
    occurredAt: string,
    error: unknown,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    if (row && this.outbox) {
      try {
        await this.outbox.enqueue({
          tenantId: input.tenantId,
          kind: AUDIT_OUTBOX_KIND,
          eventType: row.action as string,
          payload: { row, occurredAt } satisfies QueuedAuditRow,
        });
        this.logger.warn(
          `Audit row for ${input.action} on ${input.subjectType} queued for retry: ${reason}`,
        );
        return;
      } catch (queueError) {
        this.logger.error(
          `Audit retry queue unavailable: ${
            queueError instanceof Error ? queueError.message : String(queueError)
          }`,
        );
      }
    }
    this.logger.error(
      `Audit row dropped for ${input.action} on ${input.subjectType}: ${reason}`,
    );
  }

  /** Outbox handler: re-inserts a queued row. Throws so the outbox retries. */
  private async replay(queued: QueuedAuditRow): Promise<void> {
    await this.logs
      .createQueryBuilder()
      .insert()
      .into(AuditLog)
      .values({
        ...queued.row,
        createdAt: new Date(queued.occurredAt),
      } as never)
      .orIgnore()
      .execute();
  }

  /**
   * The id of a tenant's only row of a one-per-tenant entity, or null when it
   * has none yet. Never throws: like `snapshot`, a miss just means no `before`.
   */
  async singletonId(
    entity: EntityTarget<ObjectLiteral>,
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string | null> {
    try {
      const row: ObjectLiteral | null = await manager
        .getRepository(entity)
        .findOne({ where: { tenantId } });
      return typeof row?.id === 'string' ? row.id : null;
    } catch {
      return null;
    }
  }

  /**
   * Photographs a record by id, flattened for storage.
   *
   * Relations are not loaded. A quote's line items would multiply the size of
   * every row for a diff nobody reads at that level, and the lines carry their
   * own audit entries when they are edited through their own routes.
   */
  async snapshot(
    entity: EntityTarget<ObjectLiteral>,
    tenantId: string,
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Record<string, unknown> | null> {
    try {
      const repo = manager.getRepository(entity);
      const meta = repo.metadata;
      const tenantColumn = ['tenantId', 'organizationId'].find((name) =>
        meta.columns.some((c) => c.propertyName === name),
      );
      const row = await repo.findOne({
        where: {
          id,
          ...(tenantColumn ? { [tenantColumn]: tenantId } : {}),
        },
        withDeleted: true,
      });
      if (!row) return null;
      // Flattened to columns only: relations would multiply the size of every
      // row for a diff nobody reads at that level.
      const record = row as Record<string, unknown>;
      const flat: Record<string, unknown> = {};
      for (const column of meta.columns) {
        if (AUDIT_REDACTED_COLUMNS.has(column.propertyName)) continue;
        const value = record[column.propertyName];
        if (value !== undefined) flat[column.propertyName] = value;
      }
      return flat;
    } catch {
      // A snapshot is a nicety. Losing it must not cost the audit row.
      return null;
    }
  }

  async list(
    tenantId: string,
    query: AuditQueryPayload,
  ): Promise<AuditPageDto> {
    const qb = this.logs
      .createQueryBuilder('log')
      .where('log.tenant_id = :tenantId', { tenantId })
      .orderBy('log.created_at', 'DESC')
      .take(query.limit)
      .skip(query.offset);

    if (query.subjectType)
      qb.andWhere('log.subject_type = :subjectType', {
        subjectType: query.subjectType,
      });
    if (query.subjectId)
      qb.andWhere('log.subject_id = :subjectId', {
        subjectId: query.subjectId,
      });
    if (query.actorId)
      qb.andWhere('log.actor_id = :actorId', { actorId: query.actorId });
    if (query.action)
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('log.action = :action', { action: query.action })
            .orWhere('log.action LIKE :prefix', {
              prefix: `${query.action}%`,
            }),
        ),
      );
    if (query.origin)
      qb.andWhere('log.origin = :origin', { origin: query.origin });
    if (query.from)
      qb.andWhere('log.created_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('log.created_at <= :to', { to: query.to });

    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toDto), total };
  }

  /** The trail for one record, oldest last — what the drawer on a page shows. */
  async forSubject(
    tenantId: string,
    subjectType: string,
    subjectId: string,
    limit = 50,
  ): Promise<AuditLogDto[]> {
    const rows = await this.logs.find({
      where: { tenantId, subjectType, subjectId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map(toDto);
  }
}

function toDto(row: AuditLog): AuditLogDto {
  return {
    id: row.id,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    summary: row.summary,
    actorId: row.actorId,
    actorName: row.actorName,
    ip: row.ip,
    changedFields: row.changedFields ?? [],
    before: row.before,
    after: row.after,
    origin: row.origin,
    channel: row.originChannel,
    messageId: row.originMessageId,
    model: row.model,
    promptVersion: row.promptVersion,
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString(),
  };
}
