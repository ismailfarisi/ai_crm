import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import { PayrollRunsController } from './payroll-runs.controller';

describe('PayrollRunsController', () => {
  it('DELETE /payroll-runs/:id needs payroll:manage and calls remove for the caller’s tenant', async () => {
    const handler = PayrollRunsController.prototype.remove;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.DELETE,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      PERMISSIONS.PAYROLL_MANAGE,
    ]);

    const runs: any = { remove: jest.fn(async () => undefined) };
    const controller = new PayrollRunsController(runs, {} as any);
    await controller.remove({ organizationId: 'tenant-1' } as any, 'run-1');
    expect(runs.remove).toHaveBeenCalledWith('tenant-1', 'run-1');
  });
});
