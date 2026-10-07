import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomObjectsService } from './custom-objects.service';
import { CustomObjectDefinition } from '../entities/custom-object-definition.entity';
import { CustomAttributeDefinition } from '../entities/custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from '../entities/custom-relationship-definition.entity';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('CustomObjectsService', () => {
  let service: CustomObjectsService;
  let mockObjectRepo: any;
  let mockAttrRepo: any;
  let mockRelRepo: any;

  beforeEach(async () => {
    mockObjectRepo = {
      find: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn((dto: any) => dto),
      save: vi.fn((entity: any) => Promise.resolve({ id: 'obj-123', ...entity })),
      softDelete: vi.fn(),
    };
    mockAttrRepo = {
      find: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn((dto: any) => dto),
      save: vi.fn((entity: any) => Promise.resolve({ id: 'attr-123', ...entity })),
      softDelete: vi.fn(),
    };
    mockRelRepo = {
      find: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn((dto: any) => dto),
      save: vi.fn((entity: any) => Promise.resolve({ id: 'rel-123', ...entity })),
      softDelete: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomObjectsService,
        { provide: getRepositoryToken(CustomObjectDefinition), useValue: mockObjectRepo },
        { provide: getRepositoryToken(CustomAttributeDefinition), useValue: mockAttrRepo },
        { provide: getRepositoryToken(CustomRelationshipDefinition), useValue: mockRelRepo },
      ],
    }).compile();

    service = module.get<CustomObjectsService>(CustomObjectsService);
  });

  describe('list', () => {
    it('returns non-archived custom objects ordered by name', async () => {
      mockObjectRepo.find.mockResolvedValue([{ id: 'obj-1', name: 'Vehicles' }]);
      const res = await service.list('tenant-1');
      expect(mockObjectRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', isArchived: false },
        relations: ['attributes', 'relationships'],
        order: { name: 'ASC' },
      });
      expect(res).toEqual([{ id: 'obj-1', name: 'Vehicles' }]);
    });
  });

  describe('getBySlug', () => {
    it('returns object definition by slug', async () => {
      const mockObj = { id: 'obj-1', slug: 'vehicles', isArchived: false };
      mockObjectRepo.findOne.mockResolvedValue(mockObj);
      const res = await service.getBySlug('tenant-1', 'vehicles');
      expect(res).toBe(mockObj);
    });

    it('throws NotFoundException when object does not exist', async () => {
      mockObjectRepo.findOne.mockResolvedValue(null);
      await expect(service.getBySlug('tenant-1', 'unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates an object definition', async () => {
      mockObjectRepo.findOne.mockResolvedValue(null);
      const result = await service.create('tenant-1', {
        name: 'Vehicles',
        singularName: 'Vehicle',
        slug: 'vehicles',
        icon: 'Truck',
        primaryAttributeSlug: 'vin',
      });
      expect(result.slug).toBe('vehicles');
      expect(mockObjectRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate slug within tenant', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create('tenant-1', {
          name: 'Vehicles',
          singularName: 'Vehicle',
          slug: 'vehicles',
          icon: 'Truck',
          primaryAttributeSlug: 'vin',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates an existing object definition', async () => {
      const existing = { id: 'obj-1', slug: 'vehicles', name: 'Old' };
      mockObjectRepo.findOne.mockResolvedValue(existing);
      const res = await service.update('tenant-1', 'vehicles', { name: 'New' });
      expect(res.name).toBe('New');
      expect(mockObjectRepo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'New' }));
    });
  });

  describe('archive', () => {
    it('sets isArchived to true and saves', async () => {
      const existing = { id: 'obj-1', slug: 'vehicles', isArchived: false };
      mockObjectRepo.findOne.mockResolvedValue(existing);
      await service.archive('tenant-1', 'vehicles');
      expect(existing.isArchived).toBe(true);
      expect(mockObjectRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isArchived: true }));
    });
  });

  describe('addAttribute', () => {
    it('adds an attribute definition to object', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'obj-1', slug: 'vehicles' });
      mockAttrRepo.findOne.mockResolvedValue(null);
      const res = await service.addAttribute('tenant-1', 'vehicles', {
        name: 'VIN',
        slug: 'vin',
        type: 'text',
      });
      expect(res.slug).toBe('vin');
      expect(mockAttrRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ objectId: 'obj-1', slug: 'vin', tenantId: 'tenant-1' }),
      );
    });

    it('throws ConflictException if attribute slug already exists', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'obj-1', slug: 'vehicles' });
      mockAttrRepo.findOne.mockResolvedValue({ id: 'attr-exist', slug: 'vin' });
      await expect(
        service.addAttribute('tenant-1', 'vehicles', {
          name: 'VIN',
          slug: 'vin',
          type: 'text',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateAttribute', () => {
    it('updates an existing attribute', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'obj-1', slug: 'vehicles' });
      const attr = { id: 'attr-1', objectId: 'obj-1', slug: 'vin', name: 'VIN' };
      mockAttrRepo.findOne.mockResolvedValue(attr);
      const res = await service.updateAttribute('tenant-1', 'vehicles', 'vin', { name: 'Vehicle Identification Number' });
      expect(res.name).toBe('Vehicle Identification Number');
      expect(mockAttrRepo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException if attribute does not exist', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'obj-1', slug: 'vehicles' });
      mockAttrRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateAttribute('tenant-1', 'vehicles', 'missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAttribute', () => {
    it('soft deletes attribute', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'obj-1', slug: 'vehicles' });
      await service.deleteAttribute('tenant-1', 'vehicles', 'vin');
      expect(mockAttrRepo.softDelete).toHaveBeenCalledWith({ objectId: 'obj-1', slug: 'vin' });
    });
  });

  describe('addRelationship', () => {
    it('adds relationship to object', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'obj-1', slug: 'vehicles' });
      const res = await service.addRelationship('tenant-1', 'vehicles', {
        name: 'Assigned Driver',
        slug: 'assigned_driver',
        targetType: 'core_entity',
        targetCoreEntity: 'contact',
      });
      expect(res.slug).toBe('assigned_driver');
      expect(mockRelRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ sourceObjectId: 'obj-1', slug: 'assigned_driver', tenantId: 'tenant-1' }),
      );
    });
  });

  describe('deleteRelationship', () => {
    it('soft deletes relationship', async () => {
      mockObjectRepo.findOne.mockResolvedValue({ id: 'obj-1', slug: 'vehicles' });
      await service.deleteRelationship('tenant-1', 'vehicles', 'assigned_driver');
      expect(mockRelRepo.softDelete).toHaveBeenCalledWith({ sourceObjectId: 'obj-1', slug: 'assigned_driver' });
    });
  });
});
