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

  it('delegates getReverseLinks to bridgeService with tenant context', async () => {
    const user = { organizationId: 'tenant-1' };
    const result = await controller.getReverseLinks(user, 'customer', 'cust-1');

    expect(mockBridgeService.getReverseLinksForCoreEntity).toHaveBeenCalledWith(
      'tenant-1',
      'customer',
      'cust-1',
    );
    expect(result).toEqual([{ id: 'link-1' }]);
  });

  it('delegates createLink to bridgeService', async () => {
    const user = { organizationId: 'tenant-1' };
    const body = { relationshipId: 'rel-1', sourceRecordId: 'rec-1', targetRecordId: 'cust-1' };
    const result = await controller.createLink(user, body);

    expect(mockBridgeService.link).toHaveBeenCalledWith('tenant-1', body);
    expect(result).toEqual({ id: 'link-1' });
  });

  it('delegates deleteLink to bridgeService', async () => {
    const user = { organizationId: 'tenant-1' };
    await controller.deleteLink(user, 'link-1');

    expect(mockBridgeService.unlink).toHaveBeenCalledWith('tenant-1', 'link-1');
  });
});
