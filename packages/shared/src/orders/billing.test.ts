import { describe, it, expect } from 'vitest';
import {
  acceptanceRefusalMessage,
  allocateStageAmounts,
  BILLING_PRESETS,
  DEFAULT_BILLING_SCHEDULE,
  validateBillingSchedule,
  type BillingStage,
} from './billing';

const stage = (percent: number, over: Partial<BillingStage> = {}): BillingStage => ({
  kind: 'MILESTONE',
  label: `${percent}%`,
  percent,
  trigger: 'MANUAL',
  ...over,
});

describe('validateBillingSchedule', () => {
  it('accepts every preset', () => {
    for (const preset of BILLING_PRESETS) {
      expect(validateBillingSchedule(preset.stages), preset.key).toEqual([]);
    }
  });

  it('refuses a schedule that bills less than everything', () => {
    // 99% leaves money nobody will ever invoice.
    expect(validateBillingSchedule([stage(30), stage(69, { kind: 'FINAL' })])).toContain(
      'Stages add up to 99%, not 100%.',
    );
  });

  it('refuses a schedule that bills more than everything', () => {
    expect(validateBillingSchedule([stage(50), stage(51, { kind: 'FINAL' })]).join(' ')).toContain('101%');
  });

  it('accepts thirds that total 100 once rounded to a thousandth', () => {
    expect(validateBillingSchedule([stage(33.333), stage(33.333), stage(33.334, { kind: 'FINAL' })])).toEqual([]);
  });

  it('refuses an empty schedule, a zero stage, two finals, and a final that is not last', () => {
    expect(validateBillingSchedule([])).toHaveLength(1);
    expect(validateBillingSchedule([stage(0), stage(100, { kind: 'FINAL' })]).join(' ')).toContain('more than 0%');
    expect(
      validateBillingSchedule([stage(50, { kind: 'FINAL' }), stage(50, { kind: 'FINAL' })]).join(' '),
    ).toContain('Only one stage can be the final one');
    expect(
      validateBillingSchedule([stage(50, { kind: 'FINAL' }), stage(50)]).join(' '),
    ).toContain('has to come last');
  });
});

describe('allocateStageAmounts', () => {
  const quote = { subtotalAmount: 1000, discountAmount: 0, taxAmount: 200, totalAmount: 1200 };

  it('bills the whole quote in one stage by default', () => {
    expect(allocateStageAmounts(quote, DEFAULT_BILLING_SCHEDULE)).toEqual([quote]);
  });

  it('splits a 30/70 deposit', () => {
    const [deposit, balance] = allocateStageAmounts(quote, BILLING_PRESETS[1].stages);
    expect(deposit).toEqual({ subtotalAmount: 300, discountAmount: 0, taxAmount: 60, totalAmount: 360 });
    expect(balance).toEqual({ subtotalAmount: 700, discountAmount: 0, taxAmount: 140, totalAmount: 840 });
  });

  it('never loses or invents a cent, however awkward the split', () => {
    // Three thirds of 100.00 rounded separately would invoice 99.99.
    const awkward = { subtotalAmount: 83.33, discountAmount: 0.01, taxAmount: 16.67, totalAmount: 100 };
    const stages = [stage(33.333), stage(33.333), stage(33.334, { kind: 'FINAL' })];
    const rows = allocateStageAmounts(awkward, stages);

    const sum = (f: keyof typeof awkward) =>
      Math.round(rows.reduce((s, r) => s + r[f] * 100, 0)) / 100;
    expect(sum('totalAmount')).toBe(100);
    expect(sum('subtotalAmount')).toBe(83.33);
    expect(sum('taxAmount')).toBe(16.67);
    expect(sum('discountAmount')).toBe(0.01);
  });

  it('gives the rounding remainder to the last stage, not the first', () => {
    const rows = allocateStageAmounts(
      { subtotalAmount: 10, discountAmount: 0, taxAmount: 0, totalAmount: 10 },
      [stage(33.333), stage(33.333), stage(33.334, { kind: 'FINAL' })],
    );
    expect(rows.map((r) => r.totalAmount)).toEqual([3.33, 3.33, 3.34]);
  });

  it('is exact on a large order', () => {
    const big = { subtotalAmount: 987654.32, discountAmount: 1234.56, taxAmount: 197283.95, totalAmount: 1183703.71 };
    const rows = allocateStageAmounts(big, BILLING_PRESETS[1].stages);
    expect(Math.round((rows[0].totalAmount + rows[1].totalAmount) * 100)).toBe(118370371);
  });
});

describe('acceptanceRefusalMessage', () => {
  it('never tells a stranger whether a quote exists', () => {
    // A public page must not distinguish "no such quote" from "wrong token".
    expect(acceptanceRefusalMessage('NOT_FOUND')).not.toMatch(/quote/i);
  });
});
