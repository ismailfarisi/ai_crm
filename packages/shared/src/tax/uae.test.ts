import { describe, expect, it } from 'vitest';
import {
  EMIRATES,
  UAE_STARTER_CODES,
  UAE_STARTER_RULES,
  defaultVatStatus,
  emirateFromText,
  expectedUaeRate,
  isPeriodStart,
  isUaeVatMode,
  isValidTrn,
  nextPeriodStart,
  normaliseTrn,
  periodContaining,
  resolveVatStatus,
  isUaeCountry,
  treatmentAllowed,
  treatmentIsReverseCharge,
} from './uae';

describe('TRN', () => {
  it('strips spaces and dashes', () => {
    expect(normaliseTrn('100-1234-5678-9012')).toBe('100123456789012');
    expect(normaliseTrn(' 100 123 456 789 012 ')).toBe('100123456789012');
    expect(normaliseTrn('  ')).toBeNull();
    expect(normaliseTrn(null)).toBeNull();
  });

  it('requires exactly 15 digits', () => {
    expect(isValidTrn('10012345678901')).toBe(false);
    expect(isValidTrn('1001234567890123')).toBe(false);
    expect(isValidTrn('10012345678901A')).toBe(false);
    expect(isValidTrn('200123456789012')).toBe(true);
    expect(isValidTrn('100-1234-5678-9012')).toBe(true);
    expect(isValidTrn(undefined)).toBe(false);
  });
});

describe('VAT status and mode', () => {
  it('defaults from country and TRN', () => {
    expect(defaultVatStatus('AE', '100123456789012')).toBe('REGISTERED');
    expect(defaultVatStatus('AE', null)).toBe('NOT_REGISTERED');
    expect(defaultVatStatus('AE', 'TRN pending')).toBe('NOT_REGISTERED');
    expect(defaultVatStatus('GB', 'GB123')).toBe('OUTSIDE_UAE');
    expect(defaultVatStatus(null, null)).toBe('NOT_REGISTERED');
  });

  it('needs AE, a valid TRN and AED', () => {
    expect(isUaeVatMode({ country: 'AE', taxId: '100123456789012', baseCurrency: 'AED' })).toBe(true);
    expect(isUaeVatMode({ country: 'AE', taxId: '100123456789012', baseCurrency: 'USD' })).toBe(false);
    expect(isUaeVatMode({ country: 'AE', taxId: null, baseCurrency: 'AED' })).toBe(false);
    expect(isUaeVatMode({ country: 'GB', taxId: '100123456789012', baseCurrency: 'AED' })).toBe(false);
  });
});

describe('legacy country values', () => {
  it('trims and recognises UAE free text', () => {
    for (const c of [' ae ', 'United Arab Emirates', 'UAE', 'u.a.e.']) {
      expect(isUaeCountry(c)).toBe(true);
      expect(defaultVatStatus(c, '100123456789012')).toBe('REGISTERED');
    }
    expect(isUaeCountry('GB')).toBe(false);
    expect(defaultVatStatus(' GB ', null)).toBe('OUTSIDE_UAE');
  });

  it('treats a blank country as none', () => {
    expect(defaultVatStatus('   ', '100123456789012')).toBe('NOT_REGISTERED');
    expect(defaultVatStatus('', null)).toBe('NOT_REGISTERED');
  });
});

describe('resolveVatStatus', () => {
  const registered = { country: 'AE', taxId: '100123456789012', vatStatus: 'REGISTERED' as const };

  it('derives on create', () => {
    expect(resolveVatStatus(null, { country: 'AE', taxId: '100123456789012' })).toBe('REGISTERED');
    expect(resolveVatStatus(null, {})).toBe('NOT_REGISTERED');
  });

  it('keeps the current status when country and TRN are untouched', () => {
    expect(resolveVatStatus(registered, {})).toBe('REGISTERED');
    expect(resolveVatStatus(registered, { vatStatus: null })).toBe('REGISTERED');
  });

  it('keeps an explicit override, even without a TRN', () => {
    expect(resolveVatStatus(null, { country: 'AE', vatStatus: 'REGISTERED' })).toBe('REGISTERED');
  });

  it('re-derives when the country or TRN changes', () => {
    expect(resolveVatStatus(registered, { country: 'GB' })).toBe('OUTSIDE_UAE');
    expect(resolveVatStatus(registered, { taxId: null })).toBe('NOT_REGISTERED');
  });
});

describe('emirates', () => {
  it('matches codes and names', () => {
    expect(emirateFromText('Dubai')).toBe('DXB');
    expect(emirateFromText('abu dhabi')).toBe('AUH');
    expect(emirateFromText('AbuDhabi')).toBe('AUH');
    expect(emirateFromText('RAK')).toBe('RAK');
    expect(emirateFromText('uaq')).toBe('UAQ');
    expect(emirateFromText('Ras Al Khaimah')).toBe('RAK');
    expect(emirateFromText('Business Bay')).toBeNull();
    expect(emirateFromText(null)).toBeNull();
    expect(EMIRATES).toHaveLength(7);
  });
});

