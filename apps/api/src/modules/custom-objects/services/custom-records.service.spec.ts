import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { CustomRecordsService } from './custom-records.service';
import { RecordValidationService } from './record-validation.service';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('CustomRecordsService', () => {
  let service: CustomRecordsService;
  let mockRepo: any;
  let mockObjectsService: any;
  let mockValidationService: any;
  let mockEventBus: any;
  let mockQueryBuilder: any;

  beforeEach(() => {
    mockQueryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[{ id: 'rec-1', values: { serial: '123' } }], 1]),
    };

    mockRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
      create: vi.fn((d) => d),
      save: vi.fn((e) => Promise.resolve({ id: 'rec-1', ...e })),
      findOne: vi.fn(),
      softDelete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    mockObjectsService = {
      getBySlug: vi.fn().mockResolvedValue({
        id: 'obj-1',
        slug: 'machinery',
        primaryAttributeSlug: 'serial',
        attributes: [{ slug: 'serial', type: 'text', isRequired: true }],
      }),
    };

    mockValidationService = {
      validate: vi.fn((attrs, vals) => vals),
    };

    mockEventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
      computeChangedFields: vi.fn((before, after) => {
        const b = before ?? {};
        const a = after ?? {};
        const allKeys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
        return allKeys.filter((k) => b[k] !== a[k]).sort();
      }),
    };

    service = new CustomRecordsService(
      mockRepo as any,
      mockObjectsService as any,
      mockValidationService as any,
      mockEventBus as any,
    );
  });

  describe('create', () => {
    it('creates record after dynamic validation', async () => {
      const result = await service.create(
        'tenant-1',
        'machinery',
        { ownerId: 'u-1', values: { serial: '123' } },
        { id: 'u-1', permissions: [PERMISSIONS.CUSTOM_RECORD_CREATE] },
      );

      expect(mockObjectsService.getBySlug).toHaveBeenCalledWith('tenant-1', 'machinery');
      expect(mockValidationService.validate).toHaveBeenCalledWith(
        [{ slug: 'serial', type: 'text', isRequired: true }],
        { serial: '123' },
      );
      expect(mockRepo.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-1',
        values: { serial: '123' },
      });
      expect(result.id).toBe('rec-1');
    });

    it('defaults ownerId to actor.id if not provided', async () => {
      await service.create(
        'tenant-1',
        'machinery',
        { values: { serial: '123' } },
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_CREATE] },
      );

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'u-actor' }),
      );
    });

    it('publishes record.created domain event with snapshot and changed fields', async () => {
      await service.create(
        'tenant-1',
        'machinery',
        { ownerId: 'u-1', values: { serial: '123' } },
        { id: 'u-1', permissions: [PERMISSIONS.CUSTOM_RECORD_CREATE] },
      );

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'record.created',
          entityType: 'custom_object',
          entityName: 'machinery',
          entityId: 'rec-1',
          actorUserId: 'u-1',
          snapshot: {
            before: null,
            after: { serial: '123' },
            changedFields: ['serial'],
          },
        }),
      );
    });
  });

  describe('list', () => {
    it('scopes query to actor ownerId when actor does not have read_all permission', async () => {
      const result = await service.list(
        'tenant-1',
        'machinery',
        { page: 1, limit: 10 },
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_READ] },
      );

      expect(mockRepo.createQueryBuilder).toHaveBeenCalledWith('r');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('r.tenantId = :tenantId', { tenantId: 'tenant-1' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('r.objectId = :objectId', { objectId: 'obj-1' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(r.ownerId = :userId OR r.ownerId IS NULL)',
        { userId: 'u-actor' },
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });

    it('does not scope to actor ownerId when actor has read_all permission', async () => {
      await service.list(
        'tenant-1',
        'machinery',
        {},
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_READ, PERMISSIONS.CUSTOM_RECORD_READ_ALL] },
      );

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        '(r.ownerId = :userId OR r.ownerId IS NULL)',
        expect.anything(),
      );
    });

    it('applies search filter on primaryAttributeSlug', async () => {
      await service.list(
        'tenant-1',
        'machinery',
        { search: 'ABC' },
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_READ_ALL] },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(r.values->>:primaryAttributeSlug) LIKE :search',
        { primaryAttributeSlug: 'serial', search: '%abc%' },
      );
    });

    it('binds an untrusted primary attribute slug as a query value', async () => {
      const injectedSlug = "serial') OR 1=1 --";
      mockObjectsService.getBySlug.mockResolvedValueOnce({
        id: 'obj-1',
        slug: 'machinery',
        primaryAttributeSlug: injectedSlug,
        attributes: [{ slug: 'serial', type: 'text', isRequired: true }],
      });
      await service.list(
        'tenant-1',
        'machinery',
        { search: 'ABC' },
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_READ_ALL] },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(r.values->>:primaryAttributeSlug) LIKE :search',
        { primaryAttributeSlug: injectedSlug, search: '%abc%' },
      );
    });

    it('applies jsonb field filters', async () => {
      await service.list(
        'tenant-1',
        'machinery',
        { filters: { status: 'active', tier: 2 } },
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_READ_ALL] },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'r.values @> :filter_0',
        { filter_0: JSON.stringify({ status: 'active' }) },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'r.values @> :filter_1',
        { filter_1: JSON.stringify({ tier: 2 }) },
      );
    });
  });

  describe('getById', () => {
    it('returns record when owned by actor', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-actor',
        values: { serial: '123' },
      });

      const result = await service.getById('tenant-1', 'machinery', 'rec-1', {
        id: 'u-actor',
        permissions: [PERMISSIONS.CUSTOM_RECORD_READ],
      });

      expect(result.id).toBe('rec-1');
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'rec-1', tenantId: 'tenant-1', objectId: 'obj-1' },
      });
    });

    it('returns record when actor has read_all even if owned by someone else', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-other',
        values: { serial: '123' },
      });

      const result = await service.getById('tenant-1', 'machinery', 'rec-1', {
        id: 'u-actor',
        permissions: [PERMISSIONS.CUSTOM_RECORD_READ, PERMISSIONS.CUSTOM_RECORD_READ_ALL],
      });

      expect(result.id).toBe('rec-1');
    });

    it('throws NotFoundException when record does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getById('tenant-1', 'machinery', 'rec-missing', {
          id: 'u-actor',
          permissions: [PERMISSIONS.CUSTOM_RECORD_READ_ALL],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when record owned by another and lacks read_all', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-other',
      });

      await expect(
        service.getById('tenant-1', 'machinery', 'rec-1', {
          id: 'u-actor',
          permissions: [PERMISSIONS.CUSTOM_RECORD_READ],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('merges values, validates, and saves', async () => {
      const existing = {
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-actor',
        values: { serial: '123', color: 'blue' },
      };
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.update(
        'tenant-1',
        'machinery',
        'rec-1',
        { values: { color: 'red' }, ownerId: 'u-new-owner' },
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_UPDATE] },
      );

      expect(mockValidationService.validate).toHaveBeenCalledWith(
        [{ slug: 'serial', type: 'text', isRequired: true }],
        { serial: '123', color: 'red' },
      );
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'u-new-owner',
          values: { serial: '123', color: 'red' },
        }),
      );
      expect(result).toBeDefined();
    });

    it('publishes record.updated domain event with before/after snapshots and diff', async () => {
      const existing = {
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-actor',
        values: { serial: '123', color: 'blue' },
      };
      mockRepo.findOne.mockResolvedValue(existing);

      await service.update(
        'tenant-1',
        'machinery',
        'rec-1',
        { values: { color: 'red' }, ownerId: 'u-new-owner' },
        { id: 'u-actor', permissions: [PERMISSIONS.CUSTOM_RECORD_UPDATE] },
      );

      expect(mockEventBus.computeChangedFields).toHaveBeenCalledWith(
        { serial: '123', color: 'blue' },
        { serial: '123', color: 'red' },
      );
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'record.updated',
          entityType: 'custom_object',
          entityName: 'machinery',
          entityId: 'rec-1',
          actorUserId: 'u-actor',
          snapshot: {
            before: { serial: '123', color: 'blue', ownerId: 'u-actor' },
            after: { serial: '123', color: 'red', ownerId: 'u-new-owner' },
            changedFields: ['color', 'ownerId'],
          },
        }),
      );
    });
  });

  describe('delete', () => {
    it('verifies access and soft deletes record', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-actor',
      });

      await service.delete('tenant-1', 'machinery', 'rec-1', {
        id: 'u-actor',
        permissions: [PERMISSIONS.CUSTOM_RECORD_DELETE],
      });

      expect(mockRepo.softDelete).toHaveBeenCalledWith({ id: 'rec-1', tenantId: 'tenant-1' });
    });

    it('publishes record.deleted domain event with snapshot and changed fields', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'rec-1',
        tenantId: 'tenant-1',
        objectId: 'obj-1',
        ownerId: 'u-actor',
        values: { serial: '123', model: 'X100' },
      });

      await service.delete('tenant-1', 'machinery', 'rec-1', {
        id: 'u-actor',
        permissions: [PERMISSIONS.CUSTOM_RECORD_DELETE],
      });

      expect(mockRepo.softDelete).toHaveBeenCalledWith({ id: 'rec-1', tenantId: 'tenant-1' });
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'record.deleted',
          entityType: 'custom_object',
          entityName: 'machinery',
          entityId: 'rec-1',
          actorUserId: 'u-actor',
          snapshot: {
            before: { serial: '123', model: 'X100' },
            after: null,
            changedFields: ['serial', 'model'],
          },
        }),
      );
    });
  });
});

describe('RecordValidationService', () => {
  let service: RecordValidationService;

  beforeEach(() => {
    service = new RecordValidationService();
  });

  const attributes: any[] = [
    {
      id: 'attr-1',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Serial Number',
      slug: 'serial',
      type: 'text',
      isRequired: true,
      isUnique: false,
      isSearchable: true,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'attr-2',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Hours Used',
      slug: 'hours',
      type: 'number',
      isRequired: false,
      isUnique: false,
      isSearchable: false,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  it('validates and returns parsed data for valid values', () => {
    const values = { serial: 'SN-10029', hours: 42 };
    const result = service.validate(attributes, values);
    expect(result).toEqual({ serial: 'SN-10029', hours: 42 });
  });

  it('throws BadRequestException when required field is missing', () => {
    const values = { hours: 42 };
    expect(() => service.validate(attributes, values)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when extra undefined fields are supplied (strict mode)', () => {
    const values = { serial: 'SN-10029', unknownField: 'test' };
    expect(() => service.validate(attributes, values)).toThrow(BadRequestException);
  });
});
