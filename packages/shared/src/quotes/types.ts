import type { BillingStage } from '../orders/billing';

export type QuoteLineItemType = 'product' | 'section' | 'note';

export type QuoteStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type QuoteCreatedBy = 'AI' | 'HUMAN';

/**
 * Where a line's cost came from.
 * - `STANDARD` — copied from a catalog item's standing cost.
 * - `COMPUTED` — produced by the costing engine from a product template.
 * - `MANUAL`   — typed by hand. Unverified, and margin reporting says so.
 */
export type QuoteLineCostSource = 'STANDARD' | 'COMPUTED' | 'MANUAL';

/**
 * Cost snapshot for one line, taken when the line was added.
 *
 * Kept as a single nested object on purpose: stripping cost from a response
 * for an actor without `quote:view_cost` is then one `delete line.cost`
 * rather than six field deletions that someone will eventually forget.
 */
export interface QuoteLineCostSnapshot {
  unitCost: number;
  totalCost: number;
  source: QuoteLineCostSource;
  materialCost?: number;
  machineCost?: number;
  laborCost?: number;
  toolingCost?: number;
  overheadCost?: number;
}

export interface QuoteLineItem {
  id: string;
  type: QuoteLineItemType;
  description: string;
  quantity?: number;
  uom?: string; // Units, Hours, Days, Licenses, Months, etc.
  unitPrice?: number;
  discount?: number; // 0 - 100 percentage
  taxRate?: number; // 0, 5, 10, 20 etc. percentage
  /**
   * Set by the server from the tax rules when any exist. `taxRate` still holds
   * the percentage, so totals are computed exactly as before.
   */
  taxCodeId?: string | null;
  taxCode?: string | null;
  /** Charged at 0%; the invoice has to say the customer accounts for the tax. */
  taxReverseCharge?: boolean;
  subtotal?: number; // line untaxed total after discount

  /**
   * Soft links back to what produced this line. Deliberately not foreign keys:
   * a quote from March must still print March's numbers after the catalog
   * changes, and deleting a catalog item must not corrupt an old quote.
   */
  catalogItemId?: string | null;
  templateId?: string | null;
  templateVersion?: number | null;
  sku?: string | null;

  /** Template inputs, so a parametric line can be reopened and re-costed. */
  parameters?: Record<string, string | number | boolean> | null;

  cost?: QuoteLineCostSnapshot | null;

  /** Drives the delivery estimate, not the price. */
  effortMinutes?: number;
  leadTimeDays?: number;
}

export interface QuoteTotals {
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** Sum of line costs. Lines with no cost snapshot contribute nothing. */
  costAmount: number;
  marginAmount: number;
  /** Fraction of the untaxed subtotal, 0-1. Tax is never margin. */
  marginPct: number;
  /**
   * False when any priced line has no cost snapshot — a hand-typed line, say.
   * The margin above is then an overstatement, and the UI must not present it
   * as fact.
   */
  hasCompleteCost: boolean;
}

