import type { PermissionDomain, PermissionValues } from './domain';

/* ---------------- Suppliers ---------------- */

export const SUPPLIER_PERMISSIONS = {
  SUPPLIER_READ: 'supplier:read',
  SUPPLIER_CREATE: 'supplier:create',
  SUPPLIER_UPDATE: 'supplier:update',
  SUPPLIER_DELETE: 'supplier:delete',
  SUPPLIER_VIEW_COST: 'supplier:view_cost',
} as const;

type SupplierPermission = PermissionValues<typeof SUPPLIER_PERMISSIONS>;

export const suppliersDomain: PermissionDomain<SupplierPermission> = {
  key: 'supplier',
  label: 'Suppliers',
  permissions: SUPPLIER_PERMISSIONS,
  descriptions: {
    [SUPPLIER_PERMISSIONS.SUPPLIER_READ]: 'View suppliers and their materials',
    [SUPPLIER_PERMISSIONS.SUPPLIER_CREATE]: 'Create suppliers',
    [SUPPLIER_PERMISSIONS.SUPPLIER_UPDATE]: 'Edit suppliers and their price lists',
    [SUPPLIER_PERMISSIONS.SUPPLIER_DELETE]: 'Delete suppliers',
    [SUPPLIER_PERMISSIONS.SUPPLIER_VIEW_COST]:
      'See supplier unit costs. Without it the API strips cost from every response.',
  },
  groupPermissions: [
    SUPPLIER_PERMISSIONS.SUPPLIER_READ,
    SUPPLIER_PERMISSIONS.SUPPLIER_CREATE,
    SUPPLIER_PERMISSIONS.SUPPLIER_UPDATE,
    SUPPLIER_PERMISSIONS.SUPPLIER_DELETE,
    SUPPLIER_PERMISSIONS.SUPPLIER_VIEW_COST,
  ],
  grants: {
    admin: [
      SUPPLIER_PERMISSIONS.SUPPLIER_READ,
      SUPPLIER_PERMISSIONS.SUPPLIER_CREATE,
      SUPPLIER_PERMISSIONS.SUPPLIER_UPDATE,
      SUPPLIER_PERMISSIONS.SUPPLIER_DELETE,
      SUPPLIER_PERMISSIONS.SUPPLIER_VIEW_COST,
    ],
    manager: [
      SUPPLIER_PERMISSIONS.SUPPLIER_READ,
      SUPPLIER_PERMISSIONS.SUPPLIER_CREATE,
      SUPPLIER_PERMISSIONS.SUPPLIER_UPDATE,
      SUPPLIER_PERMISSIONS.SUPPLIER_VIEW_COST,
    ],
    member: [SUPPLIER_PERMISSIONS.SUPPLIER_READ],
    viewer: [SUPPLIER_PERMISSIONS.SUPPLIER_READ],
  },
};

/* ---------------- Purchase orders ---------------- */

export const PURCHASE_ORDER_PERMISSIONS = {
  PURCHASE_ORDER_READ: 'purchase_order:read',
  PURCHASE_ORDER_CREATE: 'purchase_order:create',
  PURCHASE_ORDER_UPDATE: 'purchase_order:update',
  PURCHASE_ORDER_DELETE: 'purchase_order:delete',
  PURCHASE_ORDER_APPROVE: 'purchase_order:approve',
  PURCHASE_ORDER_APPROVE_ABOVE_THRESHOLD: 'purchase_order:approve_above_threshold',
} as const;

type PurchaseOrderPermission = PermissionValues<typeof PURCHASE_ORDER_PERMISSIONS>;

export const purchaseOrdersDomain: PermissionDomain<PurchaseOrderPermission> = {
  key: 'purchase_order',
  label: 'Purchase orders',
  permissions: PURCHASE_ORDER_PERMISSIONS,
  descriptions: {
    [PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_READ]: 'View purchase orders',
    [PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_CREATE]: 'Raise draft purchase orders',
    [PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_UPDATE]:
      'Edit draft purchase orders and submit them for approval',
    [PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_DELETE]: 'Cancel purchase orders',
    [PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_APPROVE]:
      'Approve purchase orders up to the tenant approval threshold',
    [PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_APPROVE_ABOVE_THRESHOLD]:
      'Approve a purchase order whose total is above the approval threshold',
  },
  groupPermissions: [
    PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_READ,
    PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_CREATE,
    PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_UPDATE,
    PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_DELETE,
    PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_APPROVE,
    PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_APPROVE_ABOVE_THRESHOLD,
  ],
  grants: {
    admin: [
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_READ,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_CREATE,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_UPDATE,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_DELETE,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_APPROVE,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_APPROVE_ABOVE_THRESHOLD,
    ],
    manager: [
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_READ,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_CREATE,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_UPDATE,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_APPROVE,
    ],
    // Members can raise a draft but never approve it — the whole point of the
    // threshold is that raising and authorising are different acts.
    member: [
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_READ,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_CREATE,
      PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_UPDATE,
    ],
    viewer: [PURCHASE_ORDER_PERMISSIONS.PURCHASE_ORDER_READ],
  },
};
