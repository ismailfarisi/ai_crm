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

  it('bills a fixed deposit to the cent and leaves the rest for the balance', () => {
    const [deposit, balance] = allocateStageAmounts(quote, [
      stage(41.67, { kind: 'DEPOSIT', amount: 500 }),
      stage(58.33, { kind: 'FINAL' }),
    ]);
    expect(deposit).toEqual({ subtotalAmount: 416.67, discountAmount: 0, taxAmount: 83.33, totalAmount: 500 });
    expect(balance).toEqual({ subtotalAmount: 583.33, discountAmount: 0, taxAmount: 116.67, totalAmount: 700 });
  });

  it('keeps the discount out of a fixed deposit\'s net', () => {
    // 10 x 1,000 less 20%, 5% VAT. The subtotal is already after the discount,
    // so adding the discount back made the deposit's net 5,000 on 4,200.
    const discounted = { subtotalAmount: 8000, discountAmount: 2000, taxAmount: 400, totalAmount: 8400 };
    const [deposit, balance] = allocateStageAmounts(discounted, [
      stage(50, { kind: 'DEPOSIT', amount: 4200 }),
      stage(50, { kind: 'FINAL' }),
    ]);
    expect(deposit).toEqual({ subtotalAmount: 4000, discountAmount: 1000, taxAmount: 200, totalAmount: 4200 });
    expect(balance).toEqual({ subtotalAmount: 4000, discountAmount: 1000, taxAmount: 200, totalAmount: 4200 });
  });

  it('makes net + tax the total on every stage, where separate rounding is a cent out', () => {
    // Halves rounded one figure at a time: 2,416.67 + 120.84 = 2,537.51 on an
    // invoice for 2,537.50.
    const odd = { subtotalAmount: 4833.33, discountAmount: 0, taxAmount: 241.67, totalAmount: 5075 };
    const [deposit, balance] = allocateStageAmounts(odd, BILLING_PRESETS[3].stages);
    expect(deposit).toEqual({ subtotalAmount: 2416.66, discountAmount: 0, taxAmount: 120.84, totalAmount: 2537.5 });
    expect(balance).toEqual({ subtotalAmount: 2416.67, discountAmount: 0, taxAmount: 120.83, totalAmount: 2537.5 });
  });

  it('holds net + tax = total and the quote\'s sums for any split', () => {
    const c = (n: number) => Math.round(n * 100);
    const schedules = [
      BILLING_PRESETS[1].stages,
      BILLING_PRESETS[3].stages,
      [stage(33.333), stage(33.333), stage(33.334, { kind: 'FINAL' })],
      [stage(10), stage(15), stage(20), stage(25), stage(30, { kind: 'FINAL' })],
      [stage(20, { kind: 'DEPOSIT', amount: 777.77 }), stage(30), stage(50, { kind: 'FINAL' })],
    ];
    for (let i = 1; i <= 400; i++) {
      // Awkward nets at 5% VAT, with and without a discount.
      const net = c(i * 37.91 + (i % 7) * 0.13);
      const tax = Math.round(net * 0.05);
      const quoted = {
        subtotalAmount: net / 100,
        discountAmount: i % 3 ? 0 : Math.round(net * 0.25) / 100,
        taxAmount: tax / 100,
        totalAmount: (net + tax) / 100,
      };
      for (const stages of schedules) {
        const rows = allocateStageAmounts(quoted, stages);
        for (const row of rows) {
          expect(c(row.subtotalAmount) + c(row.taxAmount)).toBe(c(row.totalAmount));
          expect(c(row.totalAmount)).toBeGreaterThanOrEqual(0);
          expect(c(row.taxAmount)).toBeGreaterThanOrEqual(0);
        }
        for (const f of ['subtotalAmount', 'discountAmount', 'taxAmount', 'totalAmount'] as const) {
          expect(rows.reduce((s, r) => s + c(r[f]), 0)).toBe(c(quoted[f]));
        }
      }
    }
  });

  it('never lets a fixed deposit bill more than the quote', () => {
    const [deposit, balance] = allocateStageAmounts(quote, [
      stage(50, { kind: 'DEPOSIT', amount: 5000 }),
      stage(50, { kind: 'FINAL' }),
    ]);
    expect(deposit).toEqual(quote);
    expect(balance).toEqual({ subtotalAmount: 0, discountAmount: 0, taxAmount: 0, totalAmount: 0 });
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
    const big = { subtotalAmount: 986419.76, discountAmount: 1234.56, taxAmount: 197283.95, totalAmount: 1183703.71 };
    const rows = allocateStageAmounts(big, BILLING_PRESETS[1].stages);
    expect(Math.round((rows[0].totalAmount + rows[1].totalAmount) * 100)).toBe(118370371);
    expect(Math.round((rows[0].subtotalAmount + rows[1].subtotalAmount) * 100)).toBe(98641976);
    for (const row of rows) {
      expect(Math.round((row.subtotalAmount + row.taxAmount) * 100)).toBe(Math.round(row.totalAmount * 100));
    }
  });
});

describe('acceptanceRefusalMessage', () => {
  it('never tells a stranger whether a quote exists', () => {
    // A public page must not distinguish "no such quote" from "wrong token".
    expect(acceptanceRefusalMessage('NOT_FOUND')).not.toMatch(/quote/i);
  });
});

describe('invoicing per delivery', () => {
  it('is valid on its own', () => {
    expect(validateBillingSchedule(BILLING_PRESETS.find((p) => p.key === 'per-delivery')!.stages)).toEqual([]);
  });

  it('cannot be combined with percentage stages', () => {
    expect(
      validateBillingSchedule([
        stage(30, { kind: 'DEPOSIT', trigger: 'ON_APPROVAL' }),
        stage(70, { kind: 'FINAL', trigger: 'ON_DELIVERY' }),
      ]).join(' '),
    ).toMatch(/only stage/);
  });
});
