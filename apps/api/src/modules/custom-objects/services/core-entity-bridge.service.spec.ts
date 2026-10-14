import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { CoreEntityBridgeService } from './core-entity-bridge.service';
import { CrmEventBusService } from '@/common/events';
import { CustomRecordLink } from '../entities/custom-record-link.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { CustomRecord } from '../entities/custom-record.entity';
import { CustomRelationshipDefinition } from '../entities/custom-relationship-definition.entity';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('CoreEntityBridgeService', () => {
  let service: CoreEntityBridgeService;
  let mockLinkRepo: any;
  let mockCustomerRepo: any;
  let mockContactRepo: any;
  let mockQuoteRepo: any;
  let mockWorkOrderRepo: any;
  let mockEventBus: any;

  beforeEach(async () => {
    mockEventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockLinkRepo = {
      find: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn((dto: any) => dto),
      save: vi.fn((entity: any) => Promise.resolve({ id: 'link-123', ...entity })),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    mockCustomerRepo = {
      find: vi.fn(),
      findBy: vi.fn(),
    };

    mockContactRepo = {
      find: vi.fn(),
      findBy: vi.fn(),
    };

    mockQuoteRepo = {
      find: vi.fn(),
      findBy: vi.fn(),
    };

    mockWorkOrderRepo = {
      find: vi.fn(),
      findBy: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoreEntityBridgeService,
        { provide: getRepositoryToken(CustomRecordLink), useValue: mockLinkRepo },
        { provide: getRepositoryToken(Customer), useValue: mockCustomerRepo },
        { provide: getRepositoryToken(Contact), useValue: mockContactRepo },
        { provide: getRepositoryToken(Quote), useValue: mockQuoteRepo },
        { provide: getRepositoryToken(WorkOrder), useValue: mockWorkOrderRepo },
        { provide: CrmEventBusService, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get<CoreEntityBridgeService>(CoreEntityBridgeService);
  });

  describe('link', () => {
    let mockRelRepo: any;
    let mockRecordRepo: any;
    let mockManager: any;
    const actor = { id: 'u-1', permissions: [PERMISSIONS.CUSTOM_RECORD_UPDATE] };
    const payload = {
      relationshipId: 'rel-1',
      sourceRecordId: 'rec-1',
      targetRecordId: 'cust-1',
    };

    beforeEach(() => {
      mockRelRepo = {
        findOne: vi.fn().mockResolvedValue({
          id: 'rel-1',
          tenantId: 'tenant-1',
          sourceObjectId: 'obj-1',
          targetType: 'core_entity',
          targetCoreEntity: 'customer',
          targetObjectId: null,
        }),
      };
      mockRecordRepo = {
        findOne: vi.fn().mockResolvedValue({
          id: 'rec-1',
          tenantId: 'tenant-1',
          objectId: 'obj-1',
          ownerId: 'u-1',
        }),
      };
      mockManager = {
        getRepository: vi.fn((entity: any) => {
          if (entity === CustomRelationshipDefinition) return mockRelRepo;
          if (entity === CustomRecord) return mockRecordRepo;
          return mockLinkRepo;
        }),
        query: vi.fn().mockResolvedValue([{ found: 1 }]),
      };
      mockLinkRepo.manager = {
        transaction: vi.fn((cb: any) => cb(mockManager)),
        query: vi.fn().mockResolvedValue([]),
      };
    });

    it('creates the link inside a transaction with whitelisted fields and the tenant from context', async () => {
      const result = await service.link('tenant-1', payload, actor);

      expect(mockLinkRepo.manager.transaction).toHaveBeenCalled();
      expect(mockLinkRepo.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        relationshipId: 'rel-1',
        sourceRecordId: 'rec-1',
        targetRecordId: 'cust-1',
        targetType: 'core_entity',
      });
      expect(mockLinkRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('link-123');
      expect(result.tenantId).toBe('tenant-1');
    });

    it('ignores a smuggled tenantId / actorUserId and attributes the event to the real actor', async () => {
      await service.link(
        'tenant-1',
        { ...payload, tenantId: 'tenant-evil', actorUserId: 'u-spoofed', id: 'x' } as any,
        actor,
      );

      const created = mockLinkRepo.create.mock.calls[0][0];
      expect(created.tenantId).toBe('tenant-1');
      expect(created).not.toHaveProperty('actorUserId');
      expect(created).not.toHaveProperty('id');
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'u-1' }),
        { manager: mockManager },
      );
    });

    it('rejects a relationship that does not exist in the caller tenant', async () => {
      mockRelRepo.findOne.mockResolvedValue(null);

      await expect(service.link('tenant-1', payload, actor)).rejects.toThrow(NotFoundException);
      expect(mockRelRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'rel-1', tenantId: 'tenant-1' },
      });
      expect(mockLinkRepo.save).not.toHaveBeenCalled();
    });

    it("rejects a source record outside the tenant or not of the relationship's source object", async () => {
      mockRecordRepo.findOne.mockResolvedValue(null);

      await expect(service.link('tenant-1', payload, actor)).rejects.toThrow(NotFoundException);
      expect(mockRecordRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'rec-1', tenantId: 'tenant-1', objectId: 'obj-1' },
      });
      expect(mockLinkRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a targetType that disagrees with the relationship definition', async () => {
      await expect(
        service.link('tenant-1', { ...payload, targetType: 'custom_object' }, actor),
      ).rejects.toThrow(BadRequestException);
      expect(mockLinkRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a core-entity target that does not exist in the caller tenant', async () => {
      mockManager.query.mockResolvedValue([]);

      await expect(service.link('tenant-1', payload, actor)).rejects.toThrow(NotFoundException);
      const [sql, params] = mockManager.query.mock.calls[0];
      expect(sql).toContain('"customers"');
      expect(sql).toContain('"deletedAt" IS NULL');
      expect(params).toEqual(['cust-1', 'tenant-1']);
      expect(mockLinkRepo.save).not.toHaveBeenCalled();
    });

    it("rejects a custom-object target that is not a live record of the relationship's target object", async () => {
      mockRelRepo.findOne.mockResolvedValue({
        id: 'rel-1',
        tenantId: 'tenant-1',
        sourceObjectId: 'obj-1',
        targetType: 'custom_object',
        targetObjectId: 'obj-2',
        targetCoreEntity: null,
      });
      mockRecordRepo.findOne
        .mockResolvedValueOnce({ id: 'rec-1', tenantId: 'tenant-1', objectId: 'obj-1', ownerId: 'u-1' })
        .mockResolvedValueOnce(null);

      await expect(
        service.link('tenant-1', { ...payload, targetRecordId: 'rec-2' }, actor),
      ).rejects.toThrow(NotFoundException);
      expect(mockRecordRepo.findOne).toHaveBeenLastCalledWith({
        where: { id: 'rec-2', tenantId: 'tenant-1', objectId: 'obj-2' },
      });
      expect(mockLinkRepo.save).not.toHaveBeenCalled();
    });

    it('forbids linking from a record the actor does not own without read_all', async () => {
      mockRecordRepo.findOne.mockResolvedValue({
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-other',
      });

      await expect(service.link('tenant-1', payload, actor)).rejects.toThrow(ForbiddenException);
      expect(mockLinkRepo.save).not.toHaveBeenCalled();
    });

    it('maps a duplicate edge to a 409', async () => {
      mockLinkRepo.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      await expect(service.link('tenant-1', payload, actor)).rejects.toThrow(ConflictException);
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });

    it('publishes link.created domain event upon creating link', async () => {
      await service.link('tenant-1', payload, actor);

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'link.created',
          entityType: 'custom_object',
          entityName: 'link',
          entityId: 'link-123',
          snapshot: {
            before: null,
            after: expect.objectContaining({ id: 'link-123' }),
            changedFields: ['sourceRecordId', 'targetRecordId', 'targetType'],
          },
        }),
        { manager: expect.objectContaining({ getRepository: expect.any(Function) }) },
      );
    });
  });

  describe('unlink', () => {
    let unlinkManager: any;

    beforeEach(() => {
      unlinkManager = { getRepository: vi.fn(() => mockLinkRepo) };
      mockLinkRepo.manager = { transaction: vi.fn((cb: any) => cb(unlinkManager)) };
    });

    it('deletes link scoped to tenant inside a transaction', async () => {
      await service.unlink('tenant-1', 'link-123');

      expect(mockLinkRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(unlinkManager.getRepository).toHaveBeenCalledWith(CustomRecordLink);
      expect(mockLinkRepo.delete).toHaveBeenCalledWith({
        id: 'link-123',
        tenantId: 'tenant-1',
      });
    });

    it('publishes link.deleted domain event upon deleting link when affected > 0', async () => {
      await service.unlink('tenant-1', 'link-123');

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'link.deleted',
          entityType: 'custom_object',
          entityName: 'link',
          entityId: 'link-123',
          snapshot: {
            before: { id: 'link-123' },
            after: null,
            changedFields: ['id'],
          },
        }),
        { manager: expect.objectContaining({ getRepository: expect.any(Function) }) },
      );
    });

    it('does not publish link.deleted event if delete affected count is 0 (phantom unlink protection)', async () => {
      mockLinkRepo.delete.mockResolvedValue({ affected: 0 });

      await service.unlink('tenant-1', 'link-nonexistent');

      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('getRecordLinks', () => {
    it('returns empty array if no links exist for source record', async () => {
      mockLinkRepo.find.mockResolvedValue([]);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(mockLinkRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', sourceRecordId: 'rec-1' },
        relations: { relationship: true },
        order: { createdAt: 'ASC' },
      });
      expect(result).toEqual([]);
      expect(mockCustomerRepo.find).not.toHaveBeenCalled();
    });

    it('batch resolves Customer summaries for customer links', async () => {
      const links = [
        {
          id: 'link-1',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'core_entity',
          targetRecordId: 'cust-1',
          relationship: {
            id: 'rel-1',
            targetType: 'core_entity',
            targetCoreEntity: 'customer',
          },
        },
      ];
      mockLinkRepo.find.mockResolvedValue(links);
      mockCustomerRepo.find.mockResolvedValue([
        {
          id: 'cust-1',
          companyName: 'Acme Industries',
          email: 'contact@acme.com',
        },
      ]);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(mockCustomerRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', id: In(['cust-1']) },
      });
      expect(result).toHaveLength(1);
      expect(result[0].targetSummary).toEqual({
        id: 'cust-1',
        name: 'Acme Industries',
        email: 'contact@acme.com',
      });
    });

    it('batch resolves Contact summaries for contact links', async () => {
      const links = [
        {
          id: 'link-2',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'core_entity',
          targetRecordId: 'cont-1',
          relationship: {
            id: 'rel-2',
            targetType: 'core_entity',
            targetCoreEntity: 'contact',
          },
        },
      ];
      mockLinkRepo.find.mockResolvedValue(links);
      mockContactRepo.find.mockResolvedValue([
        {
          id: 'cont-1',
          firstName: 'Jane',
          lastName: 'Doe',
          fullName: 'Jane Doe',
          email: 'jane@doe.com',
        },
      ]);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(mockContactRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', id: In(['cont-1']) },
      });
      expect(result[0].targetSummary).toEqual({
        id: 'cont-1',
        name: 'Jane Doe',
        email: 'jane@doe.com',
      });
    });

    it('batch resolves Quote summaries for quote links', async () => {
      const links = [
        {
          id: 'link-3',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'core_entity',
          targetRecordId: 'quote-1',
          relationship: {
            id: 'rel-3',
            targetType: 'core_entity',
            targetCoreEntity: 'quote',
          },
        },
      ];
      mockLinkRepo.find.mockResolvedValue(links);
      mockQuoteRepo.find.mockResolvedValue([
        {
          id: 'quote-1',
          quoteNumber: 'Q-2026-001',
          title: 'Machinery Overhaul',
          status: 'APPROVED',
          totalAmount: 15000,
        },
      ]);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(mockQuoteRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', id: In(['quote-1']) },
      });
      expect(result[0].targetSummary).toEqual({
        id: 'quote-1',
        name: 'Q-2026-001',
        quoteNumber: 'Q-2026-001',
        title: 'Machinery Overhaul',
        status: 'APPROVED',
        totalAmount: 15000,
      });
    });

    it('batch resolves WorkOrder summaries for work_order links', async () => {
      const links = [
        {
          id: 'link-4',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'core_entity',
          targetRecordId: 'wo-1',
          relationship: {
            id: 'rel-4',
            targetType: 'core_entity',
            targetCoreEntity: 'work_order',
          },
        },
      ];
      mockLinkRepo.find.mockResolvedValue(links);
      mockWorkOrderRepo.find.mockResolvedValue([
        {
          id: 'wo-1',
          woNumber: 'WO-5001',
          status: 'IN_PROGRESS',
          description: 'Custom CNC fabrication',
        },
      ]);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(mockWorkOrderRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', id: In(['wo-1']) },
      });
      expect(result[0].targetSummary).toEqual({
        id: 'wo-1',
        name: 'WO-5001',
        woNumber: 'WO-5001',
        status: 'IN_PROGRESS',
        description: 'Custom CNC fabrication',
      });
    });

    it('batch resolves multiple mixed entity targets and deduplicates ids', async () => {
      const links = [
        {
          id: 'link-10',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'core_entity',
          targetRecordId: 'cust-1',
          relationship: { targetCoreEntity: 'customer' },
        },
        {
          id: 'link-11',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'core_entity',
          targetRecordId: 'cust-1',
          relationship: { targetCoreEntity: 'customer' },
        },
        {
          id: 'link-12',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'core_entity',
          targetRecordId: 'cont-1',
          relationship: { targetCoreEntity: 'contact' },
        },
      ];
      mockLinkRepo.find.mockResolvedValue(links);
      mockCustomerRepo.find.mockResolvedValue([
        { id: 'cust-1', companyName: 'Acme Corp', email: 'acme@test.com' },
      ]);
      mockContactRepo.find.mockResolvedValue([
        { id: 'cont-1', firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      ]);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(mockCustomerRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', id: In(['cust-1']) },
      });
      expect(result).toHaveLength(3);
      expect(result[0].targetSummary?.name).toBe('Acme Corp');
      expect(result[1].targetSummary?.name).toBe('Acme Corp');
      expect(result[2].targetSummary?.name).toBe('John Doe');
    });

    it('handles unresolved core entities or custom_object targets gracefully', async () => {
      const links = [
        {
          id: 'link-custom',
          tenantId: 'tenant-1',
          sourceRecordId: 'rec-1',
          targetType: 'custom_object',
          targetRecordId: 'rec-target-99',
          relationship: { targetType: 'custom_object' },
        },
      ];
      mockLinkRepo.find.mockResolvedValue(links);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(result).toHaveLength(1);
      expect(result[0].targetSummary).toBeUndefined();
    });

    it('filters out links whose core target is soft-deleted (no longer resolvable)', async () => {
      mockLinkRepo.find.mockResolvedValue([
        {
          id: 'link-live',
          targetType: 'core_entity',
          targetRecordId: 'cust-live',
          relationship: { targetType: 'core_entity', targetCoreEntity: 'customer' },
        },
        {
          id: 'link-dead',
          targetType: 'core_entity',
          targetRecordId: 'cust-deleted',
          relationship: { targetType: 'core_entity', targetCoreEntity: 'customer' },
        },
        {
          id: 'link-po-dead',
          targetType: 'core_entity',
          targetRecordId: 'po-deleted',
          relationship: { targetType: 'core_entity', targetCoreEntity: 'purchase_order' },
        },
      ]);
      // TypeORM excludes soft-deleted rows, so the deleted customer is absent.
      mockCustomerRepo.find.mockResolvedValue([
        { id: 'cust-live', companyName: 'Live Co', email: null },
      ]);
      mockLinkRepo.manager = { query: vi.fn().mockResolvedValue([]) };

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(result.map((l: any) => l.id)).toEqual(['link-live']);
      const [sql, params] = mockLinkRepo.manager.query.mock.calls[0];
      expect(sql).toContain('"purchase_orders"');
      expect(sql).toContain('"deletedAt" IS NULL');
      expect(params).toEqual(['tenant-1', ['po-deleted']]);
    });
  });

  describe('getReverseLinksForCoreEntity', () => {
    it('finds reverse links for core entity with joins', async () => {
      const mockLinks = [
        {
          id: 'link-rev-1',
          tenantId: 'tenant-1',
          targetRecordId: 'cust-1',
          targetType: 'customer',
          sourceRecord: {
            id: 'rec-1',
            object: { id: 'obj-1', name: 'Machinery', slug: 'machinery' },
          },
          relationship: { id: 'rel-1', name: 'Customer Machine' },
        },
      ];
      mockLinkRepo.find.mockResolvedValue(mockLinks);

      const result = await service.getReverseLinksForCoreEntity('tenant-1', 'customer', 'cust-1');

      // The web passes the core entity name ('customer'); links store
      // target_type = 'core_entity', so the entity kind is matched on the
      // relationship definition instead.
      expect(mockLinkRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          targetRecordId: 'cust-1',
          targetType: 'core_entity',
          relationship: { targetCoreEntity: 'customer' },
        },
        relations: {
          sourceRecord: { object: true },
          relationship: true,
        },
      });
      expect(result).toEqual(mockLinks);
    });

    it('still accepts the raw link target types', async () => {
      mockLinkRepo.find.mockResolvedValue([]);

      await service.getReverseLinksForCoreEntity('tenant-1', 'custom_object', 'rec-9');

      expect(mockLinkRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', targetRecordId: 'rec-9', targetType: 'custom_object' },
        }),
      );
    });

    it('drops links whose source record is soft-deleted or owned by someone else when the actor lacks read_all', async () => {
      mockLinkRepo.find.mockResolvedValue([
        { id: 'l-mine', sourceRecord: { id: 'r1', ownerId: 'u-1' } },
        { id: 'l-unowned', sourceRecord: { id: 'r2', ownerId: null } },
        { id: 'l-other', sourceRecord: { id: 'r3', ownerId: 'u-2' } },
        { id: 'l-deleted', sourceRecord: null },
      ]);

      const result = await service.getReverseLinksForCoreEntity('tenant-1', 'customer', 'cust-1', {
        id: 'u-1',
        permissions: [PERMISSIONS.CUSTOM_RECORD_READ],
      });

      expect(result.map((l: any) => l.id)).toEqual(['l-mine', 'l-unowned']);
    });

    it('finds reverse links when targetType is not specified', async () => {
      mockLinkRepo.find.mockResolvedValue([]);

      await service.getReverseLinksForCoreEntity('tenant-1', '', 'cust-1');

      expect(mockLinkRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          targetRecordId: 'cust-1',
        },
        relations: {
          sourceRecord: { object: true },
          relationship: true,
        },
      });
    });
  });
});
