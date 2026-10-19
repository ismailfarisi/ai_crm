import { describe, expect, it } from 'vitest';
import { branchSchema, vatSettingsSchema } from './vat';
import { taxCodeSchema } from './credits';

const settings = {
  periodFrequency: 'QUARTERLY' as const,
  firstPeriodStart: '2026-02-01',
  registrationDate: '2026-01-15',
  vatStartDate: '2026-11-01',
  taxAgentName: null,
  taxAgencyName: null,
  tan: null,
  taan: null,
};

describe('vatSettingsSchema', () => {
  it('accepts a VAT start on a period boundary', () => {
    expect(vatSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('rejects a VAT start that is not a period start', () => {
    const result = vatSettingsSchema.safeParse({ ...settings, vatStartDate: '2026-12-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'The VAT start date must be the first day of a tax period',
      );
    }
  });

  it('rejects a VAT start before the first period', () => {
    expect(vatSettingsSchema.safeParse({ ...settings, vatStartDate: '2025-11-01' }).success).toBe(
      false,
    );
  });

  it('rejects a first period that is not the 1st of a month', () => {
    expect(vatSettingsSchema.safeParse({ ...settings, firstPeriodStart: '2026-02-02' }).success).toBe(
      false,
    );
  });
});

describe('vatSettingsSchema dates', () => {
  it.each([
    ['vatStartDate', '2026-02-30'],
    ['registrationDate', '2026-13-01'],
    ['firstPeriodStart', '2026-13-01'],
  ])('rejects %s %s, a date that does not exist', (field, value) => {
    const result = vatSettingsSchema.safeParse({ ...settings, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === field && i.message === 'That date does not exist')).toBe(true);
    }
  });
});

describe('branchSchema', () => {
  it('upper-cases the invoice prefix', () => {
    expect(branchSchema.parse({ name: 'Dubai', invoicePrefix: 'dxb' }).invoicePrefix).toBe('DXB');
  });

  it('rejects a one-letter prefix', () => {
    expect(branchSchema.safeParse({ name: 'Dubai', invoicePrefix: 'D' }).success).toBe(false);
  });

  it('applies defaults', () => {
    const b = branchSchema.parse({ name: 'Dubai' });
    expect(b.isHeadOffice).toBe(false);
    expect(b.isActive).toBe(true);
    expect(b.invoicePrefix).toBeNull();
    expect(b.emirate).toBeNull();
  });
});

describe('taxCodeSchema treatment', () => {
  const base = { code: 'X', name: 'X', rate: 0, kind: 'SALES' as const };

  it('rejects a purchase-only treatment on a sales code', () => {
    expect(taxCodeSchema.safeParse({ ...base, treatment: 'IMPORT_GOODS' }).success).toBe(false);
  });

  it('accepts an allowed treatment and defaults to null', () => {
    expect(taxCodeSchema.parse({ ...base, treatment: 'ZERO_RATED' }).treatment).toBe('ZERO_RATED');
    expect(taxCodeSchema.parse(base).treatment).toBeNull();
  });
});
