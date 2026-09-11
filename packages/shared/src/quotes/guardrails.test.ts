import { describe, it, expect } from 'vitest';
import { DEFAULT_COSTING_POLICY, evaluateGuardrails, isWithinPolicy } from './guardrails';
import { calculateQuoteTotals } from './types';
import type { QuoteLineItem } from './types';

const policy = { ...DEFAULT_COSTING_POLICY, enforce: true };

function line(overrides: Partial<QuoteLineItem> = {}): QuoteLineItem {
  return {
    id: 'line-1',
    type: 'product',
    description: 'Rigid gift box',
    quantity: 500,
    unitPrice: 4,
    discount: 0,
    taxRate: 0,
    cost: { unitCost: 2.4, totalCost: 1200, source: 'COMPUTED' },
    ...overrides,
  };
}

const check = (items: QuoteLineItem[], p = policy) =>
  evaluateGuardrails(items, calculateQuoteTotals(items), p);

describe('evaluateGuardrails', () => {
  it('passes a healthy quote', () => {
    // 500 × 4 = 2000 subtotal against 1200 cost = 40% margin.
    const violations = check([line()]);
    expect(violations).toEqual([]);
    expect(isWithinPolicy(violations)).toBe(true);
  });

  it('does nothing at all while enforcement is off', () => {
    const thin = [line({ unitPrice: 2.5, discount: 90 })];
    expect(check(thin, { ...policy, enforce: false })).toEqual([]);
    expect(check(thin).length).toBeGreaterThan(0);
  });

  it('flags a margin below the floor', () => {
    // 500 × 2.5 = 1250 against 1200 cost = 4% margin.
    const [violation] = check([line({ unitPrice: 2.5 })]);

    expect(violation.code).toBe('MARGIN_BELOW_FLOOR');
    expect(violation.message).toMatch(/below the 20.0% floor/);
    expect(violation.actual).toBeCloseTo(0.04, 2);
    expect(violation.limit).toBe(0.2);
  });

  it('flags a line discounted past the cap and names it', () => {
    const violations = check([line({ discount: 35, description: 'Magnetic box' })]);
    const discount = violations.find((v) => v.code === 'DISCOUNT_ABOVE_CAP');

    expect(discount).toBeDefined();
    expect(discount!.lineId).toBe('line-1');
    expect(discount!.message).toContain('Magnetic box');
    expect(discount!.message).toContain('35%');
  });

  it('counts the discount against margin too, not just the cap', () => {
    // A 25% discount takes 2000 down to 1500 against 1200 cost = 20%... just
    // on the floor, so only the cap fires.
    const violations = check([line({ discount: 25 })]);
    expect(violations.map((v) => v.code)).toEqual(['DISCOUNT_ABOVE_CAP']);

    // 40% off is 1200 against 1200 cost — zero margin, both fire.
    const worse = check([line({ discount: 40 })]);
    expect(worse.map((v) => v.code).sort()).toEqual([
      'DISCOUNT_ABOVE_CAP',
      'MARGIN_BELOW_FLOOR',
    ]);
  });

  /**
   * The subtle one: a hand-typed line has no cost, so `costAmount` understates
   * and `marginPct` overstates. Checking that inflated number against the floor
   * would wave through a quote nobody has actually verified.
   */
  describe('unknown cost', () => {
    const mixed = [line(), line({ id: 'line-2', cost: undefined, unitPrice: 10 })];

    it('does not test an unverifiable margin against the floor', () => {
      const totals = calculateQuoteTotals(mixed);
      expect(totals.hasCompleteCost).toBe(false);
      // The reported margin looks excellent precisely because a cost is missing.
      expect(totals.marginPct).toBeGreaterThan(0.2);

      expect(check(mixed).map((v) => v.code)).not.toContain('MARGIN_BELOW_FLOOR');
    });

    it('blocks on unknown cost when the tenant demands it', () => {
      const violations = check(mixed, { ...policy, requireKnownCost: true });
      const unknown = violations.find((v) => v.code === 'COST_UNKNOWN');

      expect(unknown).toBeDefined();
      expect(unknown!.message).toMatch(/cannot be verified/);
    });

    it('stays quiet on an empty quote', () => {
      expect(check([], { ...policy, requireKnownCost: true })).toEqual([]);
    });
  });

  it('ignores sections and notes', () => {
    const violations = check([
      { id: 's1', type: 'section', description: 'Phase 1' },
      { id: 'n1', type: 'note', description: 'Note: rush job' },
      line(),
    ]);
    expect(violations).toEqual([]);
  });

  it('defaults to enforcement off, so turning the engine on breaks nothing', () => {
    expect(DEFAULT_COSTING_POLICY.enforce).toBe(false);
  });
});
