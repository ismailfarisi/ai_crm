import { isInvoiceOverdue, type InvoiceStatus, type QuoteStatus } from '@saas/shared';

/**
 * The dashboard's figures, worked out from the same lists the rest of the app
 * reads. Kept apart from the page so each number can be tested on its own:
 * the dashboard is what the owner looks at first, and principle one is that
 * the number must be right.
 */

/** Only the fields the dashboard reads, so it is not coupled to the full DTO. */
export interface DashboardQuote {
  id: string;
  quoteNumber: string | null;
  title: string;
  customerName: string;
  status: QuoteStatus;
  totalAmount: number | string;
  currency?: string;
  acceptedAt: string | null;
  supersededAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface DashboardInvoice {
  amount: number | string;
  paidAmount?: number | string | null;
  currency?: string;
  status: InvoiceStatus;
  dueDate?: string | null;
  issuedAt: string;
}

export interface DashboardWorkOrder {
  status: string;
  dueDate: string | null;
}

/** True when the amount is in the base currency, or there is nothing to compare against. */
const inBase = (currency: string | undefined, base: string | null | undefined) =>
  !base || !currency || currency === base;

export interface MoneyFigure {
  count: number;
  /** Sum of the items in the base currency only. */
  amount: number;
  /** Items in another currency: counted, never added in. */
  otherCurrencies: number;
}

/** Quotes that are someone's decision right now. An old version waits on nobody. */
export function awaitingApproval(quotes: DashboardQuote[]): DashboardQuote[] {
  return quotes
    .filter((q) => q.status === 'AWAITING_APPROVAL' && !q.supersededAt)
    .sort((a, b) => new Date(waitingSince(a)).getTime() - new Date(waitingSince(b)).getTime());
}

/** Drafts not yet sent for approval, most recently touched first. */
export function drafts(quotes: DashboardQuote[]): DashboardQuote[] {
  return quotes
    .filter((q) => q.status === 'DRAFT' && !q.supersededAt)
    .sort((a, b) => new Date(waitingSince(b)).getTime() - new Date(waitingSince(a)).getTime());
}

/** The last change is the best record of when a quote was submitted. */
export const waitingSince = (q: DashboardQuote) => q.updatedAt ?? q.createdAt;

export function sumQuotes(quotes: DashboardQuote[], base: string | null | undefined): MoneyFigure {
  let amount = 0;
  let otherCurrencies = 0;
  for (const q of quotes) {
    if (inBase(q.currency, base)) amount += Number(q.totalAmount) || 0;
    else otherCurrencies += 1;
  }
  return { count: quotes.length, amount: round2(amount), otherCurrencies };
}

/** Overdue invoices and what is still owed on them, in the base currency. */
export function overdueInvoices(
  invoices: DashboardInvoice[],
  base: string | null | undefined,
  now: Date = new Date(),
): MoneyFigure {
  let amount = 0;
  let otherCurrencies = 0;
  let count = 0;
  for (const inv of invoices) {
    if (!isInvoiceOverdue({ dueDate: inv.dueDate ?? null, status: inv.status }, now)) continue;
    count += 1;
    const owed = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paidAmount) || 0));
    if (inBase(inv.currency, base)) amount += owed;
    else otherCurrencies += 1;
  }
  return { count, amount: round2(amount), otherCurrencies };
}

/** Jobs released to the floor or being worked, and how many are past their due date. */
export function jobsOnTheFloor(workOrders: DashboardWorkOrder[], now: Date = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const onFloor = workOrders.filter((wo) => wo.status === 'RELEASED' || wo.status === 'IN_PROGRESS');
  const overdue = onFloor.filter((wo) => wo.dueDate && new Date(wo.dueDate).getTime() < startOfToday).length;
  return { count: onFloor.length, overdue };
}

export interface RevenueMonth {
  /** "Mar" under the bar. */
  month: string;
  /** "Mar 2026" when it is read out. */
  label: string;
  value: number;
}

/**
 * Invoiced totals per month for the trailing `months`, oldest first.
 *
 * A voided invoice bills nothing and is left out. An invoice in another
 * currency cannot be added to the rest without a rate, so it is counted and
 * the chart says so, rather than being summed as if it were the base currency.
 */
export function monthlyRevenue(
  invoices: DashboardInvoice[],
  base: string | null | undefined,
  now: Date,
  months = 24,
): { series: RevenueMonth[]; otherCurrencies: number } {
  const buckets: Array<RevenueMonth & { key: string }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      month: d.toLocaleDateString('en-GB', { month: 'short' }),
      label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      key: `${d.getFullYear()}-${d.getMonth()}`,
      value: 0,
    });
  }

  const byKey = new Map(buckets.map((b) => [b.key, b]));
  let otherCurrencies = 0;
  for (const invoice of invoices) {
    if (!invoice.issuedAt || invoice.status === 'CANCELLED') continue;
    const issued = new Date(invoice.issuedAt);
    const bucket = byKey.get(`${issued.getFullYear()}-${issued.getMonth()}`);
    if (!bucket) continue;
    if (inBase(invoice.currency, base)) bucket.value += Number(invoice.amount) || 0;
    else otherCurrencies += 1;
  }

  return {
    series: buckets.map(({ month, label, value }) => ({ month, label, value: round2(value) })),
    otherCurrencies,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