export function calculateQuoteTotals(items: QuoteLineItem[]): QuoteTotals {
  let subtotalAmount = 0;
  let discountAmount = 0;
  let taxAmount = 0;
  let costAmount = 0;
  let hasCompleteCost = true;

  for (const item of items || []) {
    if (item.type === 'product') {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const discountPercent = Math.min(100, Math.max(0, Number(item.discount) || 0));
      const taxPercent = Math.max(0, Number(item.taxRate) || 0);

      const grossLine = qty * price;
      const discountVal = grossLine * (discountPercent / 100);
      const lineSubtotal = grossLine - discountVal;
      const lineTax = lineSubtotal * (taxPercent / 100);

      subtotalAmount += lineSubtotal;
      discountAmount += discountVal;
      taxAmount += lineTax;

      if (item.cost && Number.isFinite(Number(item.cost.totalCost))) {
        costAmount += Number(item.cost.totalCost);
      } else if (grossLine > 0) {
        // A line that carries price but no cost makes the margin a guess.
        hasCompleteCost = false;
      }
    }
  }

  // Margin is against the post-discount, pre-tax subtotal. Tax is collected on
  // behalf of the state and is never margin.
  const marginAmount = subtotalAmount - costAmount;

  return {
    subtotalAmount: Number(subtotalAmount.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    totalAmount: Number((subtotalAmount + taxAmount).toFixed(2)),
    costAmount: Number(costAmount.toFixed(2)),
    marginAmount: Number(marginAmount.toFixed(2)),
    marginPct: subtotalAmount > 0 ? Number((marginAmount / subtotalAmount).toFixed(4)) : 0,
    hasCompleteCost,
  };
}

/**
 * Removes every cost trace from a set of lines, for an actor without
 * `quote:view_cost`. Hiding cost in the browser is not hiding it — the API
 * must not put it on the wire in the first place.
 */
export function stripLineCosts(items: QuoteLineItem[]): QuoteLineItem[] {
  return (items || []).map(({ cost: _cost, ...rest }) => rest);
}

/** The subset of `QuoteTotals` that is safe without `quote:view_cost`. */
export function stripTotalsCosts(totals: QuoteTotals): QuoteTotals {
  return {
    ...totals,
    costAmount: 0,
    marginAmount: 0,
    marginPct: 0,
    hasCompleteCost: false,
  };
}

export interface CreateQuotePayload {
  title: string;
  quoteNumber?: string;
  customerId?: string | null;
  customerName?: string;
  customerEmail?: string | null;
  validUntil?: string | null;
  paymentTerms?: string;
  currency?: string;
  items?: QuoteLineItem[];
  subtotalAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  createdBy?: QuoteCreatedBy;
  /** Null or absent: invoice everything on approval. See `orders/billing.ts`. */
  billingSchedule?: BillingStage[] | null;
}

export interface UpdateQuotePayload extends Partial<CreateQuotePayload> {
  status?: QuoteStatus;
}

export type InvoiceStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface InvoiceDto {
  id: string;
  tenantId: string;
  quoteId: string;
  salesOrderId?: string | null;
  billingScheduleLineId?: string | null;
  /** "30% deposit" on a part invoice; null when the invoice bills the whole quote. */
  stageLabel?: string | null;
  deliveryNoteId?: string | null;
  creditedAmount?: number;
  refundedAmount?: number;
  taxBreakdown?: import('../tax/tax').TaxBreakdownLine[] | null;
  invoiceNumber: string;
  customerId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  currency: string;
  items: QuoteLineItem[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  amount: number;
  status: InvoiceStatus;
  paymentTerms: string;
  dueDate?: string | null;
  notes?: string | null;
  paidAt?: string | null;
  paidAmount?: number | null;
  paidViaAccountId?: string | null;
  sentAt?: string | null;
  voidedAt?: string | null;
  voidedById?: string | null;
  voidReason?: string | null;
  overdueNotifiedAt?: string | null;
  issuedAt: string;
}

export interface InvoicePaymentDto {
  id: string;
  tenantId: string;
  invoiceId: string;
  amount: number;
  paidAt: string;
  accountId?: string | null;
  recordedById?: string | null;
  notes?: string | null;
  createdAt: string;
}

/** @deprecated use RecordInvoicePaymentPayload with POST /invoices/:id/payments */
export interface MarkInvoicePaidPayload {
  accountId: string;
  paidAmount?: number;
  paidAt?: string;
  notes?: string;
}

export interface RecordInvoicePaymentPayload {
  accountId: string;
  /** Omit to pay off the remaining balance in full. */
  amount?: number;
  paidAt?: string;
  notes?: string;
}

export interface VoidInvoicePayload {
  reason?: string;
}

/** Derived, not stored — "overdue" is a view of (dueDate, status), never its own status value. */
export function isInvoiceOverdue(
  invoice: Pick<InvoiceDto, 'dueDate' | 'status'>,
  now: Date = new Date(),
): boolean {
  if (!invoice.dueDate) return false;
  if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') return false;
  return new Date(invoice.dueDate).getTime() < now.getTime();
}

/**
 * Shared by the Nest service (sync fallback) and the DI-free Temporal
 * activity that creates the invoice on quote approval, so both paths agree
 * on how a quote's paymentTerms turn into a due date.
 */
export function calculateInvoiceDueDate(issuedAt: Date, paymentTerms: string): Date | null {
  if (paymentTerms === 'immediate') {
    return new Date(issuedAt);
  }

  const netMatch = /^net_(\d+)$/.exec(paymentTerms);
  if (netMatch) {
    const due = new Date(issuedAt);
    due.setDate(due.getDate() + Number(netMatch[1]));
    return due;
  }

  if (paymentTerms === 'end_of_month') {
    return new Date(issuedAt.getFullYear(), issuedAt.getMonth() + 1, 0);
  }

  return null;
}

export interface QuoteDto {
  id: string;
  tenantId: string;
  quoteNumber: string;
  customerId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  title: string;
  status: QuoteStatus;
  createdBy: QuoteCreatedBy;
  validUntil?: string | null;
  paymentTerms: string;
  currency: string;
  items: QuoteLineItem[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  workflowId?: string | null;
  billingSchedule?: BillingStage[] | null;
  acceptanceExpiresAt?: string | null;
  acceptedAt?: string | null;
  acceptedByName?: string | null;
  version?: number;
  parentQuoteId?: string | null;
  supersededAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
