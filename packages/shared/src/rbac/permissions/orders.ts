import type { PermissionDomain, PermissionValues } from './domain';

export const SALES_ORDER_PERMISSIONS = {
  SALES_ORDER_READ: 'sales_order:read',
  SALES_ORDER_UPDATE: 'sales_order:update',
  SALES_ORDER_INVOICE: 'sales_order:invoice',
  SALES_ORDER_CANCEL: 'sales_order:cancel',
} as const;

type SalesOrderPermission = PermissionValues<typeof SALES_ORDER_PERMISSIONS>;

export const salesOrdersDomain: PermissionDomain<SalesOrderPermission> = {
  key: 'sales_order',
  label: 'Sales orders',
  permissions: SALES_ORDER_PERMISSIONS,
  descriptions: {
    [SALES_ORDER_PERMISSIONS.SALES_ORDER_READ]: 'View sales orders and what has been billed against them',
    [SALES_ORDER_PERMISSIONS.SALES_ORDER_UPDATE]: 'Move orders through production and fulfilment',
    [SALES_ORDER_PERMISSIONS.SALES_ORDER_INVOICE]: 'Raise the next staged invoice on an order',
    [SALES_ORDER_PERMISSIONS.SALES_ORDER_CANCEL]: 'Cancel an order that has not been invoiced',
  },
  groupPermissions: [
    SALES_ORDER_PERMISSIONS.SALES_ORDER_READ,
    SALES_ORDER_PERMISSIONS.SALES_ORDER_UPDATE,
    SALES_ORDER_PERMISSIONS.SALES_ORDER_INVOICE,
    SALES_ORDER_PERMISSIONS.SALES_ORDER_CANCEL,
  ],
  grants: {
    admin: Object.values(SALES_ORDER_PERMISSIONS),
    manager: Object.values(SALES_ORDER_PERMISSIONS),
    member: [SALES_ORDER_PERMISSIONS.SALES_ORDER_READ, SALES_ORDER_PERMISSIONS.SALES_ORDER_UPDATE],
    viewer: [SALES_ORDER_PERMISSIONS.SALES_ORDER_READ],
  },
};
