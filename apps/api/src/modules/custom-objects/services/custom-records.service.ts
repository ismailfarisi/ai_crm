import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS } from '@saas/shared';
import { CrmEventBusService } from '@/common/events';
import { CustomRecord } from '../entities/custom-record.entity';
import { CustomObjectsService } from './custom-objects.service';
import { RecordValidationService } from './record-validation.service';

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
      qb.andWhere(`LOWER(r.values->>'${object.primaryAttributeSlug}') LIKE :search`, { search: s });
    }

    // JSONB Field Filters
    if (params?.filters && typeof params.filters === 'object') {
      for (const [key, val] of Object.entries(params.filters)) {
        qb.andWhere(`r.values @> :filter_${key}`, { [`filter_${key}`]: JSON.stringify({ [key]: val }) });
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

    const canReadAll = actor.permissions?.includes(PERMISSIONS.CUSTOM_RECORD_READ_ALL);
    if (!canReadAll && record.ownerId && record.ownerId !== actor.id) {
      throw new ForbiddenException('You do not have permission to view this record');
    }

    return record;
  }

  async create(tenantId: string, slug: string, payload: any, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const validatedValues = this.validationService.validate(object.attributes ?? [], payload?.values ?? {});

    const record = this.recordRepo.create({
      tenantId,
      objectId: object.id,
      ownerId: payload?.ownerId ?? actor.id,
      values: validatedValues,
    });
    const saved = await this.recordRepo.save(record);

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
    const record = await this.getById(tenantId, slug, id, actor);
    const object = await this.objectsService.getBySlug(tenantId, slug);

    const beforeValues = { ...(record.values ?? {}) };
    const originalOwnerId = record.ownerId;
    const merged = { ...record.values, ...(payload?.values ?? {}) };
    const validatedValues = this.validationService.validate(object.attributes ?? [], merged);

    record.values = validatedValues;
    if (payload?.ownerId !== undefined) record.ownerId = payload.ownerId;

    const saved = await this.recordRepo.save(record);
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
    await this.recordRepo.softDelete({ id, tenantId });

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
