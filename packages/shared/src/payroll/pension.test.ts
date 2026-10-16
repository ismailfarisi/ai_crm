import { describe, expect, it } from 'vitest';
import { PENSION_SCHEME_PRESETS, pensionContribution, type PensionRates } from './pension';

const gpssa: PensionRates = { employeePct: 11, employerPct: 15, base: 'GROSS', minSalary: 3000, maxSalary: 70000 };
const full = { basic: 7000, housing: 2100, gross: 9800, daysEmployed: 31, daysInMonth: 31 };

describe('pensionContribution', () => {
  it('a full month on gross', () => expect(pensionContribution({ rates: gpssa, ...full })).toEqual({ base: 9800, employee: 1078, employer: 1470 }));
  it('clamps up to the minimum', () => expect(pensionContribution({ rates: gpssa, ...full, gross: 2500 })).toEqual({ base: 3000, employee: 330, employer: 450 }));
  it('clamps down to the maximum', () => expect(pensionContribution({ rates: gpssa, ...full, gross: 80000 }).base).toBe(70000));
  it('prorates by days employed', () => expect(pensionContribution({ rates: gpssa, ...full, daysEmployed: 15, daysInMonth: 30 }).base).toBe(4900));
  it('basic + housing base', () => expect(pensionContribution({ rates: { ...gpssa, base: 'BASIC_HOUSING' }, ...full }).base).toBe(9100));
  it('basic base with no caps', () => expect(pensionContribution({ rates: { ...gpssa, base: 'BASIC', minSalary: null, maxSalary: null }, ...full }).base).toBe(7000));
});

describe('presets', () => {
  it('ships the four schemes', () => {
    expect(PENSION_SCHEME_PRESETS.map((p) => p.key)).toEqual(['GPSSA_2023', 'GPSSA_LEGACY', 'ADPF_NEW', 'ADPF_IN_SERVICE']);
    expect(PENSION_SCHEME_PRESETS[0].rates).toEqual(gpssa);
  });
});
