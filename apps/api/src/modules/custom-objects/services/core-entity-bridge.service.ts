import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  PERMISSIONS,
  RELATIONSHIP_CORE_ENTITIES,
  type CreateCustomRecordLinkPayload,
  type RelationshipCoreEntity,
} from '@saas/shared';
import { CrmEventBusService } from '@/common/events';
import { CustomRecordLink } from '../entities/custom-record-link.entity';
import { CustomRecord } from '../entities/custom-record.entity';
import { CustomRelationshipDefinition } from '../entities/custom-relationship-definition.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';

/** The caller as far as link authorization is concerned (`req.user`). */
export interface LinkActor {
  id: string;
  permissions?: string[];
}

/**
 * Where each core entity a relationship can point at lives. `softDeleted`
 * tables keep rows with a `deletedAt` stamp; links to those rows are not
 * removed (a soft delete is not an SQL DELETE, so the cleanup trigger in
 * migration 1789500000000 does not fire) and are filtered out on read instead.
 */
export const CORE_ENTITY_TABLES: Record<
  RelationshipCoreEntity,
  { table: string; softDeleted: boolean }
> = {
  customer: { table: 'customers', softDeleted: true },
  contact: { table: 'contacts', softDeleted: true },
  quote: { table: 'quotes', softDeleted: false },
  order: { table: 'sales_orders', softDeleted: false },
  work_order: { table: 'work_orders', softDeleted: false },
  purchase_order: { table: 'purchase_orders', softDeleted: true },
};

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
};

/** Same rule as `CustomRecordsService.getById`: own, unowned, or read_all. */
const canTouchRecord = (actor: LinkActor | undefined, record: { ownerId?: string | null }) =>
  !actor ||
  Boolean(actor.permissions?.includes(PERMISSIONS.CUSTOM_RECORD_READ_ALL)) ||
  !record.ownerId ||
  record.ownerId === actor.id;

@Injectable()
export class CoreEntityBridgeService {
  constructor(
    @InjectRepository(CustomRecordLink)
    private readonly linkRepo: Repository<CustomRecordLink>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
    @InjectRepository(WorkOrder)
    private readonly workOrderRepo: Repository<WorkOrder>,
    @Optional()
    private readonly eventBus?: CrmEventBusService,
  ) {}

