import { describe, expect, it } from 'vitest';
import type { VatSettingsDto } from '@saas/shared';
import { currentTaxRange, formatTaxRange } from './vat-period';
import { vatBoxes } from './vat-boxes';

const settings = (over: Partial<VatSettingsDto>): VatSettingsDto => ({
  id: 's',
  periodFrequency: 'QUARTERLY',
  firstPeriodStart: '2026-02-01',
  registrationDate: '2026-01-15',
  vatStartDate: '2026-02-01',
  taxAgentName: null,
  taxAgencyName: null,
  tan: null,
  taan: null,
  ...over,
});

describe('currentTaxRange', () => {
  const now = new Date('2026-10-30T08:00:00Z');

  it('follows the FTA periods counted from the first one', () => {
    expect(currentTaxRange(settings({}), now)).toEqual({ from: '2026-08-01', to: '2026-11-01' });
    expect(currentTaxRange(settings({ periodFrequency: 'MONTHLY' }), now)).toEqual({ from: '2026-10-01', to: '2026-11-01' });
  });

  it('falls back on the calendar quarter without VAT settings', () => {
    expect(currentTaxRange(null, now)).toEqual({ from: '2026-10-01', to: '2027-01-01' });
  });
});

describe('formatTaxRange', () => {
  it('reads the end as the day before `to`', () => {
    expect(formatTaxRange({ from: '2026-08-01', to: '2026-11-01' })).toBe('1 Aug – 31 Oct 2026');
    expect(formatTaxRange({ from: '2026-12-01', to: '2027-03-01' })).toBe('1 Dec 2026 – 28 Feb 2027');
  });
});

describe('vatBoxes', () => {
  it('places codes where the VAT201 does', () => {
    expect(vatBoxes('SALES', 'ZERO_RATED', 0)).toBe('box 4');
    expect(vatBoxes('SALES', 'EXEMPT', 0)).toBe('box 5');
    expect(vatBoxes('SALES', null, 5)).toBe('box 1');
    expect(vatBoxes('SALES', null, 0)).toBeNull();
    expect(vatBoxes('PURCHASE', 'REVERSE_CHARGE', 5)).toBe('boxes 3 and 10');
    expect(vatBoxes('PURCHASE', 'BLOCKED', 5)).toBeNull();
  });
});
