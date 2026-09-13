import type { PermissionDomain, PermissionValues } from './domain';

/* ---------------- Quotes ---------------- */

export const QUOTE_PERMISSIONS = {
  QUOTE_CREATE: 'quote:create',
  QUOTE_READ: 'quote:read',
  QUOTE_UPDATE: 'quote:update',
  QUOTE_APPROVE: 'quote:approve',
  QUOTE_VIEW_COST: 'quote:view_cost',
  QUOTE_APPROVE_BELOW_MARGIN: 'quote:approve_below_margin',
} as const;

type QuotePermission = PermissionValues<typeof QUOTE_PERMISSIONS>;

export const quotesDomain: PermissionDomain<QuotePermission> = {
  key: 'quote',
  label: 'Quotes',
  permissions: QUOTE_PERMISSIONS,
  descriptions: {
    [QUOTE_PERMISSIONS.QUOTE_CREATE]: 'Create quotes',
    [QUOTE_PERMISSIONS.QUOTE_READ]: 'View quotes',
    [QUOTE_PERMISSIONS.QUOTE_UPDATE]: 'Edit quotes',
    [QUOTE_PERMISSIONS.QUOTE_APPROVE]: 'Approve quotes',
    [QUOTE_PERMISSIONS.QUOTE_VIEW_COST]:
      'See cost and margin on quotes. Without it the API strips cost from every response.',
    [QUOTE_PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN]:
      'Approve a quote that breaks the margin floor or discount cap',
  },
  groupPermissions: [
    QUOTE_PERMISSIONS.QUOTE_READ,
    QUOTE_PERMISSIONS.QUOTE_CREATE,
    QUOTE_PERMISSIONS.QUOTE_UPDATE,
    QUOTE_PERMISSIONS.QUOTE_APPROVE,
    QUOTE_PERMISSIONS.QUOTE_VIEW_COST,
    QUOTE_PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN,
  ],
  grants: {
    admin: [
      QUOTE_PERMISSIONS.QUOTE_READ,
      QUOTE_PERMISSIONS.QUOTE_CREATE,
      QUOTE_PERMISSIONS.QUOTE_UPDATE,
      QUOTE_PERMISSIONS.QUOTE_APPROVE,
      QUOTE_PERMISSIONS.QUOTE_VIEW_COST,
      QUOTE_PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN,
    ],
    manager: [
      QUOTE_PERMISSIONS.QUOTE_READ,
      QUOTE_PERMISSIONS.QUOTE_CREATE,
      QUOTE_PERMISSIONS.QUOTE_UPDATE,
      QUOTE_PERMISSIONS.QUOTE_APPROVE,
      QUOTE_PERMISSIONS.QUOTE_VIEW_COST,
    ],
    member: [
      QUOTE_PERMISSIONS.QUOTE_READ,
      QUOTE_PERMISSIONS.QUOTE_CREATE,
      QUOTE_PERMISSIONS.QUOTE_UPDATE,
    ],
    viewer: [QUOTE_PERMISSIONS.QUOTE_READ],
  },
};

/* ---------------- Product catalog and costing model ---------------- */

export const CATALOG_PERMISSIONS = {
  CATALOG_READ: 'catalog:read',
  CATALOG_MANAGE: 'catalog:manage',
} as const;

type CatalogPermission = PermissionValues<typeof CATALOG_PERMISSIONS>;

export const catalogDomain: PermissionDomain<CatalogPermission> = {
  key: 'catalog',
  label: 'Product catalog',
  permissions: CATALOG_PERMISSIONS,
  descriptions: {
    [CATALOG_PERMISSIONS.CATALOG_READ]:
      'Browse catalog items and product templates when building a quote',
    [CATALOG_PERMISSIONS.CATALOG_MANAGE]:
      'Edit materials, work centres, tooling, catalog items and product templates',
  },
  groupPermissions: [CATALOG_PERMISSIONS.CATALOG_READ, CATALOG_PERMISSIONS.CATALOG_MANAGE],
  grants: {
    admin: [CATALOG_PERMISSIONS.CATALOG_READ, CATALOG_PERMISSIONS.CATALOG_MANAGE],
    manager: [CATALOG_PERMISSIONS.CATALOG_READ],
    member: [CATALOG_PERMISSIONS.CATALOG_READ],
  },
};

/* ---------------- Invoices ---------------- */

export const INVOICE_PERMISSIONS = {
  INVOICE_READ: 'invoice:read',
  INVOICE_MANAGE: 'invoice:manage',
} as const;

type InvoicePermission = PermissionValues<typeof INVOICE_PERMISSIONS>;

export const invoicesDomain: PermissionDomain<InvoicePermission> = {
  key: 'invoice',
  label: 'Invoices',
  permissions: INVOICE_PERMISSIONS,
  descriptions: {
    [INVOICE_PERMISSIONS.INVOICE_READ]: 'View invoices',
    [INVOICE_PERMISSIONS.INVOICE_MANAGE]: 'Mark invoices as paid and send them to customers',
  },
  groupPermissions: [INVOICE_PERMISSIONS.INVOICE_READ, INVOICE_PERMISSIONS.INVOICE_MANAGE],
  grants: {
    admin: [INVOICE_PERMISSIONS.INVOICE_READ, INVOICE_PERMISSIONS.INVOICE_MANAGE],
    manager: [INVOICE_PERMISSIONS.INVOICE_READ],
  },
};
