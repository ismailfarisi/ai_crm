import { describe, expect, it } from 'vitest';
import { CURRENCY_OPTIONS, currencyLabel, currencyLongLabel } from './currency';

/**
 * There used to be three lists: SAR could be quoted but never held or used as
 * a base, SGD held but never quoted, and INR/SEK/DKK/NOK/PLN could be a base
 * currency with no account and no document able to use them.
 */
describe('currency options', () => {
  it('offers every currency that any screen used to offer', () => {
    const codes = CURRENCY_OPTIONS.map((c) => c.code);
    for (const code of ['GBP', 'EUR', 'USD', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN',
                        'CAD', 'AUD', 'JPY', 'INR', 'AED', 'SAR', 'SGD']) {
      expect(codes).toContain(code);
    }
  });

  it('has no duplicate codes', () => {
    const codes = CURRENCY_OPTIONS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('labels a currency in both the short and the long form', () => {
    expect(currencyLabel('USD')).toBe('USD ($)');
    expect(currencyLongLabel('USD')).toBe('USD ($) — US Dollar');
  });

  it('falls back to the code for anything it does not know', () => {
    expect(currencyLabel('XYZ')).toBe('XYZ');
  });
});
