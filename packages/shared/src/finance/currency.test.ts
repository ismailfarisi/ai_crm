import { describe, expect, it } from 'vitest';
import { isBalanced } from './ledger';
import { convertLines, fxBalancingLine, monthEnd, revaluationDelta, toBase } from './currency';

describe('toBase', () => {
  it('converts to the cent', () => {
    expect(toBase(100, 0.85)).toBe(85);
    expect(toBase(33.33, 1.17)).toBe(39);
    expect(toBase(10, 1)).toBe(10);
  });
});

describe('convertLines', () => {
  it('leaves a single-rate entry balanced, bar rounding', () => {
    const { lines, imbalance } = convertLines(
      [
        { debit: 120, credit: 0 },
        { debit: 0, credit: 100 },
        { debit: 0, credit: 20 },
      ],
      0.85,
    );
    expect(lines.map((l) => [l.debit, l.credit])).toEqual([
      [102, 0],
      [0, 85],
      [0, 17],
    ]);
    expect(imbalance).toBe(0);
  });

  it('turns a rate difference into an exchange gain', () => {
    // Invoiced €1,000 at 0.85 (£850). Paid when the euro is worth 0.87: the
    // bank receives £870 but the receivable only clears £850.
    const { lines, imbalance } = convertLines(
      [
        { debit: 1000, credit: 0, fxRate: 0.87 },
        { debit: 0, credit: 1000, fxRate: 0.85 },
      ],
      0.87,
    );
    expect(lines.map((l) => [l.debit, l.credit])).toEqual([
      [870, 0],
      [0, 850],
    ]);
    expect(imbalance).toBe(20);
    const fx = fxBalancingLine(imbalance)!;
    // A gain is a credit to the exchange account.
    expect(fx).toEqual({ debit: 0, credit: 20 });
    expect(isBalanced([...lines, fx])).toBe(true);
  });

  it('turns the opposite move into a loss', () => {
    const { imbalance } = convertLines(
      [
        { debit: 1000, credit: 0, fxRate: 0.83 },
        { debit: 0, credit: 1000, fxRate: 0.85 },
      ],
      0.83,
    );
    expect(fxBalancingLine(imbalance)).toEqual({ debit: 20, credit: 0 });
  });

  it('needs no balancing line when nothing moved', () => {
    expect(fxBalancingLine(0)).toBeNull();
  });
});

describe('revaluationDelta', () => {
  it('values an open balance at the new rate', () => {
    expect(revaluationDelta(1000, 0.85, 0.9)).toBeCloseTo(50, 10);
    expect(revaluationDelta(1000, 0.85, 0.8)).toBeCloseTo(-50, 10);
  });
});

describe('monthEnd', () => {
  it('is the last day of the month, leap years included', () => {
    expect(monthEnd(new Date('2028-02-10T12:00:00Z')).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(monthEnd(new Date('2026-12-31T23:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-31');
  });
});
