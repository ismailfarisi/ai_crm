import type { PermissionDomain, PermissionValues } from './domain';

export const CREDIT_NOTE_PERMISSIONS = {
  CREDIT_NOTE_READ: 'credit_note:read',
  CREDIT_NOTE_CREATE: 'credit_note:create',
  CREDIT_NOTE_APPROVE: 'credit_note:approve',
  CREDIT_NOTE_REFUND: 'credit_note:refund',
} as const;

export const DELIVERY_NOTE_PERMISSIONS = {
  DELIVERY_NOTE_READ: 'delivery_note:read',
  DELIVERY_NOTE_CREATE: 'delivery_note:create',
  DELIVERY_NOTE_DISPATCH: 'delivery_note:dispatch',
} as const;

export const TAX_PERMISSIONS = {
  TAX_READ: 'tax:read',
  TAX_MANAGE: 'tax:manage',
} as const;

type CreditNotePermission = PermissionValues<typeof CREDIT_NOTE_PERMISSIONS>;
type DeliveryNotePermission = PermissionValues<typeof DELIVERY_NOTE_PERMISSIONS>;
type TaxPermission = PermissionValues<typeof TAX_PERMISSIONS>;

export const creditNotesDomain: PermissionDomain<CreditNotePermission> = {
  key: 'credit_note',
  label: 'Credit notes',
  permissions: CREDIT_NOTE_PERMISSIONS,
  descriptions: {
    [CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_READ]: 'View credit notes and refunds',
    [CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_CREATE]: 'Draft credit notes against invoices',
    [CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_APPROVE]:
      'Issue a credit note, reducing what the customer owes and posting it',
    [CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_REFUND]: 'Pay money back to a customer who is owed it',
  },
  groupPermissions: Object.values(CREDIT_NOTE_PERMISSIONS),
  grants: {
    admin: Object.values(CREDIT_NOTE_PERMISSIONS),
    // Drafting a credit and issuing it are separate hands, as with bills.
    manager: [
      CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_READ,
      CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_CREATE,
      CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_APPROVE,
    ],
    member: [CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_READ, CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_CREATE],
    viewer: [CREDIT_NOTE_PERMISSIONS.CREDIT_NOTE_READ],
  },
};

export const deliveryNotesDomain: PermissionDomain<DeliveryNotePermission> = {
  key: 'delivery_note',
  label: 'Deliveries',
  permissions: DELIVERY_NOTE_PERMISSIONS,
  descriptions: {
    [DELIVERY_NOTE_PERMISSIONS.DELIVERY_NOTE_READ]: 'View delivery notes and packing slips',
    [DELIVERY_NOTE_PERMISSIONS.DELIVERY_NOTE_CREATE]: 'Prepare deliveries from sales orders',
    [DELIVERY_NOTE_PERMISSIONS.DELIVERY_NOTE_DISPATCH]:
      'Dispatch a delivery: takes stocked goods off the shelf and records what shipped',
  },
  groupPermissions: Object.values(DELIVERY_NOTE_PERMISSIONS),
  grants: {
    admin: Object.values(DELIVERY_NOTE_PERMISSIONS),
    manager: Object.values(DELIVERY_NOTE_PERMISSIONS),
    member: Object.values(DELIVERY_NOTE_PERMISSIONS),
    viewer: [DELIVERY_NOTE_PERMISSIONS.DELIVERY_NOTE_READ],
  },
};

export const taxDomain: PermissionDomain<TaxPermission> = {
  key: 'tax',
  label: 'Tax',
  permissions: TAX_PERMISSIONS,
  descriptions: {
    [TAX_PERMISSIONS.TAX_READ]: 'View tax codes and the tax report',
    [TAX_PERMISSIONS.TAX_MANAGE]:
      'Change tax codes and the rules that choose them. Affects every quote priced after the change.',
  },
  groupPermissions: Object.values(TAX_PERMISSIONS),
  grants: {
    admin: Object.values(TAX_PERMISSIONS),
    manager: [TAX_PERMISSIONS.TAX_READ],
  },
};
