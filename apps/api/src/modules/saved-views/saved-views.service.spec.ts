import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SavedViewsService } from './saved-views.service';
import { SavedView } from './entities/saved-view.entity';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';

describe('SavedViewsService', () => {
  let service: SavedViewsService;
  let mockRepo: any;

  const mockView: Partial<SavedView> = {
    id: 'view-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    entityType: 'quotes',
    name: 'Active Pipeline',
    viewType: 'kanban',
    isDefault: false,
    isShared: false,
    config: {},
  };

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'view-1', ...entity })),
      softRemove: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    mockRepo.manager = {
      transaction: jest.fn((cb: any) =>
        cb({ getRepository: () => mockRepo, query: jest.fn().mockResolvedValue([]) }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedViewsService,
        { provide: getRepositoryToken(SavedView), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<SavedViewsService>(SavedViewsService);
  });

  it('lists user private views plus shared organization views', async () => {
    mockRepo.find.mockResolvedValue([mockView]);
    const result = await service.findAccessible('tenant-1', 'user-1', 'quotes');
    expect(result).toHaveLength(1);
    expect(mockRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { tenantId: 'tenant-1', entityType: 'quotes', userId: 'user-1' },
          { tenantId: 'tenant-1', entityType: 'quotes', isShared: true },
        ],
      }),
    );
  });

  it('creates a saved view', async () => {
    const payload = {
      entityType: 'quotes',
      name: 'New View',
      viewType: 'table' as const,
      isDefault: false,
      isShared: false,
      config: {},
    };
    const result = await service.create('tenant-1', 'user-1', payload);
    expect(mockRepo.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      ...payload,
    });
    expect(result).toMatchObject({ id: 'view-1', name: 'New View' });
  });

  it('finds a view by id or throws NotFoundException', async () => {
    mockRepo.findOne.mockResolvedValue(mockView);
    const result = await service.findById('tenant-1', 'view-1');
    expect(result).toEqual(mockView);

    mockRepo.findOne.mockResolvedValue(null);
    await expect(
      service.findById('tenant-1', 'nonexistent'),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows owner to update view', async () => {
    mockRepo.findOne.mockResolvedValue({ ...mockView, userId: 'user-1' });
    const result = await service.update('tenant-1', 'user-1', 'view-1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('prevents non-owner non-admin from updating a private view', async () => {
    mockRepo.findOne.mockResolvedValue({ ...mockView, userId: 'other-user' });
    await expect(
      service.update('tenant-1', 'user-1', 'view-1', { name: 'Updated' }, false),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows admin to update another user view', async () => {
    mockRepo.findOne.mockResolvedValue({ ...mockView, userId: 'other-user' });
    const result = await service.update('tenant-1', 'user-1', 'view-1', { name: 'Updated by Admin' }, true);
    expect(result.name).toBe('Updated by Admin');
  });

  it('prevents non-owner non-admin from deleting a private view', async () => {
    mockRepo.findOne.mockResolvedValue({ ...mockView, userId: 'other-user' });
    await expect(
      service.delete('tenant-1', 'user-1', 'view-1', false),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows admin to delete another user view', async () => {
    mockRepo.findOne.mockResolvedValue({ ...mockView, userId: 'other-user' });
    await expect(
      service.delete('tenant-1', 'user-1', 'view-1', true),
    ).resolves.toBeUndefined();
    expect(mockRepo.softRemove).toHaveBeenCalled();
  });

  describe('single default view per (tenant, user, entity)', () => {
    let mockManager: any;

    beforeEach(() => {
      mockRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      mockManager = {
        getRepository: jest.fn(() => mockRepo),
        query: jest.fn().mockResolvedValue([]),
      };
      mockRepo.manager = { transaction: jest.fn((cb: any) => cb(mockManager)) };
    });

    const lockKeys = () =>
      mockManager.query.mock.calls
        .filter(([sql]: [string]) => /pg_advisory_xact_lock/.test(sql))
        .map(([, params]: [string, string[]]) => params[0]);

    it('creating a default view clears the previous default in the same transaction', async () => {
      await service.create('tenant-1', 'user-1', {
        entityType: 'quotes',
        name: 'Mine',
        viewType: 'table',
        isDefault: true,
        isShared: false,
        config: {},
      });

      expect(mockRepo.manager.transaction).toHaveBeenCalled();
      expect(lockKeys()).toEqual(['saved_view_default:tenant-1:user-1:quotes']);
      expect(mockRepo.update).toHaveBeenCalledWith(
        { tenantId: 'tenant-1', userId: 'user-1', entityType: 'quotes', isDefault: true },
        { isDefault: false },
      );
      const clearOrder = mockRepo.update.mock.invocationCallOrder[0];
      const saveOrder = mockRepo.save.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(saveOrder);
    });

    it('creating a non-default view leaves other defaults alone', async () => {
      await service.create('tenant-1', 'user-1', {
        entityType: 'quotes',
        name: 'Mine',
        viewType: 'table',
        isDefault: false,
        isShared: false,
        config: {},
      });
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it("setting a view as default clears the owner's other default for that entity, excluding itself", async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockView, userId: 'owner-1' });

      await service.update('tenant-1', 'admin-1', 'view-1', { isDefault: true }, true);

      expect(lockKeys()).toEqual(['saved_view_default:tenant-1:owner-1:quotes']);
      expect(mockRepo.update).toHaveBeenCalledWith(
        {
          tenantId: 'tenant-1',
          userId: 'owner-1',
          entityType: 'quotes',
          isDefault: true,
          id: expect.anything(),
        },
        { isDefault: false },
      );
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
    });

    it('maps a racing duplicate default (unique index) to a 409', async () => {
      mockRepo.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
      await expect(
        service.create('tenant-1', 'user-1', {
          entityType: 'quotes',
          name: 'Mine',
          viewType: 'table',
          isDefault: true,
          isShared: false,
          config: {},
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
