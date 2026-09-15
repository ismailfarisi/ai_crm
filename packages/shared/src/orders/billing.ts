/**
 * Sales orders and staged billing.
 *
 * A quote can be billed in stages — a deposit on approval, the balance later.
 * The schedule is chosen while quoting (it is part of what the customer is
 * agreeing to) and copied onto the order when the order is created.
 */

export type SalesOrderStatus = 'OPEN' | 'IN_PRODUCTION' | 'FULFILLED' | 'CLOSED' | 'CANCELLED';

export type BillingKind = 'DEPOSIT' | 'MILESTONE' | 'FINAL';

/**
 * When a stage is invoiced.
 *
 * `ON_APPROVAL` is raised the moment the order exists — the deposit case, and
 * the whole-amount case that every quote without a schedule falls into.
 * `MANUAL` waits for someone to say the milestone has been reached.
 * `ON_DELIVERY` is never raised as a stage: each dispatched delivery note is
 * invoiced for what it carried, until the order is billed in full.
 */
export type BillingTrigger = 'ON_APPROVAL' | 'MANUAL' | 'ON_DELIVERY';

export interface BillingStage {
  kind: BillingKind;
  label: string;
  /** Share of the quote total, 0-100. */
  percent: number;
  trigger: BillingTrigger;
}

/** What every quote without a schedule is billed as: everything, on approval. */
export const DEFAULT_BILLING_SCHEDULE: BillingStage[] = [
  { kind: 'FINAL', label: 'Full amount', percent: 100, trigger: 'ON_APPROVAL' },
];

export const BILLING_PRESETS: { key: string; label: string; stages: BillingStage[] }[] = [
  { key: 'full', label: 'Invoice in full on approval', stages: DEFAULT_BILLING_SCHEDULE },
  {
    key: 'deposit-30',
    label: '30% deposit, balance on completion',
    stages: [
      { kind: 'DEPOSIT', label: '30% deposit', percent: 30, trigger: 'ON_APPROVAL' },
      { kind: 'FINAL', label: 'Balance on completion', percent: 70, trigger: 'MANUAL' },
    ],
  },
  {
    key: 'per-delivery',
    label: 'Invoice each delivery',
    stages: [{ kind: 'FINAL', label: 'Invoiced per delivery', percent: 100, trigger: 'ON_DELIVERY' }],
  },
  {
    key: 'deposit-50',
    label: '50% deposit, balance on completion',
    stages: [
      { kind: 'DEPOSIT', label: '50% deposit', percent: 50, trigger: 'ON_APPROVAL' },
      { kind: 'FINAL', label: 'Balance on completion', percent: 50, trigger: 'MANUAL' },
    ],
  },
];

/**
 * Problems with a schedule, written for the person editing it. Empty means valid.
 *
 * Percentages must total exactly 100 — a schedule that bills 99% leaves money
 * nobody will ever invoice, and one that bills 101% invoices money nobody agreed to.
 */
export function validateBillingSchedule(stages: BillingStage[]): string[] {
  const problems: string[] = [];
  if (!stages || stages.length === 0) {
    return ['A billing schedule needs at least one stage.'];
  }
  if (stages.length > 12) problems.push('A schedule can have at most 12 stages.');

  for (const [i, s] of stages.entries()) {
    if (!(s.percent > 0)) problems.push(`Stage ${i + 1} ("${s.label}") must bill more than 0%.`);
  }

  const total = Math.round(stages.reduce((sum, s) => sum + (s.percent || 0), 0) * 1000) / 1000;
  if (total !== 100) {
    problems.push(`Stages add up to ${total}%, not 100%.`);
  }

  // Delivery billing invoices by quantity shipped, which cannot be mixed with
  // billing by percentage: a 30% deposit and then a delivery of the whole
  // order would bill 130%.
  if (stages.some((s) => s.trigger === 'ON_DELIVERY') && stages.length > 1) {
    problems.push('Invoicing per delivery has to be the only stage.');
  }

  const finals = stages.filter((s) => s.kind === 'FINAL').length;
  if (finals > 1) problems.push('Only one stage can be the final one.');
  if (finals === 1 && stages[stages.length - 1].kind !== 'FINAL') {
    problems.push('The final stage has to come last.');
  }
  return problems;
}

