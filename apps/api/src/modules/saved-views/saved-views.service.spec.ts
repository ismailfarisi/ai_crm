import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SavedViewsService } from './saved-views.service';
import { SavedView } from './entities/saved-view.entity';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

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
});
