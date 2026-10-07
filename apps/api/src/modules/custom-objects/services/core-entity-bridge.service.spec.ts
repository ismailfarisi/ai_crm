import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { CoreEntityBridgeService } from './core-entity-bridge.service';
import { CustomRecordLink } from '../entities/custom-record-link.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('CoreEntityBridgeService', () => {
  let service: CoreEntityBridgeService;
  let mockLinkRepo: any;
  let mockCustomerRepo: any;
  let mockContactRepo: any;
  let mockQuoteRepo: any;
  let mockWorkOrderRepo: any;

  beforeEach(async () => {
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
      ],
    }).compile();

    service = module.get<CoreEntityBridgeService>(CoreEntityBridgeService);
  });

  describe('link', () => {
    it('creates and saves a custom record link scoped to tenant', async () => {
      const payload = {
        relationshipId: 'rel-1',
        sourceRecordId: 'rec-1',
        targetType: 'core_entity' as const,
        targetRecordId: 'cust-1',
      };

      const result = await service.link('tenant-1', payload);

      expect(mockLinkRepo.create).toHaveBeenCalledWith({
        ...payload,
        tenantId: 'tenant-1',
      });
      expect(mockLinkRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('link-123');
      expect(result.tenantId).toBe('tenant-1');
    });
  });

  describe('unlink', () => {
    it('deletes link scoped to tenant', async () => {
      await service.unlink('tenant-1', 'link-123');

      expect(mockLinkRepo.delete).toHaveBeenCalledWith({
        id: 'link-123',
        tenantId: 'tenant-1',
      });
    });
  });

  describe('getRecordLinks', () => {
    it('returns empty array if no links exist for source record', async () => {
      mockLinkRepo.find.mockResolvedValue([]);

      const result = await service.getRecordLinks('tenant-1', 'rec-1');

      expect(mockLinkRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', sourceRecordId: 'rec-1' },
        relations: ['relationship'],
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

      expect(mockLinkRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          targetRecordId: 'cust-1',
          targetType: 'customer',
        },
        relations: ['sourceRecord', 'sourceRecord.object', 'relationship'],
      });
      expect(result).toEqual(mockLinks);
    });

    it('finds reverse links when targetType is not specified', async () => {
      mockLinkRepo.find.mockResolvedValue([]);

      await service.getReverseLinksForCoreEntity('tenant-1', '', 'cust-1');

      expect(mockLinkRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          targetRecordId: 'cust-1',
        },
        relations: ['sourceRecord', 'sourceRecord.object', 'relationship'],
      });
    });
  });
});
