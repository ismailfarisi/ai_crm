import { PERMISSIONS, type Permission } from '../rbac/permissions';

/**
 * Who a "Notify staff" step can reach as a group. A group is everyone who can
 * do a thing, not a named role: the same rule the built-in notifications use,
 * so an alert never lands on someone who could not act on it, and a custom
 * role with the right permission is included without being listed anywhere.
 */
export const AUTOMATION_NOTIFY_GROUPS = [
  {
    value: 'owners',
    label: 'Owners and admins',
    permission: PERMISSIONS.ORG_UPDATE,
  },
  {
    value: 'production',
    label: 'Production (people who manage jobs)',
    permission: PERMISSIONS.WORK_ORDER_UPDATE,
  },
  {
    value: 'purchasing',
    label: 'Buyers (people who raise purchase orders)',
    permission: PERMISSIONS.PURCHASE_ORDER_CREATE,
  },
  {
    value: 'sales',
    label: 'Sales (people who write quotes)',
    permission: PERMISSIONS.QUOTE_CREATE,
  },
  {
    value: 'accounts',
    label: 'Accounts (people who manage invoices)',
    permission: PERMISSIONS.INVOICE_MANAGE,
  },
  {
    value: 'inbox',
    label: 'Inbox (people who reply to customers)',
    permission: PERMISSIONS.CHANNEL_SEND,
  },
  {
    value: 'expense_approvers',
    label: 'People who approve expenses',
    permission: PERMISSIONS.EXPENSE_APPROVE,
  },
] as const satisfies readonly {
  value: string;
  label: string;
  permission: Permission;
}[];

export type AutomationNotifyGroup =
  (typeof AUTOMATION_NOTIFY_GROUPS)[number]['value'];

export function findNotifyGroup(value: unknown) {
  return AUTOMATION_NOTIFY_GROUPS.find((group) => group.value === value);
}

/** Chat channels a "Send message" step can use. Email has its own step. */
export const AUTOMATION_MESSAGE_CHANNELS = [
  { value: 'WHATSAPP_META', label: 'WhatsApp' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'SLACK', label: 'Slack' },
] as const;

export type AutomationMessageChannel =
  (typeof AUTOMATION_MESSAGE_CHANNELS)[number]['value'];

/**
 * What the "Kerf record" step can do. Listed once so the builder offers
 * exactly what the worker runs.
 */
export const AUTOMATION_RECORD_ACTIONS = [
  { entity: 'contact', action: 'create', label: 'Create a contact', kind: 'change' },
  { entity: 'contact', action: 'update', label: 'Update a contact', kind: 'change' },
  { entity: 'quote', action: 'approve', label: 'Approve a quote', kind: 'change' },
  { entity: 'quote', action: 'reject', label: 'Reject a quote', kind: 'change' },
  { entity: 'quote', action: 'get', label: 'Look up a quote', kind: 'lookup' },
  { entity: 'proof', action: 'get', label: 'Look up an artwork proof', kind: 'lookup' },
  { entity: 'invoice', action: 'get', label: 'Look up an invoice', kind: 'lookup' },
  { entity: 'summary', action: 'daily', label: "Get today's shop summary", kind: 'lookup' },
] as const;

export type AutomationRecordEntity =
  (typeof AUTOMATION_RECORD_ACTIONS)[number]['entity'];

export function isRecordLookup(config: {
  entity?: unknown;
  action?: unknown;
}): boolean {
  return AUTOMATION_RECORD_ACTIONS.some(
    (item) =>
      item.kind === 'lookup' &&
      item.entity === config.entity &&
      item.action === config.action,
  );
}

/** What each lookup returns, for the builder's field list and for test data. */
export const AUTOMATION_LOOKUP_SAMPLES: Record<
  'quote' | 'proof' | 'invoice' | 'summary',
  Record<string, string | number | boolean | null>
> = {
  quote: {
    quoteId: '8a4c2d6e-91b3-4e0a-b7f4-0c5d3e2a1f90',
    quoteNumber: 'Q-2026-0142',
    title: '5,000 printed cake boxes',
    customerName: 'Al Noor Bakery',
    customerEmail: 'orders@alnoorbakery.ae',
    totalAmount: 18375,
    currency: 'AED',
    status: 'APPROVED',
    accepted: false,
    customerResponse: null,
    validUntil: '2026-12-04T00:00:00.000Z',
    awaitingCustomer: true,
  },
  proof: {
    proofId: '4b3a2c1d-0e9f-4a8b-7c6d-5e4f3a2b1c0d',
    proofVersion: 2,
    quoteNumber: 'Q-2026-0142',
    title: '5,000 printed cake boxes',
    customerName: 'Al Noor Bakery',
    customerEmail: 'orders@alnoorbakery.ae',
    status: 'PENDING',
    replaced: false,
    awaitingCustomer: true,
  },
  invoice: {
    invoiceId: 'c3d1e5f7-2a4b-4c6d-9e8f-1a2b3c4d5e6f',
    invoiceNumber: 'INV-2026-0211',
    customerName: 'Al Noor Bakery',
    customerEmail: 'orders@alnoorbakery.ae',
    amount: 9187.5,
    paidAmount: 0,
    balance: 9187.5,
    currency: 'AED',
    status: 'ISSUED',
    dueDate: '2026-11-27T00:00:00.000Z',
    unpaid: true,
  },
  summary: {
    date: '2026-11-21',
    quotesAwaitingCustomer: 4,
    proofsAwaitingCustomer: 2,
    ordersInProduction: 6,
    jobsDueToday: 3,
    jobsLate: 1,
    invoicesOverdue: 2,
    overdueAmount: 12400,
    paymentsYesterday: 9187.5,
    currency: 'AED',
    stockItemsLow: 1,
    purchaseOrdersAwaitingApproval: 1,
    conversationsWaiting: 2,
    summaryText:
      'Quotes waiting on customers: 4\nProofs waiting on customers: 2\nOrders in production: 6\nJobs due today: 3 (1 late)\nOverdue invoices: 2 (AED 12,400.00)\nPayments received yesterday: AED 9,187.50\nMaterials at or below minimum: 1\nPurchase orders waiting for approval: 1\nCustomer conversations waiting for a person: 2',
  },
};
