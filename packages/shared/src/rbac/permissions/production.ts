import type { PermissionDomain, PermissionValues } from './domain';

export const WORK_ORDER_PERMISSIONS = {
  WORK_ORDER_READ: 'work_order:read',
  WORK_ORDER_CREATE: 'work_order:create',
  WORK_ORDER_UPDATE: 'work_order:update',
  WORK_ORDER_EXECUTE: 'work_order:execute',
} as const;

type WorkOrderPermission = PermissionValues<typeof WORK_ORDER_PERMISSIONS>;

export const workOrdersDomain: PermissionDomain<WorkOrderPermission> = {
  key: 'work_order',
  label: 'Production',
  permissions: WORK_ORDER_PERMISSIONS,
  descriptions: {
    [WORK_ORDER_PERMISSIONS.WORK_ORDER_READ]: 'View work orders and the production board',
    [WORK_ORDER_PERMISSIONS.WORK_ORDER_CREATE]: 'Create work orders from sales orders',
    [WORK_ORDER_PERMISSIONS.WORK_ORDER_UPDATE]:
      'Release, complete and cancel work orders. Completing posts the job’s cost.',
    [WORK_ORDER_PERMISSIONS.WORK_ORDER_EXECUTE]:
      'Run jobs on the shop floor: start and stop operations, log time, issue material',
  },
  groupPermissions: [
    WORK_ORDER_PERMISSIONS.WORK_ORDER_READ,
    WORK_ORDER_PERMISSIONS.WORK_ORDER_CREATE,
    WORK_ORDER_PERMISSIONS.WORK_ORDER_UPDATE,
    WORK_ORDER_PERMISSIONS.WORK_ORDER_EXECUTE,
  ],
  grants: {
    admin: Object.values(WORK_ORDER_PERMISSIONS),
    manager: Object.values(WORK_ORDER_PERMISSIONS),
    // The shop floor runs jobs; it does not decide which jobs exist or close them.
    member: [WORK_ORDER_PERMISSIONS.WORK_ORDER_READ, WORK_ORDER_PERMISSIONS.WORK_ORDER_EXECUTE],
    viewer: [WORK_ORDER_PERMISSIONS.WORK_ORDER_READ],
  },
};
