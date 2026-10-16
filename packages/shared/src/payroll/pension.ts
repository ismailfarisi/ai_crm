import { round2 } from './calc';

export type PensionBase = 'BASIC' | 'BASIC_HOUSING' | 'GROSS';
export const PENSION_BASES: readonly PensionBase[] = ['BASIC', 'BASIC_HOUSING', 'GROSS'];

export interface PensionRates {
  employeePct: number;
  employerPct: number;
  base: PensionBase;
  minSalary: number | null;
  maxSalary: number | null;
}

/**
 * A national's monthly contribution. The base follows the contract salary
 * (unpaid leave does not reduce it), clamped to the fund's bounds and
 * prorated by days employed.
 */
export function pensionContribution(a: {
  rates: PensionRates;
  basic: number;
  housing: number;
  gross: number;
  daysEmployed: number;
  daysInMonth: number;
}): { base: number; employee: number; employer: number } {
  const contract = a.rates.base === 'BASIC' ? a.basic : a.rates.base === 'BASIC_HOUSING' ? a.basic + a.housing : a.gross;
  const clamped = Math.min(Math.max(contract, a.rates.minSalary ?? 0), a.rates.maxSalary ?? Infinity);
  const base = round2((clamped * a.daysEmployed) / a.daysInMonth);
  return {
    base,
    employee: round2((base * a.rates.employeePct) / 100),
    employer: round2((base * a.rates.employerPct) / 100),
  };
}

/**
 * Starting points a tenant confirms before use: rates change, and the API
 * creates these inactive.
 */
export const PENSION_SCHEME_PRESETS: { key: string; name: string; rates: PensionRates }[] = [
  { key: 'GPSSA_2023', name: 'GPSSA (joined from 31 Oct 2023)', rates: { employeePct: 11, employerPct: 15, base: 'GROSS', minSalary: 3000, maxSalary: 70000 } },
  { key: 'GPSSA_LEGACY', name: 'GPSSA (legacy, joined earlier)', rates: { employeePct: 5, employerPct: 12.5, base: 'GROSS', minSalary: 3000, maxSalary: 70000 } },
  { key: 'ADPF_NEW', name: 'ADPF (new member, from 1 Dec 2023)', rates: { employeePct: 11, employerPct: 15, base: 'GROSS', minSalary: null, maxSalary: 100000 } },
  { key: 'ADPF_IN_SERVICE', name: 'ADPF (in-service member)', rates: { employeePct: 5, employerPct: 15, base: 'GROSS', minSalary: null, maxSalary: null } },
];
