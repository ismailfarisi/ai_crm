import { describe, expect, it } from 'vitest';
import { createRecurringExpenseSchema, updateRecurringExpenseSchema } from './recurring-expense';

const base = {
  supplierId: '11111111-1111-4111-8111-111111111111',
  vendorName: 'Al Barsha Properties',
  category: 'Rent & premises',
  amount: '120000',
  billingInterval: 'ANNUAL',
  startDate: '2026-01-01',
};

describe('createRecurringExpenseSchema', () => {
  it('coerces and defaults', () => {
    const out = createRecurringExpenseSchema.parse(base);
    expect(out).toMatchObject({ amount: 120000, endDate: null, autoApprove: false, spreadOverPeriod: true, taxCodeId: null });
  });

  it('defaults spreading off for monthly and forces it off when sent', () => {
    expect(createRecurringExpenseSchema.parse({ ...base, billingInterval: 'MONTHLY' }).spreadOverPeriod).toBe(false);
    expect(createRecurringExpenseSchema.parse({ ...base, billingInterval: 'MONTHLY', spreadOverPeriod: true }).spreadOverPeriod).toBe(false);
  });

  it('normalises legacy categories', () => {
    expect(createRecurringExpenseSchema.parse({ ...base, category: 'Cloud Infrastructure' }).category).toBe('Software & SaaS');
  });

  it('accepts null supplier (forecast-only) and nulls from a loaded row', () => {
    const out = createRecurringExpenseSchema.parse({ ...base, supplierId: null, endDate: null, taxCodeId: null });
    expect(out.supplierId).toBeNull();
  });

  it('rejects an end date on or before the start', () => {
    expect(() => createRecurringExpenseSchema.parse({ ...base, endDate: '2026-01-01' })).toThrow();
  });

  it('update is partial', () => {
    expect(updateRecurringExpenseSchema.parse({ amount: '9000' })).toEqual({ amount: 9000 });
  });
});
