/**
 * Moving-average stock valuation.
 *
 * Kept pure and shared so the receiving screen can show what a receipt will do
 * to the average cost before anyone commits it, and the API can compute the
 * same number on save. The browser copy is a preview; the server copy is what
 * gets stored.
 */

/** Why stock moved. The ledger is append-only; this is the vocabulary. */
export type StockMovementType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'ADJUSTMENT'
  | 'RETURN'
  | 'TRANSFER';

export const STOCK_MOVEMENT_TYPES: StockMovementType[] = [
  'RECEIPT',
  'ISSUE',
  'ADJUSTMENT',
  'RETURN',
  'TRANSFER',
];

/** What a movement was caused by, so a quantity can always be explained. */
export type StockReferenceType =
  | 'GOODS_RECEIPT'
  | 'PURCHASE_ORDER'
  | 'WORK_ORDER'
  | 'DELIVERY_NOTE'
  | 'MANUAL';

/**
 * Quantities and unit costs are held at 4dp, matching `Material.costPerUom`
 * and `SupplierMaterial.unitCost`. A unit cost gets divided (sheets into
 * pieces, kilos into grams) before being multiplied back up by an order
 * quantity, and rounding to two places there compounds.
 */
export const COST_DP = 4;
export const QTY_DP = 4;

const round = (value: number, dp: number): number => {
  const factor = 10 ** dp;
  // `Number.EPSILON` nudges values that land exactly on a rounding boundary in
  // binary float (0.615 stored as 0.6149999…) up to where a person expects.
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const roundCost = (value: number): number => round(value, COST_DP);
export const roundQty = (value: number): number => round(value, QTY_DP);

export interface StockPosition {
  qtyOnHand: number;
  avgUnitCost: number;
}

export interface ReceiptValuation extends StockPosition {
  /** What the received goods were worth, at the price actually paid. */
  receiptValue: number;
  /**
   * Change in the value of stock on hand, as qty × the rounded average.
   *
   * Not what a receipt posts: that is `receiptValue`, the price actually paid.
   * The two differ by the rounding in a four-place average, and posting this
   * one would leave that rounding stranded in goods-received-not-invoiced
   * when the supplier's bill clears the exact figure. It is what an *issue*
   * posts, where no bill will ever come to clear it.
   */
  valueDelta: number;
}

/**
 * Folds a receipt into a position.
 *
 * The weighted average is the whole point: stock bought at two prices cannot
 * be told apart on the shelf, so the cost of what leaves has to be the blend
 * of what came in.
 *
 *   newAvg = (qtyOnHand × avgUnitCost + qtyReceived × unitCost) / totalQty
 *
 * Two cases are deliberately not averaged:
 *
 * - Nothing on hand: the new average *is* the price just paid. Averaging
 *   against a stale cost on a zero balance would carry a dead number forward.
 * - Stock currently negative (issued more than was received, which the
 *   adjustment path allows): averaging across the sign change produces a
 *   meaningless figure, so the incoming price wins outright.
 */
export function applyReceipt(
  position: StockPosition,
  qtyReceived: number,
  unitCost: number,
): ReceiptValuation {
  if (!(qtyReceived > 0)) {
    throw new RangeError('Received quantity must be above zero');
  }
  if (unitCost < 0) {
    throw new RangeError('Unit cost cannot be negative');
  }

  const qtyBefore = position.qtyOnHand;
  const qtyAfter = roundQty(qtyBefore + qtyReceived);
  const receiptValue = roundCost(qtyReceived * unitCost);

  const avgUnitCost =
    qtyBefore <= 0
      ? roundCost(unitCost)
      : roundCost((qtyBefore * position.avgUnitCost + qtyReceived * unitCost) / qtyAfter);

  const valueBefore = qtyBefore > 0 ? roundCost(qtyBefore * position.avgUnitCost) : 0;
  const valueAfter = roundCost(qtyAfter * avgUnitCost);

  return {
    qtyOnHand: qtyAfter,
    avgUnitCost,
    receiptValue,
    valueDelta: roundCost(valueAfter - valueBefore),
  };
}

/**
 * Takes stock out at the current average.
 *
 * The average does not move on the way out — that is what makes it a *moving*
 * average rather than a running recalculation. Issuing more than is on hand is
 * allowed here rather than refused, because the physical stock has already
 * gone; the resulting negative balance is a signal to go and count, not a
 * state to forbid at the arithmetic layer.
 */
export function applyIssue(position: StockPosition, qtyIssued: number): ReceiptValuation {
  if (!(qtyIssued > 0)) {
    throw new RangeError('Issued quantity must be above zero');
  }

  const qtyAfter = roundQty(position.qtyOnHand - qtyIssued);
  const issueValue = roundCost(qtyIssued * position.avgUnitCost);

  return {
    qtyOnHand: qtyAfter,
    avgUnitCost: position.avgUnitCost,
    receiptValue: issueValue,
    valueDelta: roundCost(-issueValue),
  };
}

/**
 * Whether a receipt of `qty` against a line is acceptable.
 *
 * Suppliers routinely send a little over or under. `tolerancePct` is the
 * tenant's own allowance; without it, every short delivery would need an
 * order amendment before the goods could be booked in.
 */
export function isReceiptWithinTolerance(
  qtyOrdered: number,
  qtyAlreadyReceived: number,
  qtyNow: number,
  tolerancePct: number,
): boolean {
  const permitted = qtyOrdered * (1 + Math.max(0, tolerancePct));
  return roundQty(qtyAlreadyReceived + qtyNow) <= roundQty(permitted);
}

/** Stock is low when what is on hand, less what is spoken for, is at or below the trigger. */
export function needsReorder(
  item: { qtyOnHand: number; qtyReserved: number; qtyOnOrder: number; reorderPoint: number | null },
): boolean {
  if (item.reorderPoint == null) return false;
  const available = item.qtyOnHand - item.qtyReserved + item.qtyOnOrder;
  return roundQty(available) <= item.reorderPoint;
}

/**
 * Replays a movement ledger into a position.
 *
 * `stock_items` is a cached projection of `stock_movements`; this is the
 * function that proves the two agree. A divergence means something wrote a
 * quantity without recording why, which is the bug worth catching early.
 */
export function replayMovements(
  movements: { type: StockMovementType; qtyDelta: number; unitCost: number }[],
): StockPosition {
  let position: StockPosition = { qtyOnHand: 0, avgUnitCost: 0 };

  for (const movement of movements) {
    if (movement.qtyDelta > 0) {
      const next = applyReceipt(position, movement.qtyDelta, movement.unitCost);
      position = { qtyOnHand: next.qtyOnHand, avgUnitCost: next.avgUnitCost };
    } else if (movement.qtyDelta < 0) {
      const next = applyIssue(position, -movement.qtyDelta);
      position = { qtyOnHand: next.qtyOnHand, avgUnitCost: next.avgUnitCost };
    }
  }

  return position;
}
