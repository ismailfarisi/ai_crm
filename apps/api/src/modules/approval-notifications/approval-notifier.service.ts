import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import {
  DEFAULT_APPROVAL_REMINDER_MINUTES,
  type Permission,
} from '@saas/shared';
import type { ApprovalItemType } from './entities/approval-request.entity';

/** Outbox kind for approval notices; delivered by the API only. */
export const APPROVAL_NOTICE_OUTBOX_KIND = 'approval_notice';

export type ApprovalNoticeEventType =
  'approval.requested' | 'approval.reminder' | 'approval.decided';

export interface ApprovalNoticePayload {
  requestId: string;
}

export interface ApprovalRequestInput {
  tenantId: string;
  itemType: ApprovalItemType;
  itemId: string;
  requestedByUserId?: string | null;
  /** Every one is required to decide. Empty: only `recipientUserId`. */
  permissions: Permission[];
  recipientUserId?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
  meta?: Record<string, unknown> | null;
  /** False: no notice now, only the reminder. */
  notifyNow?: boolean;
  expiresAt?: Date | string | null;
  /** Overrides the organisation's reminder delay. */
  remindAfterMinutes?: number | null;
}

export interface ApprovalDecisionInput {
  tenantId: string;
  itemType: ApprovalItemType;
  itemId: string;
  outcome: 'APPROVED' | 'REJECTED';
  decidedByUserId?: string | null;
  comment?: string | null;
}

const OUTBOX_INSERT = `INSERT INTO "crm_event_outbox" ("id", "tenant_id", "kind", "event_type", "payload") VALUES ($1, $2, $3, $4, $5::jsonb)`;

/**
 * The reminder is due after the organisation's delay, or at three quarters
 * of the way to the item's timeout when that comes first, so an automation
 * step is always reminded about before it expires.
 */
const REQUEST_INSERT = `
INSERT INTO "approval_requests"
  ("tenant_id", "item_type", "item_id", "requested_by_user_id", "permissions",
   "recipient_user_id", "title", "body", "link", "meta", "notify_now",
   "requested_at", "expires_at", "remind_at")
SELECT $1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10::jsonb, $11,
       now(), $12::timestamptz,
       LEAST(
         now() + make_interval(mins => COALESCE(
           $13::int,
           (SELECT np."reminder_delay_minutes" FROM "notification_preferences" np
             WHERE np."tenant_id" = $1 AND np."user_id" IS NULL),
           $14::int)),
         now() + ($12::timestamptz - now()) * 0.75)
ON CONFLICT ("tenant_id", "item_type", "item_id") WHERE status = 'PENDING' DO NOTHING
RETURNING "id"`;

const REQUEST_DECIDE = `
UPDATE "approval_requests"
   SET "status" = $4, "decided_by_user_id" = $5, "decided_at" = now(), "comment" = $6
 WHERE "tenant_id" = $1 AND "item_type" = $2 AND "item_id" = $3 AND "status" = 'PENDING'
RETURNING "id"`;

const REQUEST_CLOSE = `
UPDATE "approval_requests" SET "status" = 'CLOSED', "decided_at" = now()
 WHERE "tenant_id" = $1 AND "item_type" = $2 AND "item_id" = $3 AND "status" = 'PENDING'`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Records that something is waiting for a decision (or got one) and queues
 * the notice in the outbox, in the caller's transaction when given one, so
 * the notice commits with the change and is redelivered until it is sent.
 *
 * Never throws: a notice is not worth failing the approval it is about.
 * Inside a transaction the writes run under a savepoint, so a failure here
 * does not poison the caller's transaction either.
 *
 * Plain SQL with no Nest dependencies beyond the data source, so the
 * Temporal worker can use it from an activity.
 */
@Injectable()
export class ApprovalNotifierService {
  private readonly logger = new Logger(ApprovalNotifierService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async requested(
    input: ApprovalRequestInput,
    manager?: EntityManager,
  ): Promise<string | null> {
    return this.guarded(manager, 'request', async (m) => {
      const rows: Array<{ id: string }> = await m.query(REQUEST_INSERT, [
        input.tenantId,
        input.itemType,
        input.itemId,
        input.requestedByUserId ?? null,
        input.permissions,
        input.recipientUserId ?? null,
        input.title.slice(0, 200),
        input.body ?? null,
        input.link?.slice(0, 300) ?? null,
        JSON.stringify(input.meta ?? null),
        input.notifyNow ?? true,
        input.expiresAt ?? null,
        input.remindAfterMinutes ?? null,
        DEFAULT_APPROVAL_REMINDER_MINUTES,
      ]);
      const id = rows[0]?.id ?? null;
      // Already pending (a redelivered activity): its notice is queued.
      if (id) await this.enqueue(m, input.tenantId, 'approval.requested', id);
      return id;
    });
  }

  async decided(
    input: ApprovalDecisionInput,
    manager?: EntityManager,
  ): Promise<void> {
    await this.guarded(manager, 'decision', async (m) => {
      const result: unknown = await m.query(REQUEST_DECIDE, [
        input.tenantId,
        input.itemType,
        input.itemId,
        input.outcome,
        input.decidedByUserId ?? null,
        input.comment ?? null,
      ]);
      for (const row of returnedRows(result)) {
        await this.enqueue(m, input.tenantId, 'approval.decided', row.id);
      }
      return null;
    });
  }

  /** Expired, cancelled or withdrawn: stop reminding, tell nobody. */
  async closed(
    tenantId: string,
    itemType: ApprovalItemType,
    itemId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.guarded(manager, 'close', async (m) => {
      await m.query(REQUEST_CLOSE, [tenantId, itemType, itemId]);
      return null;
    });
  }

  private async enqueue(
    m: EntityManager,
    tenantId: string,
    eventType: ApprovalNoticeEventType,
    requestId: string,
  ): Promise<void> {
    const payload: ApprovalNoticePayload = { requestId };
    await m.query(OUTBOX_INSERT, [
      randomUUID(),
      tenantId,
      APPROVAL_NOTICE_OUTBOX_KIND,
      eventType,
      JSON.stringify(payload),
    ]);
  }

  private async guarded<T>(
    manager: EntityManager | undefined,
    what: string,
    fn: (m: EntityManager) => Promise<T>,
  ): Promise<T | null> {
    try {
      if (!manager) return await this.dataSource.transaction(fn);
      const savepoint = `approval_notice_${randomUUID().replace(/-/g, '')}`;
      await manager.query(`SAVEPOINT ${savepoint}`);
      try {
        const out = await fn(manager);
        await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
        return out;
      } catch (err) {
        await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw err;
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Approval notice ${what} not recorded: ${errorMessage(err)}`,
      );
      return null;
    }
  }
}

/** pg returns `[rows, count]` for UPDATE … RETURNING through TypeORM. */
function returnedRows(result: unknown): Array<{ id: string }> {
  if (!Array.isArray(result)) return [];
  if (Array.isArray(result[0])) return result[0] as Array<{ id: string }>;
  return result as Array<{ id: string }>;
}
