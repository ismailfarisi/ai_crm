import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { createCustomRecordLinkSchema, PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import { RecordLinksController } from './record-links.controller';

describe('RecordLinksController', () => {
  let controller: RecordLinksController;
  let mockBridgeService: any;

  beforeEach(() => {
    mockBridgeService = {
      getReverseLinksForCoreEntity: jest.fn().mockResolvedValue([{ id: 'link-1' }]),
      link: jest.fn().mockResolvedValue({ id: 'link-1' }),
      unlink: jest.fn().mockResolvedValue(undefined),
    };
    controller = new RecordLinksController(mockBridgeService);
  });

  it('delegates getReverseLinks to bridgeService with tenant context and the actor', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: [] };
    const result = await controller.getReverseLinks(user, 'customer', 'cust-1');

    expect(mockBridgeService.getReverseLinksForCoreEntity).toHaveBeenCalledWith(
      'tenant-1',
      'customer',
      'cust-1',
      user,
    );
    expect(result).toEqual([{ id: 'link-1' }]);
  });

  it('delegates createLink to bridgeService with the actor', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: [] };
    const body = { relationshipId: 'rel-1', sourceRecordId: 'rec-1', targetRecordId: 'cust-1' };
    const result = await controller.createLink(user, body);

    expect(mockBridgeService.link).toHaveBeenCalledWith('tenant-1', body, user);
    expect(result).toEqual({ id: 'link-1' });
  });

  it('validates the createLink body with the shared zod schema', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, RecordLinksController, 'createLink');
    const schemas = Object.values(args ?? {}).flatMap((arg: any) =>
      (arg.pipes ?? []).map((pipe: any) => pipe.schema),
    );
    expect(schemas).toContain(createCustomRecordLinkSchema);
  });

  it('requires custom_record permissions from the shared catalog on every route', () => {
    const proto = RecordLinksController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.getReverseLinks)).toEqual([
      PERMISSIONS.CUSTOM_RECORD_READ,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.createLink)).toEqual([
      PERMISSIONS.CUSTOM_RECORD_UPDATE,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.deleteLink)).toEqual([
      PERMISSIONS.CUSTOM_RECORD_UPDATE,
    ]);
  });

  it('delegates deleteLink to bridgeService with the actor', async () => {
    const user = { organizationId: 'tenant-1', id: 'u-1', permissions: [] };
    await controller.deleteLink(user, 'link-1');

    expect(mockBridgeService.unlink).toHaveBeenCalledWith('tenant-1', 'link-1', user);
  });
});
