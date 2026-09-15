import { describe, expect, it } from 'vitest';
import {
  normaliseCountry,
  resolveTaxCode,
  scaleBreakdown,
  taxBreakdown,
  type TaxCodeDto,
  type TaxRuleDto,
} from './tax';

const code = (id: string, rate: number, over: Partial<TaxCodeDto> = {}): TaxCodeDto => ({
  id,
  code: id,
  name: id,
  rate,
  kind: 'SALES',
  isReverseCharge: false,
  ledgerAccountId: null,
  isActive: true,
  ...over,
});

const rule = (country: string, taxCodeId: string, over: Partial<TaxRuleDto> = {}): TaxRuleDto => ({
  id: `${country}-${taxCodeId}`,
  kind: 'SALES',
  country,
  requiresTaxId: false,
  taxCodeId,
  priority: 0,
  ...over,
});

const codes = [code('STD', 20), code('RC', 0, { isReverseCharge: true }), code('EXP', 0), code('EUB2C', 20)];
const rules = [
  rule('GB', 'STD'),
  rule('EU', 'RC', { requiresTaxId: true }),
  rule('EU', 'EUB2C'),
  rule('*', 'EXP'),
];

describe('normaliseCountry', () => {
  it.each([
    ['United Kingdom', 'GB'],
    [' uk ', 'GB'],
    ['gb', 'GB'],
    ['Deutschland', 'DE'],
    ['U.S.A.', 'US'],
    ['Narnia', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(normaliseCountry(input)).toBe(expected);
  });
});

describe('resolveTaxCode', () => {
  it('charges standard rate at home, even though the home country is also in the EU group', () => {
    // The exact country rule must win over EU, or a domestic VAT-registered
    // customer would be invoiced reverse charge.
    const homeEu = [rule('IE', 'STD'), ...rules.slice(1)];
    expect(resolveTaxCode({ country: 'Ireland', taxId: 'IE1234567T' }, 'SALES', homeEu, codes)?.code.id).toBe('STD');
  });

  it('applies reverse charge to an EU business customer without anyone choosing it', () => {
    expect(resolveTaxCode({ country: 'Germany', taxId: 'DE123456789' }, 'SALES', rules, codes)?.code.id).toBe('RC');
  });

  it('charges VAT to an EU consumer, who has no VAT number', () => {
    expect(resolveTaxCode({ country: 'FR', taxId: null }, 'SALES', rules, codes)?.code.id).toBe('EUB2C');
  });

  it('zero-rates an export outside the EU', () => {
    expect(resolveTaxCode({ country: 'United States', taxId: '12-345' }, 'SALES', rules, codes)?.code.id).toBe('EXP');
  });

  it('returns nothing when no rule matches, so the typed rate stands', () => {
    expect(resolveTaxCode({ country: 'GB', taxId: null }, 'SALES', [rule('US', 'STD')], codes)).toBeNull();
    expect(resolveTaxCode({ country: 'GB', taxId: null }, 'SALES', [], codes)).toBeNull();
  });

  it('ignores inactive codes and codes of the other kind', () => {
    const inactive = [code('STD', 20, { isActive: false }), code('EXP', 0)];
    expect(resolveTaxCode({ country: 'GB', taxId: null }, 'SALES', rules, inactive)?.code.id).toBe('EXP');
    expect(resolveTaxCode({ country: 'GB', taxId: null }, 'PURCHASE', rules, codes)).toBeNull();
  });
});

describe('taxBreakdown', () => {
  it('computes tax on the summed net per code, not per line', () => {
    // Three lines of 0.05 at 20%: per-line tax rounds to 0.01 × 3 = 0.03,
    // but the tax on 0.15 is 0.03 as well — pick lines where they differ.
    const lines = Array.from({ length: 3 }, () => ({ net: 0.07, rate: 20, taxCodeId: 'STD', code: 'STD' }));
    const [row] = taxBreakdown(lines);
    expect(row.net).toBe(0.21);
    expect(row.tax).toBe(0.04);
  });

  it('keeps reverse charge separate and at zero tax', () => {
    const rows = taxBreakdown([
      { net: 100, rate: 20, taxCodeId: 'STD', code: 'STD' },
      { net: 50, rate: 20, taxCodeId: 'RC', code: 'RC', reverseCharge: true },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ code: 'STD', net: 100, tax: 20 }),
      expect.objectContaining({ code: 'RC', net: 50, tax: 0, reverseCharge: true }),
    ]);
  });

  it('groups legacy lines with no code by their rate', () => {
    const rows = taxBreakdown([{ net: 10, rate: 5 }, { net: 10, rate: 5 }, { net: 10, rate: 20 }]);
    expect(rows.map((r) => [r.code, r.net, r.tax])).toEqual([
      ['No code', 20, 1],
      ['No code', 10, 2],
    ]);
  });
});

describe('scaleBreakdown', () => {
  it('splits a breakdown to a stage total without losing a cent', () => {
    const full = taxBreakdown([
      { net: 333.33, rate: 20, taxCodeId: 'STD', code: 'STD' },
      { net: 66.67, rate: 5, taxCodeId: 'RED', code: 'RED' },
    ]);
    const deposit = scaleBreakdown(full, { net: 120, tax: 21 });
    expect(deposit.reduce((s, r) => s + r.net, 0)).toBeCloseTo(120, 10);
    expect(deposit.reduce((s, r) => s + r.tax, 0)).toBeCloseTo(21, 10);
  });
});
