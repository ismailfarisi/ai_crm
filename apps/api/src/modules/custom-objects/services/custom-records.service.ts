import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PERMISSIONS } from '@saas/shared';
import { CrmEventBusService } from '@/common/events';
import { CustomRecord } from '../entities/custom-record.entity';
import type { CustomObjectDefinition } from '../entities/custom-object-definition.entity';
import { CustomObjectsService } from './custom-objects.service';
import { RecordValidationService } from './record-validation.service';

const isEmptyUniqueValue = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/** Strings: trimmed, lower-cased. Anything else: its JSON text. */
const normalizeUniqueValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value);

/**
 * `manager.query` on Postgres returns `[rows, rowCount]` for UPDATE/DELETE and
 * plain `rows` otherwise; accept either.
 */
const firstReturnedRow = (result: any): any => {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0][0];
  return Array.isArray(result) ? result[0] : undefined;
};

@Injectable()
export class CustomRecordsService {
  constructor(
    @InjectRepository(CustomRecord)
    private readonly recordRepo: Repository<CustomRecord>,
    private readonly objectsService: CustomObjectsService,
    private readonly validationService: RecordValidationService,
    private readonly eventBus: CrmEventBusService,
  ) {}

  async list(tenantId: string, slug: string, params: any, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const qb = this.recordRepo.createQueryBuilder('r')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.objectId = :objectId', { objectId: object.id });

    // Ownership scoping
    const canReadAll = actor.permissions?.includes(PERMISSIONS.CUSTOM_RECORD_READ_ALL);
    if (!canReadAll) {
      qb.andWhere('(r.ownerId = :userId OR r.ownerId IS NULL)', { userId: actor.id });
    }

    // JSONB Search
    if (params?.search?.trim()) {
      const s = `%${params.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `LOWER(r.values->>:primaryAttributeSlug) LIKE :search`,
        { primaryAttributeSlug: object.primaryAttributeSlug, search: s },
      );
    }

    // JSONB Field Filters
    if (params?.filters && typeof params.filters === 'object') {
      for (const [index, [key, val]] of Object.entries(params.filters).entries()) {
        const parameter = `filter_${index}`;
        qb.andWhere(`r.values @> :${parameter}`, {
          [parameter]: JSON.stringify({ [key]: val }),
        });
      }
    }

    const page = Math.max(1, Number(params?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params?.limit) || 25));
    qb.skip((page - 1) * limit).take(limit).orderBy('r.createdAt', 'DESC');

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit, object };
  }

  async getById(tenantId: string, slug: string, id: string, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const record = await this.recordRepo.findOne({
      where: { id, tenantId, objectId: object.id },
    });
    if (!record) throw new NotFoundException(`Record '${id}' not found`);
    this.assertCanAccess(record, actor);
    return record;
  }

  private assertCanAccess(record: CustomRecord, actor: any): void {
    const canReadAll = actor.permissions?.includes(PERMISSIONS.CUSTOM_RECORD_READ_ALL);
    if (!canReadAll && record.ownerId && record.ownerId !== actor.id) {
      throw new ForbiddenException('You do not have permission to view this record');
    }
  }

  /**
   * Enforces `isUnique` attributes. A unique index cannot be declared over a
   * dynamic jsonb key, so for each unique attribute being written we take a
   * transaction-scoped advisory lock on (tenant, object, attribute, normalized
   * value) — two writers of the same value serialise here — and then look for
   * another live record holding it. The lock is released at commit, by which
   * point our row is visible to the next writer's check. Locks are taken in
   * slug order so two multi-attribute writers cannot deadlock.
   */
  private async assertUniqueValues(
    manager: EntityManager,
    tenantId: string,
    object: CustomObjectDefinition,
    values: Record<string, any>,
    excludeRecordId: string | null,
  ): Promise<void> {
    const uniqueAttrs = (object.attributes ?? [])
      .filter((attr) => attr.isUnique && !isEmptyUniqueValue(values[attr.slug]))
      .sort((a, b) => a.slug.localeCompare(b.slug));

    for (const attr of uniqueAttrs) {
      const value = values[attr.slug];
      const normalized = normalizeUniqueValue(value);
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `custom_record_unique:${tenantId}:${object.id}:${attr.slug}:${normalized}`,
      ]);

      // Strings compare trimmed and case-insensitively; everything else as jsonb.
      const comparison =
        typeof value === 'string'
          ? `lower(btrim("values" ->> $4)) = $5`
          : `("values" -> $4) = $5::jsonb`;
      const clash: unknown[] = await manager.query(
        `SELECT "id" FROM "custom_records" WHERE "tenant_id" = $1 AND "object_id" = $2 ` +
          `AND "deletedAt" IS NULL AND ($3::uuid IS NULL OR "id" <> $3::uuid) AND ${comparison} LIMIT 1`,
        [tenantId, object.id, excludeRecordId, attr.slug, normalized],
      );
      if (clash?.length) {
        throw new ConflictException(
          `Another ${object.singularName ?? 'record'} already has this ${attr.name ?? attr.slug}`,
        );
      }
    }
  }

  async create(tenantId: string, slug: string, payload: any, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const validatedValues = this.validationService.validate(object.attributes ?? [], payload?.values ?? {});

    const saved = await this.recordRepo.manager.transaction(async (manager) => {
      await this.assertUniqueValues(manager, tenantId, object, validatedValues, null);

      const repo = manager.getRepository(CustomRecord);
      const record = repo.create({
        tenantId,
        objectId: object.id,
        ownerId: payload?.ownerId ?? actor.id,
        values: validatedValues,
      });
      return repo.save(record);
    });

    await this.eventBus.publish({
      tenantId,
      eventType: 'record.created',
      entityType: 'custom_object',
      entityName: slug,
      entityId: saved.id,
      actorUserId: actor?.id ?? null,
      timestamp: new Date().toISOString(),
      snapshot: {
        before: null,
        after: saved.values,
        changedFields: Object.keys(saved.values ?? {}),
      },
    });

    return saved;
  }

  async update(tenantId: string, slug: string, id: string, payload: any, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const patchInput: Record<string, any> = payload?.values ?? {};
    const ownerChanging = payload?.ownerId !== undefined;

    const { saved, beforeValues, originalOwnerId } = await this.recordRepo.manager.transaction(
      async (manager) => {
        // Row lock: the merged state we validate (required fields, strict
        // keys) and photograph for the event is the state we write over.
        const record = await manager.getRepository(CustomRecord).findOne({
          where: { id, tenantId, objectId: object.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!record) throw new NotFoundException(`Record '${id}' not found`);
        this.assertCanAccess(record, actor);

        const beforeValues = { ...(record.values ?? {}) };
        const originalOwnerId = record.ownerId;
        const validated = this.validationService.validate(object.attributes ?? [], {
          ...beforeValues,
          ...patchInput,
        });

        // Only the keys the caller sent are written; null clears a key.
        const set: Record<string, any> = {};
        const remove: string[] = [];
        for (const key of Object.keys(patchInput)) {
          const value = key in validated ? validated[key] : null;
          if (value === null || value === undefined) remove.push(key);
          else set[key] = value;
        }

        await this.assertUniqueValues(manager, tenantId, object, set, record.id);

        // Atomic jsonb merge: a concurrent edit to a different key survives
        // even if it slipped past the row lock (e.g. a raw SQL writer).
        const params: unknown[] = [JSON.stringify(set), remove, record.id, tenantId];
        let ownerSql = '';
        if (ownerChanging) {
          params.push(payload.ownerId ?? null);
          ownerSql = `, "owner_id" = $${params.length}::uuid`;
        }
        const result = await manager.query(
          `UPDATE "custom_records" SET "values" = ("values" || $1::jsonb) - $2::text[]${ownerSql}, ` +
            `"updatedAt" = now() WHERE "id" = $3 AND "tenant_id" = $4 AND "deletedAt" IS NULL ` +
            `RETURNING "values", "owner_id", "updatedAt"`,
          params,
        );
        const row = firstReturnedRow(result);
        if (!row) throw new NotFoundException(`Record '${id}' not found`);

        record.values = row.values ?? {};
        record.ownerId = row.owner_id ?? null;
        if (row.updatedAt) record.updatedAt = row.updatedAt;
        return { saved: record, beforeValues, originalOwnerId };
      },
    );

    const changedFields = this.eventBus.computeChangedFields(beforeValues, saved.values);

    const beforeSnapshot: any = { ...beforeValues };
    const afterSnapshot: any = { ...saved.values };

    if (payload?.ownerId !== undefined && payload.ownerId !== originalOwnerId) {
      if (!changedFields.includes('ownerId')) {
        changedFields.push('ownerId');
      }
      beforeSnapshot.ownerId = originalOwnerId;
      afterSnapshot.ownerId = payload.ownerId;
    }

    await this.eventBus.publish({
      tenantId,
      eventType: 'record.updated',
      entityType: 'custom_object',
      entityName: slug,
      entityId: saved.id,
      actorUserId: actor?.id ?? null,
      timestamp: new Date().toISOString(),
      snapshot: {
        before: beforeSnapshot,
        after: afterSnapshot,
        changedFields: changedFields.sort(),
      },
    });

    return saved;
  }

  async delete(tenantId: string, slug: string, id: string, actor: any) {
    const record = await this.getById(tenantId, slug, id, actor);
    await this.recordRepo.manager.transaction(async (manager) => {
      await manager.getRepository(CustomRecord).softDelete({ id, tenantId });
      // A soft delete does not fire the FK cascade, and links that point AT
      // this record have no FK at all — remove both directions together.
      await manager.query(
        `DELETE FROM "custom_record_links" WHERE "tenant_id" = $1 AND ("source_record_id" = $2 ` +
          `OR ("target_type" = 'custom_object' AND "target_record_id" = $2))`,
        [tenantId, id],
      );
    });

    await this.eventBus.publish({
      tenantId,
      eventType: 'record.deleted',
      entityType: 'custom_object',
      entityName: slug,
      entityId: id,
      actorUserId: actor?.id ?? null,
      timestamp: new Date().toISOString(),
      snapshot: {
        before: record.values,
        after: null,
        changedFields: Object.keys(record.values ?? {}),
      },
    });
  }
}