  /**
   * Creates an edge from a custom record to another custom record or a core
   * entity. Every id in the payload is checked against the caller's tenant in
   * one transaction before the insert: the relationship must exist, the source
   * must be a live record of the relationship's source object, and the target
   * must be a live row of the kind the relationship points at. The tenant and
   * target type come from the server, never the body.
   */
  async link(
    tenantId: string,
    payload: CreateCustomRecordLinkPayload,
    actor?: LinkActor,
  ): Promise<CustomRecordLink> {
    return this.linkRepo.manager.transaction(async (manager) => {
      const relationship = await manager
        .getRepository(CustomRelationshipDefinition)
        .findOne({ where: { id: payload.relationshipId, tenantId } });
      if (!relationship) {
        throw new NotFoundException(`Relationship '${payload.relationshipId}' not found`);
      }
      if (payload.targetType && payload.targetType !== relationship.targetType) {
        throw new BadRequestException(
          `Relationship '${relationship.id}' targets ${relationship.targetType}, not ${payload.targetType}`,
        );
      }

      const records = manager.getRepository(CustomRecord);
      const source = await records.findOne({
        where: { id: payload.sourceRecordId, tenantId, objectId: relationship.sourceObjectId },
      });
      if (!source) {
        throw new NotFoundException(`Source record '${payload.sourceRecordId}' not found`);
      }
      if (!canTouchRecord(actor, source)) {
        throw new ForbiddenException('You do not have permission to modify this record');
      }

      await this.assertTargetExists(manager, tenantId, relationship, payload.targetRecordId);

      const linkRepo = manager.getRepository(CustomRecordLink);
      const link = linkRepo.create({
        tenantId,
        relationshipId: relationship.id,
        sourceRecordId: source.id,
        targetRecordId: payload.targetRecordId,
        targetType: relationship.targetType,
      });
      let saved: CustomRecordLink;
      try {
        saved = await linkRepo.save(link);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('These records are already linked');
        }
        throw error;
      }

      // Outbox write in the same transaction: the event commits with the link.
      if (this.eventBus) {
        await this.eventBus.publish(
          {
            tenantId,
            eventType: 'link.created',
            entityType: 'custom_object',
            entityName: 'link',
            entityId: saved.id,
            actorUserId: actor?.id ?? null,
            timestamp: new Date().toISOString(),
            snapshot: {
              before: null,
              after: saved,
              changedFields: ['sourceRecordId', 'targetRecordId', 'targetType'],
            },
          },
          { manager },
        );
      }

      return saved;
    });
  }

  async unlink(tenantId: string, linkId: string, actor?: LinkActor): Promise<void> {
    if (actor) {
      const existing = await this.linkRepo.findOne({
        where: { id: linkId, tenantId },
        relations: { sourceRecord: true },
      });
      if (existing?.sourceRecord && !canTouchRecord(actor, existing.sourceRecord)) {
        throw new ForbiddenException('You do not have permission to modify this record');
      }
    }

    await this.linkRepo.manager.transaction(async (manager) => {
      const res = await manager.getRepository(CustomRecordLink).delete({ id: linkId, tenantId });

      if (this.eventBus && res?.affected && res.affected > 0) {
        await this.eventBus.publish(
          {
            tenantId,
            eventType: 'link.deleted',
            entityType: 'custom_object',
            entityName: 'link',
            entityId: linkId,
            actorUserId: actor?.id ?? null,
            timestamp: new Date().toISOString(),
            snapshot: {
              before: { id: linkId },
              after: null,
              changedFields: ['id'],
            },
          },
          { manager },
        );
      }
    });
  }

  /** The target must be a live row, in this tenant, of the kind the relationship names. */
  private async assertTargetExists(
    manager: EntityManager,
    tenantId: string,
    relationship: CustomRelationshipDefinition,
    targetRecordId: string,
  ): Promise<void> {
    if (relationship.targetType === 'custom_object') {
      const target = relationship.targetObjectId
        ? await manager.getRepository(CustomRecord).findOne({
            where: { id: targetRecordId, tenantId, objectId: relationship.targetObjectId },
          })
        : null;
      if (!target) throw new NotFoundException(`Target record '${targetRecordId}' not found`);
      return;
    }

    const core = relationship.targetCoreEntity
      ? CORE_ENTITY_TABLES[relationship.targetCoreEntity]
      : undefined;
    if (!core) {
      throw new BadRequestException(
        `Relationship '${relationship.id}' has no supported core entity target`,
      );
    }
    // Table name comes from the fixed map above, never from input.
    const rows: unknown[] = await manager.query(
      `SELECT 1 AS found FROM "${core.table}" WHERE "id" = $1 AND "tenant_id" = $2` +
        (core.softDeleted ? ` AND "deletedAt" IS NULL` : '') +
        ` LIMIT 1`,
      [targetRecordId, tenantId],
    );
    if (!rows?.length) {
      throw new NotFoundException(
        `Target ${relationship.targetCoreEntity} '${targetRecordId}' not found`,
      );
    }
  }

  /**
   * Of `ids` (all of one core kind), the ones that are still live. Used for
   * kinds without a summary resolver so soft-deleted targets are hidden.
   */
  private async liveCoreIds(
    tenantId: string,
    kind: RelationshipCoreEntity,
    ids: string[],
  ): Promise<Set<string>> {
    const core = CORE_ENTITY_TABLES[kind];
    const rows: { id: string }[] = await this.linkRepo.manager.query(
      `SELECT "id" FROM "${core.table}" WHERE "tenant_id" = $1 AND "id" = ANY($2::uuid[])` +
        (core.softDeleted ? ` AND "deletedAt" IS NULL` : ''),
      [tenantId, ids],
    );
    return new Set((rows ?? []).map((r) => r.id));
  }

  async getRecordLinks(tenantId: string, sourceRecordId: string): Promise<any[]> {
    const links = await this.linkRepo.find({
      where: { tenantId, sourceRecordId },
      relations: { relationship: true },
      order: { createdAt: 'ASC' },
    });

    if (!links || links.length === 0) {
      return [];
    }

    const summaryMap = new Map<string, Record<string, any>>();

    const customerIds: string[] = [];
    const contactIds: string[] = [];
    const quoteIds: string[] = [];
    const workOrderIds: string[] = [];
    const otherCoreIds: Partial<Record<RelationshipCoreEntity, string[]>> = {};

    for (const link of links) {
      const targetCore = link.relationship?.targetCoreEntity || (link.targetType as string);
      if (targetCore === 'customer') {
        customerIds.push(link.targetRecordId);
      } else if (targetCore === 'contact') {
        contactIds.push(link.targetRecordId);
      } else if (targetCore === 'quote') {
        quoteIds.push(link.targetRecordId);
      } else if (targetCore === 'work_order') {
        workOrderIds.push(link.targetRecordId);
      } else if (targetCore === 'order' || targetCore === 'purchase_order') {
        (otherCoreIds[targetCore] ??= []).push(link.targetRecordId);
      }
    }

    // Kinds with no summary resolver: still hide links to deleted rows.
    const liveOtherIds = new Set<string>();
    for (const [kind, ids] of Object.entries(otherCoreIds) as [RelationshipCoreEntity, string[]][]) {
      for (const id of await this.liveCoreIds(tenantId, kind, Array.from(new Set(ids)))) {
        liveOtherIds.add(id);
      }
    }

    if (customerIds.length > 0) {
      const uniqueIds = Array.from(new Set(customerIds));
      const customers = await this.customerRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const c of customers) {
        summaryMap.set(c.id, {
          id: c.id,
          name: (c as any).name ?? c.companyName,
          email: c.email,
        });
      }
    }

    if (contactIds.length > 0) {
      const uniqueIds = Array.from(new Set(contactIds));
      const contacts = await this.contactRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const c of contacts) {
        summaryMap.set(c.id, {
          id: c.id,
          name: (c as any).name ?? (c.fullName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()),
          email: c.email,
        });
      }
    }

    if (quoteIds.length > 0) {
      const uniqueIds = Array.from(new Set(quoteIds));
      const quotes = await this.quoteRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const q of quotes) {
        summaryMap.set(q.id, {
          id: q.id,
          name: (q as any).name ?? q.quoteNumber ?? q.title,
          quoteNumber: q.quoteNumber,
          title: q.title,
          status: q.status,
          totalAmount: q.totalAmount,
        });
      }
    }

    if (workOrderIds.length > 0) {
      const uniqueIds = Array.from(new Set(workOrderIds));
      const workOrders = await this.workOrderRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const wo of workOrders) {
        summaryMap.set(wo.id, {
          id: wo.id,
          name: (wo as any).name ?? wo.woNumber ?? wo.description,
          woNumber: wo.woNumber,
          status: wo.status,
          description: wo.description,
        });
      }
    }

    return links
      .filter((link) => {
        // A core target that no longer resolves was deleted (soft deletes
        // leave the link row behind — see CORE_ENTITY_TABLES).
        const targetCore = link.relationship?.targetCoreEntity || (link.targetType as string);
        if (targetCore === 'order' || targetCore === 'purchase_order') {
          return liveOtherIds.has(link.targetRecordId);
        }
        if (['customer', 'contact', 'quote', 'work_order'].includes(targetCore)) {
          return summaryMap.has(link.targetRecordId);
        }
        return true;
      })
      .map((link) => {
        const targetSummary = summaryMap.get(link.targetRecordId);
        return {
          ...link,
          ...(targetSummary ? { targetSummary } : {}),
        };
      });
  }

  async getReverseLinksForCoreEntity(
    tenantId: string,
    targetType: string,
    targetId: string,
    actor?: LinkActor,
  ): Promise<CustomRecordLink[]> {
    const where: any = {
      tenantId,
      targetRecordId: targetId,
    };
    if ((RELATIONSHIP_CORE_ENTITIES as readonly string[]).includes(targetType)) {
      // Callers name the core entity ('customer'); the link row only says
      // 'core_entity', so the kind is matched on the relationship.
      where.targetType = 'core_entity';
      where.relationship = { targetCoreEntity: targetType };
    } else if (targetType) {
      // 'custom_object' / 'core_entity'; anything else matches nothing.
      where.targetType = targetType;
    }
    const links = await this.linkRepo.find({
      where,
      relations: {
        sourceRecord: { object: true },
        relationship: true,
      },
    });
    if (!actor) return links;
    // The source record is returned in full, so apply the same ownership
    // scoping as the records list; a missing source has been soft-deleted.
    return links.filter((link) => link.sourceRecord && canTouchRecord(actor, link.sourceRecord));
  }
}
