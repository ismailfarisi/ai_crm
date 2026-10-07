import { CustomRecordsController } from './custom-records.controller';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('CustomRecordsController', () => {
  let controller: CustomRecordsController;
  let service: any;

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getById: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      create: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      update: vi.fn().mockResolvedValue({ id: 'rec-1', values: { serial: '456' } }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    controller = new CustomRecordsController(service);
  });

  it('calls list with user context', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: ['custom_record:read'] };
    const query = { page: 1, limit: 10 };
    const res = await controller.list(user as any, 'machinery', query);

    expect(res.total).toBe(0);
    expect(service.list).toHaveBeenCalledWith('tenant-1', 'machinery', query, user);
  });

  it('calls create with user context', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: ['custom_record:create'] };
    const body = { values: { serial: '123' } };
    const res = await controller.create(user as any, 'machinery', body);

    expect(res.id).toBe('rec-1');
    expect(service.create).toHaveBeenCalledWith('tenant-1', 'machinery', body, user);
  });

  it('calls getById with user context', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: ['custom_record:read'] };
    const res = await controller.getById(user as any, 'machinery', 'rec-1');

    expect(res.id).toBe('rec-1');
    expect(service.getById).toHaveBeenCalledWith('tenant-1', 'machinery', 'rec-1', user);
  });

  it('calls update with user context', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: ['custom_record:update'] };
    const body = { values: { serial: '456' } };
    const res = await controller.update(user as any, 'machinery', 'rec-1', body);

    expect(res.id).toBe('rec-1');
    expect(service.update).toHaveBeenCalledWith('tenant-1', 'machinery', 'rec-1', body, user);
  });

  it('calls delete with user context', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: ['custom_record:delete'] };
    await controller.delete(user as any, 'machinery', 'rec-1');

    expect(service.delete).toHaveBeenCalledWith('tenant-1', 'machinery', 'rec-1', user);
  });
});
