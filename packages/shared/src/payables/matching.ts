import type { JournalLineInput } from '../finance/ledger';
import { LEDGER_ROLES } from '../finance/ledger';

/**
 * Supplier bills: three-way matching, the journal a bill posts, and aging.
 *
 * Pure and shared so the bill entry screen shows the same match result and
 * the same journal the API will store, before anyone approves anything.
 */

export type BillStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'DISPUTED'
  | 'CANCELLED';

export const BILL_STATUSES: BillStatus[] = [
  'DRAFT',
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
  'DISPUTED',
  'CANCELLED',
];

/**
 * - `MATCHED`: every order-linked line agrees with what was ordered and received.
 * - `VARIANCE`: at least one line bills more than arrived, or at a price outside tolerance.
 * - `UNMATCHED`: no line is linked to an order (a utility bill, a one-off service).
 */
export type BillMatchStatus = 'MATCHED' | 'VARIANCE' | 'UNMATCHED';

export type LineVarianceCode = 'QTY_EXCEEDS_RECEIVED' | 'PRICE_OUTSIDE_TOLERANCE';

export interface LineVariance {
  code: LineVarianceCode;
  /** Written for whoever has to chase the supplier. */
  message: string;
  actual: number;
  limit: number;
}

const round = (value: number, dp: number): number => {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const money = (v: number) => round(v, 2);
const cost = (v: number) => round(v, 4);

export interface BillLineForMatch {
  description: string;
  qty: number;
  unitCost: number;
  /** Present when the line bills goods from a purchase order. */
  orderLine?: {
    unitCost: number;
    qtyReceived: number;
    /** Already billed on other, non-cancelled bills. */
    qtyBilledElsewhere: number;
  } | null;
}

/**
 * The three-way match for one line: order, receipt, bill.
 *
 * Quantity: a supplier may bill what arrived, never more. There is no
 * tolerance on quantity — billing for goods that are not in the building is
 * the fraud-shaped case the whole check exists for.
 *
 * Price: a bill may drift from the ordered price by the tenant's tolerance,
 * because carriage surcharges and rounding are routine. Outside it, the bill
 * still records what the supplier asked for, but it cannot be approved
 * without someone who may accept the difference.
 */
export function evaluateLineMatch(
  line: BillLineForMatch,
  tolerancePct: number,
): LineVariance[] {
  const order = line.orderLine;
  if (!order) return [];

  const variances: LineVariance[] = [];

  const billable = round(order.qtyReceived - order.qtyBilledElsewhere, 4);
  if (round(line.qty, 4) > billable) {
    variances.push({
      code: 'QTY_EXCEEDS_RECEIVED',
      message:
        billable <= 0
          ? `"${line.description}" has nothing left to bill — everything received is already on another bill`
          : `"${line.description}" bills ${line.qty}, but only ${billable} has been received and not yet billed`,
      actual: line.qty,
      limit: billable,
    });
  }

  const tolerance = Math.max(0, tolerancePct);
  const ceiling = cost(order.unitCost * (1 + tolerance));
  if (cost(line.unitCost) > ceiling) {
    const pct = order.unitCost > 0 ? ((line.unitCost - order.unitCost) / order.unitCost) * 100 : 0;
    variances.push({
      code: 'PRICE_OUTSIDE_TOLERANCE',
      message: `"${line.description}" is billed at ${line.unitCost.toFixed(4)}, ${pct.toFixed(1)}% above the ordered ${order.unitCost.toFixed(4)} (tolerance ${(tolerance * 100).toFixed(1)}%)`,
      actual: cost(line.unitCost),
      limit: ceiling,
    });
  }

  // Billed *below* the order price is not a variance: paying less than agreed
  // is never the problem a three-way match is there to catch.
  return variances;
}

export function summariseMatch(
  lines: BillLineForMatch[],
  tolerancePct: number,
): { status: BillMatchStatus; variances: (LineVariance & { lineIndex: number })[] } {
  const linked = lines.filter((l) => l.orderLine);
  if (linked.length === 0) return { status: 'UNMATCHED', variances: [] };

  const variances = lines.flatMap((line, lineIndex) =>
    evaluateLineMatch(line, tolerancePct).map((v) => ({ ...v, lineIndex })),
  );
  return { status: variances.length > 0 ? 'VARIANCE' : 'MATCHED', variances };
}

/* ------------------------------------------------------------------ *
 * Posting
 * ------------------------------------------------------------------ */

export interface BillLineForPosting {
  description: string;
  qty: number;
  unitCost: number;
  /** The ordered unit cost — what GRNI was credited at when the goods arrived. */
  orderUnitCost?: number | null;
}

/**
 * The journal an approved bill posts.
 *
 * For goods received against an order, receipt already credited GRNI at the
 * *ordered* price. The bill clears that exact amount and credits payables at
 * the *billed* price; the difference is purchase price variance.
 *
 *   Dr GRNI            qty × ordered cost      (clears the receipt)
 *   Dr/Cr COGS         the difference          (price variance)
 *   Dr Tax payable     input tax               (reduces what is owed to the tax authority)
 *   Cr Payables        bill total
 *
 * Lines with no order (a utility bill) have no receipt behind them, so they
 * debit operating expense directly.
 *
 * Price variance goes to cost of sales rather than back into inventory
 * value. That is a simplification: strictly, the portion still on the shelf
 * should revalue stock. It keeps a bill from reaching back into a moving
 * average that later receipts and issues have already moved on from.
 */
export function billPostingLines(
  lines: BillLineForPosting[],
  taxAmount: number,
  reference: { billNumber: string; supplierName: string },
): JournalLineInput[] {
  let grni = 0;
  let variance = 0;
  let expense = 0;

  for (const line of lines) {
    const billed = money(line.qty * line.unitCost);
    if (line.orderUnitCost != null) {
      const cleared = money(line.qty * line.orderUnitCost);
      grni = money(grni + cleared);
      variance = money(variance + (billed - cleared));
    } else {
      expense = money(expense + billed);
    }
  }

  const tax = money(Math.max(0, taxAmount));
  const payable = money(grni + variance + expense + tax);
  const label = `Bill ${reference.billNumber} from ${reference.supplierName}`;
  const out: JournalLineInput[] = [];

  if (grni !== 0) {
    out.push({ role: LEDGER_ROLES.GRNI, accountName: 'Goods received not invoiced', debit: grni, credit: 0, description: label });
  }
  if (variance > 0) {
    out.push({ role: LEDGER_ROLES.COGS, accountName: 'Purchase price variance', debit: variance, credit: 0, description: label });
  } else if (variance < 0) {
    out.push({ role: LEDGER_ROLES.COGS, accountName: 'Purchase price variance', debit: 0, credit: -variance, description: label });
  }
  if (expense !== 0) {
    out.push({ role: LEDGER_ROLES.OPERATING_EXPENSE, accountName: 'Operating expense', debit: expense, credit: 0, description: label });
  }
  if (tax !== 0) {
    out.push({ role: LEDGER_ROLES.TAX_PAYABLE, accountName: 'Input tax', debit: tax, credit: 0, description: label });
  }
  if (payable !== 0) {
    out.push({ role: LEDGER_ROLES.ACCOUNTS_PAYABLE, accountName: 'Accounts payable', debit: 0, credit: payable, description: label });
  }
  return out;
}

export function billTotals(
  lines: { qty: number; unitCost: number }[],
  taxAmount: number,
): { subtotal: number; tax: number; total: number } {
  const subtotal = money(lines.reduce((sum, l) => sum + money(l.qty * l.unitCost), 0));
  const tax = money(Math.max(0, taxAmount));
  return { subtotal, tax, total: money(subtotal + tax) };
}

/* ------------------------------------------------------------------ *
 * Aging
 * ------------------------------------------------------------------ */

export type AgingBucket = 'CURRENT' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_OVER_90';

export const AGING_BUCKETS: AgingBucket[] = [
  'CURRENT',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_OVER_90',
];

/** Whole days past due, by calendar date in UTC — a bill due today is current. */
export function daysOverdue(dueDate: Date | string, asOf: Date = new Date()): number {
  const due = new Date(dueDate);
  const a = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const d = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.floor((a - d) / 86_400_000);
}

export function agingBucket(dueDate: Date | string | null, asOf: Date = new Date()): AgingBucket {
  if (!dueDate) return 'CURRENT';
  const days = daysOverdue(dueDate, asOf);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return 'DAYS_1_30';
  if (days <= 60) return 'DAYS_31_60';
  if (days <= 90) return 'DAYS_61_90';
  return 'DAYS_OVER_90';
}

/** Which statuses each status may move to. Payment moves are driven by the amounts, not called directly. */
export const BILL_TRANSITIONS: Record<BillStatus, BillStatus[]> = {
  DRAFT: ['APPROVED', 'DISPUTED', 'CANCELLED'],
  DISPUTED: ['DRAFT', 'CANCELLED'],
  APPROVED: ['PARTIALLY_PAID', 'PAID'],
  PARTIALLY_PAID: ['PAID', 'APPROVED'],
  PAID: ['PARTIALLY_PAID'],
  CANCELLED: [],
};

export function canTransitionBill(from: BillStatus, to: BillStatus): boolean {
  return BILL_TRANSITIONS[from]?.includes(to) ?? false;
}

/* ------------------------------------------------------------------ *
 * Wire shapes
 * ------------------------------------------------------------------ */

export interface SupplierBillLineDto {
  id: string;
  purchaseOrderLineId: string | null;
  description: string;
  qty: number;
  unitCost: number;
  orderUnitCost: number | null;
  lineTotal: number;
}

export interface SupplierBillDto {
  id: string;
  billNumber: string;
  supplierInvoiceNumber: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string | null;
  status: BillStatus;
  matchStatus: BillMatchStatus;
  currency: string;
  billDate: string;
  dueDate: string | null;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  notes: string | null;
  varianceApproved: boolean;
  disputeReason: string | null;
  lines: SupplierBillLineDto[];
  createdAt: string;
}

export interface BillPaymentDto {
  id: string;
  financeAccountId: string;
  amount: number;
  paidAt: string;
  reference: string | null;
  reversedAt: string | null;
}

export interface BillableOrderLineDto {
  purchaseOrderLineId: string;
  materialId: string | null;
  description: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyBilled: number;
  qtyBillable: number;
  orderUnitCost: number;
}

export interface AgingReportDto {
  asOf: string;
  buckets: Record<AgingBucket, number>;
  total: number;
  ledgerBalance: number;
  difference: number;
  bills: {
    id: string;
    billNumber: string;
    supplierName: string;
    dueDate: string | null;
    outstanding: number;
    bucket: AgingBucket;
  }[];
}
