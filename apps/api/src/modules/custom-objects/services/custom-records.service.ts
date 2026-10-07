import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS } from '@saas/shared';
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
    return this.recordRepo.save(record);
  }

  async update(tenantId: string, slug: string, id: string, payload: any, actor: any) {
    const record = await this.getById(tenantId, slug, id, actor);
    const object = await this.objectsService.getBySlug(tenantId, slug);

    const merged = { ...record.values, ...(payload?.values ?? {}) };
    const validatedValues = this.validationService.validate(object.attributes ?? [], merged);

    record.values = validatedValues;
    if (payload?.ownerId !== undefined) record.ownerId = payload.ownerId;

    return this.recordRepo.save(record);
  }

  async delete(tenantId: string, slug: string, id: string, actor: any) {
    await this.getById(tenantId, slug, id, actor);
    await this.recordRepo.softDelete({ id, tenantId });
  }
}