export interface QuoteAmounts {
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export type StageAmounts = QuoteAmounts;

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);

/**
 * Splits a quote's amounts across its stages, to the cent.
 *
 * Each figure is split independently by share, and the last stage takes
 * whatever remains rather than its own rounded share. Rounding every stage
 * separately can lose or invent a cent — three thirds of 100.00 are 33.33 each,
 * which invoices 99.99 — and a customer billed a different total from the one
 * they accepted is a dispute, however small.
 *
 * Works in integer cents throughout for the same reason.
 */
export function allocateStageAmounts(amounts: QuoteAmounts, stages: BillingStage[]): StageAmounts[] {
  const fields: (keyof QuoteAmounts)[] = ['subtotalAmount', 'discountAmount', 'taxAmount', 'totalAmount'];
  const totals = Object.fromEntries(fields.map((f) => [f, cents(amounts[f])])) as Record<keyof QuoteAmounts, number>;
  const allocated = Object.fromEntries(fields.map((f) => [f, 0])) as Record<keyof QuoteAmounts, number>;

  return stages.map((stage, index) => {
    const isLast = index === stages.length - 1;
    const row = {} as StageAmounts;
    for (const f of fields) {
      const share = isLast ? totals[f] - allocated[f] : Math.round((totals[f] * stage.percent) / 100);
      allocated[f] += share;
      row[f] = share / 100;
    }
    return row;
  });
}

/* ------------------------------------------------------------------ *
 * Quote acceptance
 * ------------------------------------------------------------------ */

/** How long an acceptance link lasts when the quote has no expiry of its own. */
export const ACCEPTANCE_LINK_DEFAULT_DAYS = 30;

/**
 * Why a link cannot be used, in words a customer can act on.
 *
 * Deliberately vague about internals: a public page must not reveal whether a
 * quote exists, was superseded by a higher-priced revision, or belongs to
 * someone else. Each case tells the customer to contact the sender, which is
 * the only useful thing they can do.
 */
export type AcceptanceRefusal = 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_ACCEPTED' | 'NO_LONGER_AVAILABLE';

export function acceptanceRefusalMessage(reason: AcceptanceRefusal): string {
  switch (reason) {
    case 'ALREADY_ACCEPTED':
      return 'This quote has already been accepted. Nothing more is needed.';
    case 'EXPIRED':
      return 'This link has expired. Please ask for an updated quote.';
    case 'NO_LONGER_AVAILABLE':
      return 'This quote is no longer available. Please contact the sender for the current version.';
    default:
      return 'This link is not valid. Please check it, or contact the sender.';
  }
}

/* ------------------------------------------------------------------ *
 * Wire shapes
 * ------------------------------------------------------------------ */

export interface BillingScheduleLineDto {
  id: string;
  sequence: number;
  kind: BillingKind;
  label: string;
  percent: number;
  trigger: BillingTrigger;
  totalAmount: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | null;
  invoicedAt: string | null;
}

export interface SalesOrderLineDto {
  id: string;
  description: string;
  uom: string | null;
  qtyOrdered: number;
  qtyFulfilled: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SalesOrderDto {
  id: string;
  orderNumber: string;
  quoteId: string;
  quoteNumber: string | null;
  customerId: string | null;
  customerName: string;
  status: SalesOrderStatus;
  currency: string;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** Live invoices only; a voided invoice bills nothing. */
  invoicedAmount: number;
  paidAmount: number;
  acceptedAt: string | null;
  acceptedByName: string | null;
  lines: SalesOrderLineDto[];
  billingSchedule: BillingScheduleLineDto[];
  createdAt: string;
}

/** What a customer sees on the public page. Never cost, margin, or internal notes. */
export interface PublicQuoteDto {
  organizationName: string;
  quoteNumber: string | null;
  title: string;
  customerName: string;
  currency: string;
  validUntil: string | null;
  paymentTerms: string;
  termsAndConditions: string | null;
  items: {
    description: string;
    quantity: number;
    uom: string | null;
    unitPrice: number;
    discount: number;
    taxRate: number;
    subtotal: number;
  }[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  billingSchedule: { label: string; percent: number; totalAmount: number }[];
  acceptedAt: string | null;
  acceptedByName: string | null;
}
