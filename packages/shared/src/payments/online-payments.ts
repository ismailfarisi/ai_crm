import { z } from 'zod';
import type { BillingStage } from '../orders/billing';

/**
 * Online payments from a tenant's own customers: a deposit when a quote is
 * accepted, and a pay link on invoices.
 *
 * Not Kerf's subscription billing (`billing/subscriptions.ts`), which charges
 * tenants. Each tenant connects its own payment account, so the money lands
 * with the shop, never with Kerf.
 */

/** NONE turns online payment off. FAKE is a stand-in checkout for dev and staging. */
export const PAYMENT_PROVIDERS = ['NONE', 'FAKE', 'STRIPE'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  NONE: 'Off',
  FAKE: 'Test checkout (no real money)',
  STRIPE: 'Stripe',
};

/** What a checkout is collecting: the deposit on an accepted quote, or an invoice balance. */
export type OnlinePaymentPurpose = 'DEPOSIT' | 'INVOICE';

export type OnlineCheckoutStatus = 'OPEN' | 'PAID' | 'FAILED' | 'EXPIRED';

/** How long a public invoice pay link works before it has to be sent again. */
export const PAY_LINK_DAYS = 30;

/**
 * Saved settings as the browser sees them. Secrets are write-only: once saved
 * the API only says whether one is set, and the last four characters of the
 * key so the owner can tell which account is connected.
 */
export interface PaymentSettingsDto {
  provider: PaymentProviderName;
  secretKeySet: boolean;
  secretKeyHint: string | null;
  webhookSecretSet: boolean;
  /** Where the provider should send events. Null until a provider is chosen. */
  webhookUrl: string | null;
  /** The bank or clearing account online payments are recorded into. */
  financeAccountId: string | null;
  /** Deposit percentage new quotes start with; 0 means no deposit. */
  defaultDepositPercent: number;
  /** Offer "Pay deposit" after a customer accepts a quote. */
  payDeposits: boolean;
  /** Put a pay link on invoices and invoice emails. */
  payInvoices: boolean;
  /** True when provider, keys and account are all in place. */
  ready: boolean;
  /** The fake provider is refused in production. */
  fakeAllowed: boolean;
}

const optionalSecret = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v == null || v === '' ? undefined : v));

export const updatePaymentSettingsSchema = z
  .object({
    provider: z.enum(PAYMENT_PROVIDERS),
    /** Leave blank to keep the saved key. */
    secretKey: optionalSecret,
    webhookSecret: optionalSecret,
    financeAccountId: z
      .string()
      .uuid('Choose an account')
      .nullish()
      .transform((v) => v ?? null),
    defaultDepositPercent: z.coerce
      .number()
      .min(0, 'Use 0 to 99')
      .max(99, 'Use 0 to 99'),
    payDeposits: z.boolean(),
    payInvoices: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.provider === 'STRIPE' && v.secretKey && !/^(sk|rk)_(test|live)_/.test(v.secretKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['secretKey'],
        message: 'A Stripe secret key starts with sk_test_ or sk_live_',
      });
    }
    if (v.provider === 'STRIPE' && v.webhookSecret && !v.webhookSecret.startsWith('whsec_')) {
      ctx.addIssue({
        code: 'custom',
        path: ['webhookSecret'],
        message: 'A Stripe webhook secret starts with whsec_',
      });
    }
  });

export type UpdatePaymentSettingsInput = z.input<typeof updatePaymentSettingsSchema>;
export type UpdatePaymentSettingsPayload = z.output<typeof updatePaymentSettingsSchema>;

/** The deposit on an accepted quote, as the customer's quote page shows it. */
export interface PublicDepositDto {
  label: string;
  invoiceNumber: string;
  amount: number;
  balanceDue: number;
  paid: boolean;
  /** False when the shop has not switched on online deposits. */
  canPayOnline: boolean;
}

/** An invoice as its public pay link shows it. No internal ids. */
export interface PublicInvoiceDto {
  organizationName: string;
  sellerTaxId: string | null;
  sellerEmail: string | null;
  invoiceNumber: string;
  stageLabel: string | null;
  customerName: string;
  currency: string;
  issuedAt: string;
  dueDate: string | null;
  items: { description: string; quantity: number; unitPrice: number; subtotal: number }[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  creditedAmount: number;
  balanceDue: number;
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
  canPayOnline: boolean;
}

/** Online payment state of one invoice, for staff screens. */
export interface InvoiceOnlinePaymentDto {
  invoiceId: string;
  /** Pay link expiry, when one has been issued and still works. */
  payLinkExpiresAt: string | null;
  lastCheckoutStatus: OnlineCheckoutStatus | null;
  lastCheckoutAt: string | null;
  /** Total recorded through online checkouts. */
  paidOnline: number;
}

export interface PayLinkDto {
  url: string;
  expiresAt: string;
}

export interface CheckoutRedirectDto {
  url: string;
}

/**
 * The two-stage schedule a deposit makes: the deposit invoiced when the
 * customer accepts, the balance when the job is done. `amount` fixes the
 * deposit in money; otherwise it is `percent` of the quote.
 */
export function depositSchedule(
  deposit: { percent: number } | { amount: number; quoteTotal: number },
): BillingStage[] {
  if ('amount' in deposit) {
    const total = deposit.quoteTotal > 0 ? deposit.quoteTotal : deposit.amount;
    const percent = Math.min(99.99, Math.max(0.01, Math.round((deposit.amount / total) * 10000) / 100));
    return [
      { kind: 'DEPOSIT', label: 'Deposit', percent, amount: deposit.amount, trigger: 'ON_APPROVAL' },
      {
        kind: 'FINAL',
        label: 'Balance on completion',
        percent: Math.round((100 - percent) * 100) / 100,
        trigger: 'MANUAL',
      },
    ];
  }
  const percent = deposit.percent;
  return [
    { kind: 'DEPOSIT', label: `${percent}% deposit`, percent, trigger: 'ON_APPROVAL' },
    { kind: 'FINAL', label: 'Balance on completion', percent: 100 - percent, trigger: 'MANUAL' },
  ];
}

/** Currencies a card provider counts in whole units rather than cents. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'XOF', 'XAF', 'UGX']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND']);

/** An amount in the smallest unit a card provider charges in: 120.50 AED → 12050. */
export function toMinorUnits(amount: number, currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return Math.round(amount);
  if (THREE_DECIMAL.has(code)) return Math.round(amount * 100) * 10;
  return Math.round(amount * 100);
}

export function fromMinorUnits(minor: number, currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return minor;
  if (THREE_DECIMAL.has(code)) return Math.round(minor / 10) / 100;
  return minor / 100;
}

/** The deposit on an accepted quote, for the staff quote screen. */
export interface QuoteDepositStatusDto {
  invoiceId: string;
  invoiceNumber: string;
  label: string;
  amount: number;
  paidAmount: number;
  balanceDue: number;
  invoiceStatus: PublicInvoiceDto['status'];
  lastCheckoutStatus: OnlineCheckoutStatus | null;
  paidOnline: number;
}
