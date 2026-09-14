import { describe, it, expect } from 'vitest';
import {
  applyIssue,
  applyReceipt,
  isReceiptWithinTolerance,
  needsReorder,
  replayMovements,
  roundCost,
} from './valuation';

describe('applyReceipt', () => {
  it('takes the incoming price when nothing is on hand', () => {
    // Averaging against a stale cost on a zero balance would carry a dead
    // number forward.
    const result = applyReceipt({ qtyOnHand: 0, avgUnitCost: 9.99 }, 500, 0.42);

    expect(result.qtyOnHand).toBe(500);
    expect(result.avgUnitCost).toBe(0.42);
    expect(result.receiptValue).toBe(210);
    expect(result.valueDelta).toBe(210);
  });

  it('weights the average by quantity, not by price', () => {
    // 100 @ 1.00 then 300 @ 2.00 is 1.75, not the 1.50 midpoint.
    const result = applyReceipt({ qtyOnHand: 100, avgUnitCost: 1 }, 300, 2);

    expect(result.qtyOnHand).toBe(400);
    expect(result.avgUnitCost).toBe(1.75);
    expect(result.receiptValue).toBe(600);
    expect(result.valueDelta).toBe(600);
  });

  it.each([
    // [onHand, avgCost, qtyIn, priceIn, expectedAvg]
    [0, 0, 1, 3.3333, 3.3333],
    [1, 1, 1, 2, 1.5],
    [129, 0.42, 129, 0.48, 0.45],
    [2, 0.005, 1, 0.008, 0.006],
    [1000, 0.4212, 1, 9.99, 0.4308],
  ])(
    'on hand %s @ %s receiving %s @ %s gives %s',
    (onHand, avgCost, qtyIn, priceIn, expectedAvg) => {
      const result = applyReceipt({ qtyOnHand: onHand, avgUnitCost: avgCost }, qtyIn, priceIn);
      expect(result.avgUnitCost).toBe(expectedAvg);
    },
  );

  it('holds four decimal places, because unit costs get divided', () => {
    // A sheet cost divided into pieces and multiplied back up compounds any
    // rounding done at two places.
    const result = applyReceipt({ qtyOnHand: 3, avgUnitCost: 0.3333 }, 3, 0.6667);
    expect(result.avgUnitCost).toBe(0.5);
    expect(roundCost(result.avgUnitCost * 6)).toBe(3);
  });

  it('lets the incoming price win outright when stock is negative', () => {
    // Averaging across a sign change produces a meaningless figure.
    const result = applyReceipt({ qtyOnHand: -10, avgUnitCost: 5 }, 20, 2);
    expect(result.avgUnitCost).toBe(2);
    expect(result.qtyOnHand).toBe(10);
  });

  it('refuses a zero or negative receipt', () => {
    expect(() => applyReceipt({ qtyOnHand: 0, avgUnitCost: 0 }, 0, 1)).toThrow(RangeError);
    expect(() => applyReceipt({ qtyOnHand: 0, avgUnitCost: 0 }, -5, 1)).toThrow(RangeError);
  });

  it('refuses a negative unit cost', () => {
    expect(() => applyReceipt({ qtyOnHand: 0, avgUnitCost: 0 }, 5, -1)).toThrow(RangeError);
  });

  it('accepts a free receipt', () => {
    // Samples and replacements arrive at zero, and must not be refused.
    const result = applyReceipt({ qtyOnHand: 100, avgUnitCost: 2 }, 100, 0);
    expect(result.avgUnitCost).toBe(1);
    expect(result.receiptValue).toBe(0);
  });
});

describe('applyIssue', () => {
  it('does not move the average on the way out', () => {
    const result = applyIssue({ qtyOnHand: 400, avgUnitCost: 1.75 }, 100);

    expect(result.qtyOnHand).toBe(300);
    expect(result.avgUnitCost).toBe(1.75);
    expect(result.valueDelta).toBe(-175);
  });

  it('allows stock to go negative rather than refusing', () => {
    // The physical stock has already gone; a negative balance is a signal to
    // count, not a state to forbid in the arithmetic.
    const result = applyIssue({ qtyOnHand: 5, avgUnitCost: 2 }, 8);
    expect(result.qtyOnHand).toBe(-3);
  });

  it('refuses a zero or negative issue', () => {
    expect(() => applyIssue({ qtyOnHand: 10, avgUnitCost: 1 }, 0)).toThrow(RangeError);
  });
});

