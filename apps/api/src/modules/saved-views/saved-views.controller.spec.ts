import { Test, TestingModule } from '@nestjs/testing';
import { SavedViewsController } from './saved-views.controller';
import { SavedViewsService } from './saved-views.service';

describe('SavedViewsController', () => {
  let controller: SavedViewsController;
  let service: jest.Mocked<Partial<SavedViewsService>>;

  const mockUser: any = {
    userId: 'user-1',
    organizationId: 'tenant-1',
    roles: ['member'],
    permissions: [],
  };

  beforeEach(async () => {
    service = {
      findAccessible: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'view-1' } as any),
      update: jest.fn().mockResolvedValue({ id: 'view-1' } as any),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SavedViewsController],
      providers: [{ provide: SavedViewsService, useValue: service }],
    }).compile();

    controller = module.get<SavedViewsController>(SavedViewsController);
  });

  it('lists views for entityType', async () => {
    await controller.list(mockUser, 'quotes');
    expect(service.findAccessible).toHaveBeenCalledWith('tenant-1', 'user-1', 'quotes');
  });

  it('creates view', async () => {
    const payload = { entityType: 'quotes', name: 'Test', viewType: 'table' as const };
    await controller.create(mockUser, payload as any);
    expect(service.create).toHaveBeenCalledWith('tenant-1', 'user-1', payload);
  });

  it('updates view for regular user', async () => {
    const payload = { name: 'Updated' };
    await controller.update(mockUser, 'view-1', payload as any);
    expect(service.update).toHaveBeenCalledWith('tenant-1', 'user-1', 'view-1', payload, false);
  });

  it('updates view with isAdmin true for admin/owner', async () => {
    const adminUser = { ...mockUser, roles: ['admin'] };
    const payload = { name: 'Updated' };
    await controller.update(adminUser, 'view-1', payload as any);
    expect(service.update).toHaveBeenCalledWith('tenant-1', 'user-1', 'view-1', payload, true);
  });

  it('deletes view for regular user', async () => {
    await controller.delete(mockUser, 'view-1');
    expect(service.delete).toHaveBeenCalledWith('tenant-1', 'user-1', 'view-1', false);
  });

  it('deletes view with isAdmin true for admin/owner', async () => {
    const ownerUser = { ...mockUser, roles: ['owner'] };
    await controller.delete(ownerUser, 'view-1');
    expect(service.delete).toHaveBeenCalledWith('tenant-1', 'user-1', 'view-1', true);
  });

  it('handles user object with id property instead of userId', async () => {
    const userWithIdOnly: any = {
      id: 'user-2',
      organizationId: 'tenant-1',
      roles: ['member'],
    };
    await controller.list(userWithIdOnly, 'contacts');
    expect(service.findAccessible).toHaveBeenCalledWith('tenant-1', 'user-2', 'contacts');
  });
});
