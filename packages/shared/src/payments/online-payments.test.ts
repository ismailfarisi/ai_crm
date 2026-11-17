import { describe, expect, it } from 'vitest';
import { allocateStageAmounts, validateBillingSchedule } from '../orders/billing';
import {
  depositSchedule,
  fromMinorUnits,
  toMinorUnits,
  updatePaymentSettingsSchema,
} from './online-payments';

describe('depositSchedule', () => {
  it('makes a deposit on acceptance and the balance later', () => {
    const stages = depositSchedule({ percent: 30 });
    expect(validateBillingSchedule(stages)).toEqual([]);
    expect(stages.map((s) => [s.kind, s.percent, s.trigger])).toEqual([
      ['DEPOSIT', 30, 'ON_APPROVAL'],
      ['FINAL', 70, 'MANUAL'],
    ]);
  });

  it('keeps a fixed deposit exact, with stages still adding to 100%', () => {
    const stages = depositSchedule({ amount: 1000, quoteTotal: 3150 });
    expect(validateBillingSchedule(stages)).toEqual([]);
    const [deposit, balance] = allocateStageAmounts(
      { subtotalAmount: 3000, discountAmount: 0, taxAmount: 150, totalAmount: 3150 },
      stages,
    );
    expect(deposit.totalAmount).toBe(1000);
    expect(balance.totalAmount).toBe(2150);
  });
});

describe('minor units', () => {
  it('counts AED in fils and KWD in thousandths', () => {
    expect(toMinorUnits(120.5, 'AED')).toBe(12050);
    expect(toMinorUnits(10.25, 'KWD')).toBe(10250);
    expect(fromMinorUnits(12050, 'aed')).toBe(120.5);
  });
});

describe('updatePaymentSettingsSchema', () => {
  const base = { provider: 'STRIPE', defaultDepositPercent: 30, payDeposits: true, payInvoices: true };

  it('keeps the saved secret when the field is left blank', () => {
    const parsed = updatePaymentSettingsSchema.parse({ ...base, secretKey: '', webhookSecret: null });
    expect(parsed.secretKey).toBeUndefined();
    expect(parsed.webhookSecret).toBeUndefined();
  });

  it('refuses something that is not a Stripe key', () => {
    const result = updatePaymentSettingsSchema.safeParse({ ...base, secretKey: 'pk_test_123' });
    expect(result.success).toBe(false);
  });

  it('refuses a deposit of 100% or more', () => {
    expect(updatePaymentSettingsSchema.safeParse({ ...base, defaultDepositPercent: 100 }).success).toBe(false);
  });
});
