import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomObjectDefinition } from '../entities/custom-object-definition.entity';
import { CustomAttributeDefinition } from '../entities/custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from '../entities/custom-relationship-definition.entity';

@Injectable()
export class CustomObjectsService {
  constructor(
    @InjectRepository(CustomObjectDefinition)
    private readonly objectRepo: Repository<CustomObjectDefinition>,
    @InjectRepository(CustomAttributeDefinition)
    private readonly attrRepo: Repository<CustomAttributeDefinition>,
    @InjectRepository(CustomRelationshipDefinition)
    private readonly relRepo: Repository<CustomRelationshipDefinition>,
  ) {}

  async list(tenantId: string): Promise<CustomObjectDefinition[]> {
    return this.objectRepo.find({
      where: { tenantId, isArchived: false },
      relations: ['attributes', 'relationships'] as any,
      order: { name: 'ASC' },
    });
  }

  async getBySlug(tenantId: string, slug: string): Promise<CustomObjectDefinition> {
    const object = await this.objectRepo.findOne({
      where: { tenantId, slug, isArchived: false },
      relations: ['attributes', 'relationships'] as any,
    });
    if (!object) throw new NotFoundException(`Custom object '${slug}' not found`);
    return object;
  }

  async create(tenantId: string, payload: any): Promise<CustomObjectDefinition> {
    const existing = await this.objectRepo.findOne({
      where: { tenantId, slug: payload.slug },
    });
    if (existing) throw new ConflictException(`Object slug '${payload.slug}' already exists`);

    const entity = this.objectRepo.create({ ...payload, tenantId } as Partial<CustomObjectDefinition>);
    return this.objectRepo.save(entity);
  }

  async update(tenantId: string, slug: string, payload: any): Promise<CustomObjectDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    Object.assign(object, payload);
    return this.objectRepo.save(object);
  }

  async archive(tenantId: string, slug: string): Promise<void> {
    const object = await this.getBySlug(tenantId, slug);
    object.isArchived = true;
    await this.objectRepo.save(object);
  }

  async addAttribute(tenantId: string, slug: string, payload: any): Promise<CustomAttributeDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    const existing = await this.attrRepo.findOne({
      where: { objectId: object.id, slug: payload.slug },
    });
    if (existing) throw new ConflictException(`Attribute slug '${payload.slug}' already exists`);

    const attr = this.attrRepo.create({ ...payload, tenantId, objectId: object.id } as Partial<CustomAttributeDefinition>);
    return this.attrRepo.save(attr);
  }

  async updateAttribute(tenantId: string, slug: string, attrSlug: string, payload: any): Promise<CustomAttributeDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    const attr = await this.attrRepo.findOne({
      where: { objectId: object.id, slug: attrSlug },
    });
    if (!attr) throw new NotFoundException(`Attribute '${attrSlug}' not found`);

    Object.assign(attr, payload);
    return this.attrRepo.save(attr);
  }

  async deleteAttribute(tenantId: string, slug: string, attrSlug: string): Promise<void> {
    const object = await this.getBySlug(tenantId, slug);
    await this.attrRepo.softDelete({ objectId: object.id, slug: attrSlug });
  }

  async addRelationship(tenantId: string, slug: string, payload: any): Promise<CustomRelationshipDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    const rel = this.relRepo.create({ ...payload, tenantId, sourceObjectId: object.id } as Partial<CustomRelationshipDefinition>);
    return this.relRepo.save(rel);
  }

  async deleteRelationship(tenantId: string, slug: string, relSlug: string): Promise<void> {
    const object = await this.getBySlug(tenantId, slug);
    await this.relRepo.softDelete({ sourceObjectId: object.id, slug: relSlug });
  }
}