describe('treatments', () => {
  it('restricts treatments by kind', () => {
    expect(treatmentAllowed('SALES', 'IMPORT_GOODS')).toBe(false);
    expect(treatmentAllowed('SALES', 'BLOCKED')).toBe(false);
    expect(treatmentAllowed('SALES', 'REVERSE_CHARGE')).toBe(true);
    expect(treatmentAllowed('PURCHASE', 'IMPORT_GOODS')).toBe(true);
    expect(treatmentAllowed('PURCHASE', 'BLOCKED')).toBe(true);
  });

  it('flags reverse-charge treatments', () => {
    expect(treatmentIsReverseCharge('REVERSE_CHARGE')).toBe(true);
    expect(treatmentIsReverseCharge('IMPORT_GOODS')).toBe(true);
    expect(treatmentIsReverseCharge('STANDARD')).toBe(false);
    expect(treatmentIsReverseCharge(null)).toBe(false);
  });

  it('gives the expected rate', () => {
    expect(expectedUaeRate('PURCHASE', 'REVERSE_CHARGE')).toBe(5);
    expect(expectedUaeRate('SALES', 'REVERSE_CHARGE')).toBe(0);
    expect(expectedUaeRate('PURCHASE', 'IMPORT_GOODS')).toBe(5);
    expect(expectedUaeRate('PURCHASE', 'BLOCKED')).toBe(5);
    expect(expectedUaeRate('SALES', 'STANDARD')).toBe(5);
    expect(expectedUaeRate('SALES', 'EXEMPT')).toBe(0);
  });
});

describe('starter codes', () => {
  it('seeds the spec codes', () => {
    expect(UAE_STARTER_CODES.filter((c) => c.kind === 'PURCHASE').map((c) => c.code)).toEqual(['SR', 'ZR', 'EX', 'BL', 'RC', 'IM']);
    expect(UAE_STARTER_CODES.filter((c) => c.kind === 'SALES').map((c) => c.code)).toEqual(['SR', 'ZR', 'EX', 'OS']);
  });

  it('keeps every code consistent with its treatment', () => {
    for (const c of UAE_STARTER_CODES) {
      expect(treatmentAllowed(c.kind, c.treatment)).toBe(true);
      expect(c.rate).toBe(expectedUaeRate(c.kind, c.treatment));
    }
  });

  it('has rules that point at existing codes', () => {
    expect(UAE_STARTER_RULES).toEqual([
      { kind: 'SALES', country: 'AE', code: 'SR' },
      { kind: 'SALES', country: '*', code: 'ZR' },
      { kind: 'PURCHASE', country: 'AE', code: 'SR' },
      { kind: 'PURCHASE', country: '*', code: 'RC' },
    ]);
    for (const r of UAE_STARTER_RULES) {
      expect(UAE_STARTER_CODES.some((c) => c.kind === r.kind && c.code === r.code)).toBe(true);
    }
  });
});

describe('periods', () => {
  it('tiles quarters forwards and backwards from the anchor', () => {
    expect(periodContaining('2026-02-01', 'QUARTERLY', '2026-10-19')).toEqual({ start: '2026-08-01', end: '2026-10-31' });
    expect(periodContaining('2026-02-01', 'QUARTERLY', '2026-01-15')).toEqual({ start: '2025-11-01', end: '2026-01-31' });
    expect(periodContaining('2026-02-01', 'QUARTERLY', '2026-02-01')).toEqual({ start: '2026-02-01', end: '2026-04-30' });
    expect(periodContaining('2026-02-01', 'QUARTERLY', '2026-04-30')).toEqual({ start: '2026-02-01', end: '2026-04-30' });
  });

  it('handles months and leap years', () => {
    expect(periodContaining('2026-01-01', 'MONTHLY', '2028-02-29')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(periodContaining('2026-01-01', 'MONTHLY', '2027-02-10')).toEqual({ start: '2027-02-01', end: '2027-02-28' });
  });

  it('crosses year boundaries', () => {
    expect(periodContaining('2026-01-01', 'QUARTERLY', '2026-12-31')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(periodContaining('2026-11-01', 'QUARTERLY', '2027-01-05')).toEqual({ start: '2026-11-01', end: '2027-01-31' });
  });

  it('detects period starts', () => {
    expect(isPeriodStart('2026-02-01', 'QUARTERLY', '2026-05-01')).toBe(true);
    expect(isPeriodStart('2026-02-01', 'QUARTERLY', '2026-06-01')).toBe(false);
    expect(isPeriodStart('2026-02-01', 'QUARTERLY', '2026-05-02')).toBe(false);
    expect(isPeriodStart('2026-02-01', 'QUARTERLY', '2025-11-01')).toBe(true);
  });

  it('returns the following period start, even from a period start', () => {
    expect(nextPeriodStart('2026-02-01', 'QUARTERLY', '2026-10-19')).toBe('2026-11-01');
    expect(nextPeriodStart('2026-02-01', 'QUARTERLY', '2026-11-01')).toBe('2027-02-01');
    expect(nextPeriodStart('2026-01-01', 'MONTHLY', '2026-12-15')).toBe('2027-01-01');
  });

  it('refuses an anchor that is not the 1st', () => {
    const msg = 'A VAT period must start on the 1st of a month';
    expect(() => periodContaining('2026-02-15', 'MONTHLY', '2026-03-01')).toThrow(msg);
    expect(() => isPeriodStart('2026-02-15', 'MONTHLY', '2026-03-01')).toThrow(msg);
    expect(() => nextPeriodStart('2026-02-15', 'MONTHLY', '2026-03-01')).toThrow(msg);
  });
});
