import { round2 } from './calc';

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** The hours a month's pay covers: prorated standard plus the overtime that was paid. */
export function standardHours(a: {
  daysEmployed: number;
  daysInMonth: number;
  monthlyStandardHours: number;
  overtimeHours: number;
  overtimeHoursPremium: number;
}): number {
  return round2((a.daysEmployed / a.daysInMonth) * a.monthlyStandardHours + a.overtimeHours + a.overtimeHoursPremium);
}

/** What an employee cost the business this month, from the approved line. */
export function labourCost(a: {
  salaryCost: number;
  pensionEmployer: number;
  gratuityAccrual: number;
  leaveProvisionChange: number;
}): number {
  return round2(a.salaryCost + a.pensionEmployer + a.gratuityAccrual + a.leaveProvisionChange);
}

/**
 * Cost per hour. Dividing by the larger of standard and logged hours means
 * hours × rate can never exceed the cost, however many hours were logged.
 */
export function labourRate(a: { cost: number; standardHours: number; loggedHours: number }): number {
  const hours = Math.max(a.standardHours, a.loggedHours);
  if (!(a.cost > 0) || !(hours > 0)) return 0;
  return round4(a.cost / hours);
}

/**
 * Used before the month's payroll posts: the package plus statutory on-costs
 * (gratuity at the first-five-years 21 days, annual leave), over standard hours.
 */
export function estimatedLabourRate(a: {
  gross: number;
  basic: number;
  pensionEmployer: number;
  isNational: boolean;
  annualLeaveDays: number;
  monthlyStandardHours: number;
}): number {
  if (!(a.monthlyStandardHours > 0)) return 0;
  const gratuity = a.isNational ? 0 : (a.basic * 21) / 30 / 12;
  const leave = (a.basic * a.annualLeaveDays) / 30 / 12;
  return round4((a.gross + a.pensionEmployer + gratuity + leave) / a.monthlyStandardHours);
}

/** Splits one employee's absorbed labour across their entries so the parts sum exactly. */
export function allocateAbsorption<T extends { id: string; hours: number }>(
  entries: T[],
  rate: number,
  cap: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!entries.length) return out;
  const hours = entries.reduce((s, e) => s + e.hours, 0);
  const total = round2(Math.min(round2(hours * rate), cap));
  let largest = entries[0];
  let sum = 0;
  for (const e of entries) {
    const amount = round2(e.hours * rate);
    out.set(e.id, amount);
    sum = round2(sum + amount);
    if (e.hours > largest.hours) largest = e;
  }
  out.set(largest.id, round2(out.get(largest.id)! + round2(total - sum)));
  return out;
}

/** Operation minutes nobody's timesheet accounts for. */
export function unlinkedHours(actualMinutes: number, entryHours: number): number {
  return Math.max(0, round2(actualMinutes / 60 - entryHours));
}

export type LabourStatus = 'ACTUAL' | 'PROVISIONAL' | 'MIXED' | 'STANDARD';
export const LABOUR_STATUSES: readonly LabourStatus[] = ['ACTUAL', 'PROVISIONAL', 'MIXED', 'STANDARD'];

/**
 * ACTUAL: every hour costed from a posted run. PROVISIONAL: some hours wait on
 * a month's payroll. MIXED: actual plus clock minutes from users not linked to
 * an employee. STANDARD: only unlinked minutes (jobs from before timesheets).
 */
export function labourStatus(s: { actual: number; provisional: number; unlinked: number }): LabourStatus | null {
  if (s.provisional > 0) return 'PROVISIONAL';
  if (s.unlinked > 0) return s.actual > 0 ? 'MIXED' : 'STANDARD';
  if (s.actual > 0) return 'ACTUAL';
  return null;
}
