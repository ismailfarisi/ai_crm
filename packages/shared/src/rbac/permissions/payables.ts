import type { PermissionDomain, PermissionValues } from './domain';

export const BILL_PERMISSIONS = {
  BILL_READ: 'bill:read',
  BILL_CREATE: 'bill:create',
  BILL_UPDATE: 'bill:update',
  BILL_APPROVE: 'bill:approve',
  BILL_APPROVE_VARIANCE: 'bill:approve_variance',
  BILL_PAY: 'bill:pay',
} as const;

type BillPermission = PermissionValues<typeof BILL_PERMISSIONS>;

export const billsDomain: PermissionDomain<BillPermission> = {
  key: 'bill',
  label: 'Supplier bills',
  permissions: BILL_PERMISSIONS,
  descriptions: {
    [BILL_PERMISSIONS.BILL_READ]: 'View supplier bills and what is owed',
    [BILL_PERMISSIONS.BILL_CREATE]: 'Enter supplier bills',
    [BILL_PERMISSIONS.BILL_UPDATE]: 'Edit, dispute and cancel bills that have not been approved',
    [BILL_PERMISSIONS.BILL_APPROVE]: 'Approve bills that match their order and receipt',
    [BILL_PERMISSIONS.BILL_APPROVE_VARIANCE]:
      'Approve a bill that bills more than was received, or at a price outside tolerance',
    [BILL_PERMISSIONS.BILL_PAY]: 'Record payments against approved bills',
  },
  groupPermissions: [
    BILL_PERMISSIONS.BILL_READ,
    BILL_PERMISSIONS.BILL_CREATE,
    BILL_PERMISSIONS.BILL_UPDATE,
    BILL_PERMISSIONS.BILL_APPROVE,
    BILL_PERMISSIONS.BILL_APPROVE_VARIANCE,
    BILL_PERMISSIONS.BILL_PAY,
  ],
  grants: {
    admin: Object.values(BILL_PERMISSIONS),
    // Managers can approve a clean match but not a variance, and cannot pay:
    // approving and paying are deliberately separate hands.
    manager: [
      BILL_PERMISSIONS.BILL_READ,
      BILL_PERMISSIONS.BILL_CREATE,
      BILL_PERMISSIONS.BILL_UPDATE,
      BILL_PERMISSIONS.BILL_APPROVE,
    ],
    member: [BILL_PERMISSIONS.BILL_READ, BILL_PERMISSIONS.BILL_CREATE],
    viewer: [BILL_PERMISSIONS.BILL_READ],
  },
};
