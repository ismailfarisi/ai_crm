import type { PermissionDomain, PermissionValues } from './domain';

export const INVENTORY_PERMISSIONS = {
  INVENTORY_READ: 'inventory:read',
  INVENTORY_ADJUST: 'inventory:adjust',
  GOODS_RECEIPT_CREATE: 'goods_receipt:create',
} as const;

type InventoryPermission = PermissionValues<typeof INVENTORY_PERMISSIONS>;

export const inventoryDomain: PermissionDomain<InventoryPermission> = {
  key: 'inventory',
  label: 'Inventory',
  permissions: INVENTORY_PERMISSIONS,
  descriptions: {
    [INVENTORY_PERMISSIONS.INVENTORY_READ]: 'View stock on hand and reorder suggestions',
    [INVENTORY_PERMISSIONS.INVENTORY_ADJUST]:
      'Correct stock quantities by hand, after a count or a write-off',
    [INVENTORY_PERMISSIONS.GOODS_RECEIPT_CREATE]:
      'Book in deliveries against a purchase order',
  },
  groupPermissions: [
    INVENTORY_PERMISSIONS.INVENTORY_READ,
    INVENTORY_PERMISSIONS.GOODS_RECEIPT_CREATE,
    INVENTORY_PERMISSIONS.INVENTORY_ADJUST,
  ],
  grants: {
    admin: [
      INVENTORY_PERMISSIONS.INVENTORY_READ,
      INVENTORY_PERMISSIONS.INVENTORY_ADJUST,
      INVENTORY_PERMISSIONS.GOODS_RECEIPT_CREATE,
    ],
    manager: [
      INVENTORY_PERMISSIONS.INVENTORY_READ,
      INVENTORY_PERMISSIONS.INVENTORY_ADJUST,
      INVENTORY_PERMISSIONS.GOODS_RECEIPT_CREATE,
    ],
    // Whoever is on the loading bay books deliveries in; correcting a count
    // afterwards is a different, more consequential act.
    member: [
      INVENTORY_PERMISSIONS.INVENTORY_READ,
      INVENTORY_PERMISSIONS.GOODS_RECEIPT_CREATE,
    ],
    viewer: [INVENTORY_PERMISSIONS.INVENTORY_READ],
  },
};
