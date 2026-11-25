/**
 * Quoted against actual cost for one customer order: what the shop priced,
 * what it expected to spend, what it has spent so far and what is left.
 *
 * Everything is in the shop's base currency. Cost figures are only ever sent
 * to people who hold `quote:view_cost`.
 */

export type JobCostSourceKind = 'PURCHASE_ORDER' | 'SUPPLIER_BILL' | 'EXPENSE_CLAIM';

/** One bought-in cost counted against the job, or still on order for it. */
export interface JobCostSourceDto {
  kind: JobCostSourceKind;
  id: string;
  /** PO-2026-0012, BILL-0031, EXP-0007. */
  number: string;
  /** The supplier, or the person who claimed it. */
  party: string;
  description: string;
  /** Counted so far, net of VAT the shop gets back. */
  counted: number;
  /** Ordered but not yet received or billed: not in the actual cost yet. */
  onOrder: number;
}

export interface JobCostActual {
  /** Stock issued to the job's work orders or dispatched on its deliveries, at moving average. */
  material: number;
  /** Timesheet and payroll labour on its work orders. */
  labour: number;
  /** Machine time, tooling and overhead on its work orders. */
  machineAndOverhead: number;
  /** Purchase orders, supplier bills and expense claims marked for this job. */
  boughtIn: number;
  total: number;
}

export interface OrderJobCostDto {
  orderId: string;
  /** The base currency every figure below is in. */
  currency: string;
  /** The order's price before VAT, in base currency. */
  price: number;
  /** What the quote expected the job to cost; null when no line had a cost. */
  quotedCost: number | null;
  /** False when some priced line on the quote had no cost, so `quotedCost` is too low. */
  quotedCostComplete: boolean;
  /** price - quotedCost. */
  quotedMargin: number | null;
  actual: JobCostActual;
  /** Bought-in cost ordered for the job but not yet received or billed. */
  onOrder: number;
  /** price - actual.total: what is left of the price after what has been spent. */
  marginLeft: number;
  /** marginLeft / price, 0..1; null when the order has no price. */
  marginLeftPct: number | null;
  /** How far actual cost is past the quoted cost, as a fraction; null without a quoted cost. */
  overByPct: number | null;
  /** The costing-policy threshold the warning uses, as a fraction (0.1 = 10%). */
  alertPct: number;
  /** Actual cost has passed the quoted cost by more than `alertPct`. */
  overBudget: boolean;
  /** How many live work orders the actual cost reads. */
  workOrders: number;
  sources: JobCostSourceDto[];
  /** Set when the order's currency had no exchange rate, so the price was taken as base. */
  priceRateMissing?: boolean;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Rolls the parts into margins and the over-budget flag. Pure, so web and API agree. */
export function summariseJobCost(input: {
  price: number;
  quotedCost: number | null;
  material: number;
  labour: number;
  machineAndOverhead: number;
  boughtIn: number;
  alertPct: number;
}): Pick<
  OrderJobCostDto,
  'quotedMargin' | 'actual' | 'marginLeft' | 'marginLeftPct' | 'overByPct' | 'overBudget'
> {
  const actual: JobCostActual = {
    material: r2(input.material),
    labour: r2(input.labour),
    machineAndOverhead: r2(input.machineAndOverhead),
    boughtIn: r2(input.boughtIn),
    total: r2(input.material + input.labour + input.machineAndOverhead + input.boughtIn),
  };
  const price = r2(input.price);
  const quoted = input.quotedCost != null && input.quotedCost > 0 ? r2(input.quotedCost) : null;
  const overByPct = quoted != null ? Number(((actual.total - quoted) / quoted).toFixed(4)) : null;
  const marginLeft = r2(price - actual.total);
  return {
    quotedMargin: input.quotedCost != null ? r2(price - input.quotedCost) : null,
    actual,
    marginLeft,
    marginLeftPct: price > 0 ? Number((marginLeft / price).toFixed(4)) : null,
    overByPct,
    overBudget: overByPct != null && overByPct > Math.max(0, input.alertPct),
  };
}
