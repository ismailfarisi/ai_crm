/**
 * The single source of truth for every permission in the system.
 *
 * A permission is `<subject>:<action>`. The API seeds this catalog into the
 * `permissions` table on boot, guards check against it, and the web app uses it
 * to hide UI the current user cannot act on. Add a permission here first —
 * nothing else should invent permission strings.
 *
 * The catalog is assembled from one file per feature area (see `domain.ts`)
 * rather than held in one list, so that two feature branches adding
 * permissions at the same time do not edit the same lines. Adding a feature
 * area is: write `<area>.ts`, then add three lines below — an import, a spread
 * into `PERMISSIONS`, and an entry in `PERMISSION_DOMAINS`.
 *
 * Order matters in one direction only: `PERMISSION_DOMAINS` drives the order
 * of sections in the role editor.
 */
import type { PermissionDomain } from './domain';
import { orgDomain, usersDomain, rolesDomain, ORG_PERMISSIONS, USER_PERMISSIONS, ROLE_PERMISSIONS } from './organization';
import { contactsDomain, customersDomain, CONTACT_PERMISSIONS, CUSTOMER_PERMISSIONS } from './crm';
import { quotesDomain, catalogDomain, invoicesDomain, QUOTE_PERMISSIONS, CATALOG_PERMISSIONS, INVOICE_PERMISSIONS } from './sales';
import { channelsDomain, emailDomain, CHANNEL_PERMISSIONS, EMAIL_PERMISSIONS } from './comms';
import { automationsDomain, AUTOMATION_PERMISSIONS } from './automations';
import { financeDomain, FINANCE_PERMISSIONS } from './finance';
import { aiDomain, AI_PERMISSIONS } from './ai';
import {
  suppliersDomain,
  purchaseOrdersDomain,
  SUPPLIER_PERMISSIONS,
  PURCHASE_ORDER_PERMISSIONS,
} from './purchasing';
import { inventoryDomain, INVENTORY_PERMISSIONS } from './inventory';
import { billsDomain, BILL_PERMISSIONS } from './payables';
import { salesOrdersDomain, SALES_ORDER_PERMISSIONS } from './orders';
import { workOrdersDomain, WORK_ORDER_PERMISSIONS } from './production';
import {
  creditNotesDomain,
  deliveryNotesDomain,
  taxDomain,
  CREDIT_NOTE_PERMISSIONS,
  DELIVERY_NOTE_PERMISSIONS,
  TAX_PERMISSIONS,
} from './credits';

export type { PermissionDomain, PermissionValues } from './domain';

/**
 * Only the domain objects are re-exported, not the raw `*_PERMISSIONS`
 * constants behind them. Those are an implementation detail — every consumer
 * reads `PERMISSIONS.X` — and two of the names (`AUTOMATION_PERMISSIONS`,
 * `FINANCE_PERMISSIONS`) are already taken at the package barrel by
 * `automations/types.ts` and `finance/types.ts`, which each keep a second copy
 * of the same permission strings.
 */
export {
  orgDomain,
  usersDomain,
  rolesDomain,
  contactsDomain,
  customersDomain,
  quotesDomain,
  catalogDomain,
  invoicesDomain,
  channelsDomain,
  emailDomain,
  automationsDomain,
  financeDomain,
  aiDomain,
  suppliersDomain,
  purchaseOrdersDomain,
  inventoryDomain,
  billsDomain,
  salesOrdersDomain,
  workOrdersDomain,
  creditNotesDomain,
  deliveryNotesDomain,
  taxDomain,
};

export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Every registered feature area, in role-editor order.
 *
 * Typed as `PermissionDomain[]` (the widened form) so domains with different
 * permission unions can share an array; the per-domain type parameter has
 * already done its job at the point each object was declared.
 */
export const PERMISSION_DOMAINS: PermissionDomain[] = [
  orgDomain,
  usersDomain,
  rolesDomain,
  contactsDomain,
  customersDomain,
  quotesDomain,
  catalogDomain,
  invoicesDomain,
  channelsDomain,
  emailDomain,
  automationsDomain,
  financeDomain,
  aiDomain,
  suppliersDomain,
  purchaseOrdersDomain,
  inventoryDomain,
  billsDomain,
  salesOrdersDomain,
  workOrdersDomain,
  creditNotesDomain,
  deliveryNotesDomain,
  taxDomain,
];

/**
 * Spread explicitly rather than reduced over `PERMISSION_DOMAINS`, because a
 * runtime fold would erase the literal types that make `PERMISSIONS.QUOTE_READ`
 * resolve to `'quote:read'` instead of `string`.
 */
export const PERMISSIONS = {
  ...ORG_PERMISSIONS,
  ...USER_PERMISSIONS,
  ...ROLE_PERMISSIONS,
  ...CONTACT_PERMISSIONS,
  ...CUSTOMER_PERMISSIONS,
  ...QUOTE_PERMISSIONS,
  ...CATALOG_PERMISSIONS,
  ...INVOICE_PERMISSIONS,
  ...CHANNEL_PERMISSIONS,
  ...EMAIL_PERMISSIONS,
  ...AUTOMATION_PERMISSIONS,
  ...FINANCE_PERMISSIONS,
  ...AI_PERMISSIONS,
  ...SUPPLIER_PERMISSIONS,
  ...PURCHASE_ORDER_PERMISSIONS,
  ...INVENTORY_PERMISSIONS,
  ...BILL_PERMISSIONS,
  ...SALES_ORDER_PERMISSIONS,
  ...WORK_ORDER_PERMISSIONS,
  ...CREDIT_NOTE_PERMISSIONS,
  ...DELIVERY_NOTE_PERMISSIONS,
  ...TAX_PERMISSIONS,
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/** Human-readable descriptions, used to seed the catalog and label the UI. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = Object.assign(
  {},
  ...PERMISSION_DOMAINS.map((domain) => domain.descriptions),
) as Record<Permission, string>;

/** Groups drive the layout of the role editor screen. */
export const PERMISSION_GROUPS: { key: string; label: string; permissions: Permission[] }[] =
  PERMISSION_DOMAINS.map((domain) => ({
    key: domain.key,
    label: domain.label,
    permissions: domain.groupPermissions as Permission[],
  }));

/**
 * The permissions each system role receives, collected from the domains.
 * Consumed by `roles.ts`; `owner` is absent by design — it holds everything.
 */
export function permissionsForSystemRole(slug: string): Permission[] {
  return PERMISSION_DOMAINS.flatMap(
    (domain) => (domain.grants[slug as keyof typeof domain.grants] ?? []) as Permission[],
  );
}

export function splitPermission(permission: Permission): { subject: string; action: string } {
  const [subject, action] = permission.split(':');
  return { subject, action };
}
