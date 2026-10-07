import { CustomObjectsController } from './custom-objects.controller';
import { CustomObjectsService } from '../services/custom-objects.service';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('CustomObjectsController', () => {
  let controller: CustomObjectsController;
  let service: CustomObjectsService;

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue([{ id: 'obj-1', slug: 'machinery' }]),
      getBySlug: vi.fn().mockResolvedValue({ id: 'obj-1', slug: 'machinery' }),
      create: vi.fn().mockResolvedValue({ id: 'obj-1', slug: 'machinery' }),
      update: vi.fn().mockResolvedValue({ id: 'obj-1', slug: 'machinery', name: 'Updated' }),
      archive: vi.fn().mockResolvedValue(undefined),
      addAttribute: vi.fn().mockResolvedValue({ id: 'attr-1', slug: 'serial' }),
      updateAttribute: vi.fn().mockResolvedValue({ id: 'attr-1', slug: 'serial', name: 'Updated Serial' }),
      deleteAttribute: vi.fn().mockResolvedValue(undefined),
      addRelationship: vi.fn().mockResolvedValue({ id: 'rel-1', slug: 'operator' }),
      deleteRelationship: vi.fn().mockResolvedValue(undefined),
    } as any;
    controller = new CustomObjectsController(service);
  });

  it('lists custom objects for tenant', async () => {
    const res = await controller.list({ organizationId: 'tenant-1' } as any);
    expect(res).toHaveLength(1);
    expect(res[0].slug).toBe('machinery');
    expect(service.list).toHaveBeenCalledWith('tenant-1');
  });

  it('creates custom object', async () => {
    const body = { name: 'Machinery', slug: 'machinery' };
    const res = await controller.create({ organizationId: 'tenant-1' } as any, body);
    expect(res.slug).toBe('machinery');
    expect(service.create).toHaveBeenCalledWith('tenant-1', body);
  });

  it('gets custom object by slug', async () => {
    const res = await controller.getBySlug({ organizationId: 'tenant-1' } as any, 'machinery');
    expect(res.slug).toBe('machinery');
    expect(service.getBySlug).toHaveBeenCalledWith('tenant-1', 'machinery');
  });

  it('updates custom object', async () => {
    const body = { name: 'Updated' };
    const res = await controller.update({ organizationId: 'tenant-1' } as any, 'machinery', body);
    expect(res.name).toBe('Updated');
    expect(service.update).toHaveBeenCalledWith('tenant-1', 'machinery', body);
  });

  it('archives custom object', async () => {
    await controller.archive({ organizationId: 'tenant-1' } as any, 'machinery');
    expect(service.archive).toHaveBeenCalledWith('tenant-1', 'machinery');
  });

  it('adds attribute', async () => {
    const body = { name: 'Serial', slug: 'serial', type: 'text' };
    const res = await controller.addAttribute({ organizationId: 'tenant-1' } as any, 'machinery', body);
    expect(res.slug).toBe('serial');
    expect(service.addAttribute).toHaveBeenCalledWith('tenant-1', 'machinery', body);
  });

  it('updates attribute', async () => {
    const body = { name: 'Updated Serial' };
    const res = await controller.updateAttribute({ organizationId: 'tenant-1' } as any, 'machinery', 'serial', body);
    expect(res.name).toBe('Updated Serial');
    expect(service.updateAttribute).toHaveBeenCalledWith('tenant-1', 'machinery', 'serial', body);
  });

  it('deletes attribute', async () => {
    await controller.deleteAttribute({ organizationId: 'tenant-1' } as any, 'machinery', 'serial');
    expect(service.deleteAttribute).toHaveBeenCalledWith('tenant-1', 'machinery', 'serial');
  });

  it('adds relationship', async () => {
    const body = { name: 'Operator', slug: 'operator', targetType: 'core_entity', targetCoreEntity: 'contact' };
    const res = await controller.addRelationship({ organizationId: 'tenant-1' } as any, 'machinery', body);
    expect(res.slug).toBe('operator');
    expect(service.addRelationship).toHaveBeenCalledWith('tenant-1', 'machinery', body);
  });

  it('deletes relationship', async () => {
    await controller.deleteRelationship({ organizationId: 'tenant-1' } as any, 'machinery', 'operator');
    expect(service.deleteRelationship).toHaveBeenCalledWith('tenant-1', 'machinery', 'operator');
  });
});
