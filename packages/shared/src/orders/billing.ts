import type { DocumentLanguage } from '../templates/document-language';
/**
 * Sales orders and staged billing.
 *
 * A quote can be billed in stages — a deposit when the customer accepts, the
 * balance later.
 * The schedule is chosen while quoting (it is part of what the customer is
 * agreeing to) and copied onto the order when the order is created.
 */

import type { CustomerQuoteResponse, PublicQuoteProofDto } from '../quotes/proofs';

export type SalesOrderStatus = 'OPEN' | 'IN_PRODUCTION' | 'FULFILLED' | 'CLOSED' | 'CANCELLED';

export type BillingKind = 'DEPOSIT' | 'MILESTONE' | 'FINAL';

/**
 * When a stage is invoiced.
 *
 * `ON_APPROVAL` is raised the moment the order exists — the deposit case, and
 * the whole-amount case that every quote without a schedule falls into. The
 * name predates order-on-acceptance: the order, and so this stage, now comes
 * when the customer accepts an approved quote, not at approval itself.
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
  /**
   * A fixed amount, incl. tax, instead of a share: "AED 2,000 deposit".
   * `percent` still holds the approximate share so the stages add to 100.
   */
  amount?: number | null;
  trigger: BillingTrigger;
}

/** What every quote without a schedule is billed as: everything, when the customer accepts. */
export const DEFAULT_BILLING_SCHEDULE: BillingStage[] = [
  { kind: 'FINAL', label: 'Full amount', percent: 100, trigger: 'ON_APPROVAL' },
];

export const BILLING_PRESETS: { key: string; label: string; stages: BillingStage[] }[] = [
  { key: 'full', label: 'Invoice in full when accepted', stages: DEFAULT_BILLING_SCHEDULE },
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

/**
 * A document's amounts, as `calculateQuoteTotals` defines them:
 * `subtotalAmount` is after discount and before tax, so
 * `subtotalAmount + taxAmount = totalAmount`. `discountAmount` is what was
 * taken off to reach the subtotal and is not subtracted again.
 */
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
 * The total and the tax are split by share, and the last stage takes whatever
 * remains of each rather than its own rounded share. Rounding every stage
 * separately can lose or invent a cent — three thirds of 100.00 are 33.33 each,
 * which invoices 99.99 — and a customer billed a different total from the one
 * they accepted is a dispute, however small.
 *
 * A stage's net is never rounded on its own: it is its total less its tax, so
 * net + tax is the total on every stage invoice. Rounding all three
 * separately can leave an invoice a cent out against itself (2,416.67 +
 * 120.84 printed over a total of 2,537.50). The nets then add up to the
 * quote's total less its tax, which is the quote's subtotal.
 *
 * Works in integer cents throughout for the same reason.
 */
export function allocateStageAmounts(amounts: QuoteAmounts, stages: BillingStage[]): StageAmounts[] {
  const quote = {
    total: cents(amounts.totalAmount),
    tax: cents(amounts.taxAmount),
    discount: cents(amounts.discountAmount),
  };
  const left = { ...quote };
  // No stage takes more than is left for the ones after it.
  const upTo = (value: number, remaining: number) =>
    remaining >= 0 ? Math.min(value, remaining) : Math.max(value, remaining);

  return stages.map((stage, index) => {
    let share = left;
    if (index < stages.length - 1) {
      // A fixed amount sets the stage's total; tax and discount follow in the
      // same ratio.
      const fixed = stage.amount != null && quote.total > 0;
      const total = upTo(
        fixed ? cents(stage.amount as number) : Math.round((quote.total * stage.percent) / 100),
        left.total,
      );
      const ratio = fixed ? total / quote.total : stage.percent / 100;
      share = {
        total,
        tax: upTo(Math.round(quote.tax * ratio), left.tax),
        discount: upTo(Math.round(quote.discount * ratio), left.discount),
      };
      left.total -= share.total;
      left.tax -= share.tax;
      left.discount -= share.discount;
    }
    return {
      subtotalAmount: (share.total - share.tax) / 100,
      discountAmount: share.discount / 100,
      taxAmount: share.tax / 100,
      totalAmount: share.total / 100,
    };
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
export type AcceptanceRefusal =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'ALREADY_ACCEPTED'
  | 'NO_LONGER_AVAILABLE'
  | 'DECLINED';

export function acceptanceRefusalMessage(reason: AcceptanceRefusal): string {
  switch (reason) {
    case 'ALREADY_ACCEPTED':
      return 'This quote has already been accepted. Nothing more is needed.';
    case 'EXPIRED':
      return 'This link has expired. Please ask for an updated quote.';
    case 'DECLINED':
      return 'You declined this quote. Please contact the sender if you have changed your mind.';
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
  /** The customer's document language, else the quote template's. */
  language: DocumentLanguage;
  organizationName: string;
  /**
   * Who the quote is from, as it should print.
   *
   * The customer used to see a trading name and nothing else — no address, no
   * tax registration — because the organization record held nothing else to
   * show. Every field is optional: a tenant that has not filled in the Company
   * screen still gets a working document, just a barer one.
   */
  seller: {
    legalName: string | null;
    taxId: string | null;
    registrationNumber: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    addressLines: string[];
    legalNameAr: string | null;
    addressAr: string | null;
    documentFooter: string | null;
    /** Absolute URL to the logo, or null when none has been uploaded. */
    logoUrl: string | null;
  };
  quoteNumber: string | null;
  title: string;
  customerName: string;
  customerNameAr: string | null;
  currency: string;
  validUntil: string | null;
  paymentTerms: string;
  termsAndConditions: string | null;
  items: {
    description: string;
    descriptionAr: string | null;
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
  /** The deposit invoice raised on acceptance, once there is one. */
  deposit?: import('../payments/online-payments').PublicDepositDto | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  /** The customer's last word short of accepting: a decline or a request for changes. */
  customerResponse: {
    kind: CustomerQuoteResponse;
    note: string | null;
    name: string | null;
    at: string | null;
  } | null;
  /** Artwork proofs, newest first. Only this quote's proof files, never its other attachments. */
  proofs: PublicQuoteProofDto[];
  /** Accepting waits for the latest proof to be approved. */
  proofRequired: boolean;
  /** True while that requirement is not yet met. */
  proofBlocksAcceptance: boolean;
}
