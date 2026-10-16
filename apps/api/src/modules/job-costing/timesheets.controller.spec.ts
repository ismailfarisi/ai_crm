import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import { TimesheetsController } from './timesheets.controller';

const route = (name: keyof TimesheetsController) => {
  const handler = TimesheetsController.prototype[name];
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler),
    path: Reflect.getMetadata(PATH_METADATA, handler),
    permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler),
    code: Reflect.getMetadata(HTTP_CODE_METADATA, handler),
  };
};

describe('TimesheetsController', () => {
  it('is mounted at /timesheets', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TimesheetsController)).toBe(
      'timesheets',
    );
  });

  it.each([
    ['list', '/'],
    ['crew', 'crew'],
    ['employees', 'employees'],
    ['operations', 'operations'],
  ] as const)('GET %s needs timesheet:read', (name, path) => {
    expect(route(name)).toMatchObject({
      method: RequestMethod.GET,
      path,
      permissions: [PERMISSIONS.TIMESHEET_READ],
    });
  });

  it.each([
    ['create', RequestMethod.POST, '/', undefined],
    ['bulk', RequestMethod.POST, 'bulk', HttpStatus.OK],
    ['update', RequestMethod.PATCH, ':id', undefined],
    ['remove', RequestMethod.DELETE, ':id', HttpStatus.NO_CONTENT],
  ] as const)('%s needs timesheet:manage', (name, method, path, code) => {
    expect(route(name)).toMatchObject({
      method,
      path,
      permissions: [PERMISSIONS.TIMESHEET_MANAGE],
      code,
    });
  });

  it('passes the caller’s tenant and id to the service', async () => {
    const service: any = {
      bulk: jest.fn(async () => []),
      remove: jest.fn(async () => undefined),
    };
    const controller = new TimesheetsController(service);
    const user = { organizationId: 'tenant-1', id: 'user-1' } as any;
    const body = { upserts: [], deletes: ['e-1'] };
    await controller.bulk(user, body);
    expect(service.bulk).toHaveBeenCalledWith('tenant-1', 'user-1', body);
    await controller.remove(user, 'e-1');
    expect(service.remove).toHaveBeenCalledWith('tenant-1', 'e-1');
  });
});