describe('replayMovements', () => {
  it('reproduces a position from its ledger', () => {
    // stock_items is a cached projection of stock_movements; this is what
    // proves the two agree.
    const position = replayMovements([
      { type: 'RECEIPT', qtyDelta: 100, unitCost: 1 },
      { type: 'RECEIPT', qtyDelta: 300, unitCost: 2 },
      { type: 'ISSUE', qtyDelta: -100, unitCost: 1.75 },
    ]);

    expect(position.qtyOnHand).toBe(300);
    expect(position.avgUnitCost).toBe(1.75);
  });

  it('is order-dependent, as a weighted average must be', () => {
    const cheapFirst = replayMovements([
      { type: 'RECEIPT', qtyDelta: 10, unitCost: 1 },
      { type: 'ISSUE', qtyDelta: -10, unitCost: 0 },
      { type: 'RECEIPT', qtyDelta: 10, unitCost: 5 },
    ]);
    // Emptying the shelf resets the average to whatever arrives next.
    expect(cheapFirst.avgUnitCost).toBe(5);
  });

  it('returns an empty position for an empty ledger', () => {
    expect(replayMovements([])).toEqual({ qtyOnHand: 0, avgUnitCost: 0 });
  });

  it('ignores zero-quantity movements', () => {
    const position = replayMovements([
      { type: 'RECEIPT', qtyDelta: 10, unitCost: 2 },
      { type: 'ADJUSTMENT', qtyDelta: 0, unitCost: 0 },
    ]);
    expect(position).toEqual({ qtyOnHand: 10, avgUnitCost: 2 });
  });
});

describe('isReceiptWithinTolerance', () => {
  it('accepts an exact delivery', () => {
    expect(isReceiptWithinTolerance(500, 0, 500, 0)).toBe(true);
  });

  it('accepts a short delivery, which is always allowed', () => {
    expect(isReceiptWithinTolerance(500, 0, 100, 0)).toBe(true);
  });

  it('refuses an over-delivery with no tolerance', () => {
    expect(isReceiptWithinTolerance(500, 0, 501, 0)).toBe(false);
  });

  it('accepts an over-delivery inside the tolerance', () => {
    expect(isReceiptWithinTolerance(500, 0, 525, 0.05)).toBe(true);
    expect(isReceiptWithinTolerance(500, 0, 526, 0.05)).toBe(false);
  });

  it('counts what has already been received', () => {
    expect(isReceiptWithinTolerance(500, 400, 100, 0)).toBe(true);
    expect(isReceiptWithinTolerance(500, 400, 101, 0)).toBe(false);
  });
});

describe('needsReorder', () => {
  it('stays quiet when no reorder point is set', () => {
    expect(
      needsReorder({ qtyOnHand: 0, qtyReserved: 0, qtyOnOrder: 0, reorderPoint: null }),
    ).toBe(false);
  });

  it('triggers at or below the point', () => {
    expect(
      needsReorder({ qtyOnHand: 50, qtyReserved: 0, qtyOnOrder: 0, reorderPoint: 50 }),
    ).toBe(true);
    expect(
      needsReorder({ qtyOnHand: 51, qtyReserved: 0, qtyOnOrder: 0, reorderPoint: 50 }),
    ).toBe(false);
  });

  it('counts stock already on order, so one shortage is not ordered twice', () => {
    expect(
      needsReorder({ qtyOnHand: 10, qtyReserved: 0, qtyOnOrder: 100, reorderPoint: 50 }),
    ).toBe(false);
  });

  it('discounts stock reserved for jobs', () => {
    expect(
      needsReorder({ qtyOnHand: 100, qtyReserved: 60, qtyOnOrder: 0, reorderPoint: 50 }),
    ).toBe(true);
  });
});
