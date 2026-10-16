import { daysBetweenInclusive, periodBounds, round2 } from './calc';

/**
 * Leave arithmetic (UAE Labour Law, calendar days). Pure: the API feeds it
 * records and dates, and stores what it returns.
 */
export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'OTHER_PAID'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export interface LeaveRecordInput {
  type: LeaveType;
  startDate: string;
  endDate: string;
  /** Calendar days, or fewer when HR edited it down (half days). */
  days: number;
}

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);

/** Days of service to `asOf`, inclusive, less unpaid days. */
export function leaveServiceDays(a: { joiningDate: string; asOf: string; unpaidDays: number }): number {
  return Math.max(0, daysBetweenInclusive(a.joiningDate, a.asOf) - a.unpaidDays);
}

/**
 * Annual leave earned to date: nothing in the first six months, two days per
 * completed month until the first anniversary, then the annual entitlement
 * pro rata.
 */
export function leaveAccrued(a: { serviceDays: number; annualDays: number }): number {
  const months = (a.serviceDays * 12) / 365;
  if (months < 6) return 0;
  if (months < 12) return 2 * Math.floor(months);
  return round2((a.annualDays * a.serviceDays) / 365);
}

interface Unit {
  date: string;
  weight: number;
}

/** One unit per calendar day, each weighing days ÷ calendar days. */
function unitsOf(r: LeaveRecordInput): Unit[] {
  const calendar = daysBetweenInclusive(r.startDate, r.endDate);
  if (calendar <= 0) return [];
  const weight = r.days / calendar;
  return Array.from({ length: calendar }, (_, i) => ({ date: addDays(r.startDate, i), weight }));
}

/** Completed years of service at `date` (0 in the first year). */
function serviceYear(joiningDate: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(joiningDate.slice(0, 4));
  return date.slice(5, 10) >= joiningDate.slice(5, 10) ? years : years - 1;
}

/** Splits `weight` days, `used` already taken, into full / half / unpaid bands. */
function split(used: number, weight: number, fullCap: number, halfCap: number) {
  const full = Math.max(0, Math.min(weight, fullCap - used));
  const half = Math.max(0, Math.min(weight - full, fullCap + halfCap - Math.max(used, fullCap)));
  return { full, half, unpaid: weight - full - half };
}

export interface PeriodLeave {
  annualDays: number;
  /** Sick days at full pay. */
  sickFullDays: number;
  /** Sick and maternity days at half pay. */
  halfPayDays: number;
  /** UNPAID records, sick beyond 45 days or in probation, maternity beyond 60. */
  unpaidDays: number;
  /** OTHER_PAID records and maternity at full pay. */
  otherPaidDays: number;
  /** Every leave day in the period, for the WPS file. */
  leaveDays: number;
}

/**
 * What an employee's leave records mean for one month's pay. Sick days are
 * banded across the whole service year (records before the month count
 * towards the 15 / 30 / 45), maternity within its own record.
 */
export function leaveForPeriod(a: {
  records: LeaveRecordInput[];
  joiningDate: string;
  probationEndDate: string | null;
  leavingDate: string | null;
  period: string;
}): PeriodLeave {
  const { first, last } = periodBounds(a.period);
  const from = a.joiningDate > first ? a.joiningDate : first;
  const to = a.leavingDate && a.leavingDate < last ? a.leavingDate : last;
  const inRange = (d: string) => d >= from && d <= to;
  const out: PeriodLeave = { annualDays: 0, sickFullDays: 0, halfPayDays: 0, unpaidDays: 0, otherPaidDays: 0, leaveDays: 0 };

  for (const r of a.records) {
    if (r.type === 'SICK' || r.type === 'MATERNITY') continue;
    for (const u of unitsOf(r)) {
      if (!inRange(u.date)) continue;
      out.leaveDays += u.weight;
      if (r.type === 'ANNUAL') out.annualDays += u.weight;
      else if (r.type === 'UNPAID') out.unpaidDays += u.weight;
      else out.otherPaidDays += u.weight;
    }
  }

  const sick = a.records
    .filter((r) => r.type === 'SICK')
    .flatMap(unitsOf)
    .sort((x, y) => x.date.localeCompare(y.date));
  const used = new Map<number, number>();
  for (const u of sick) {
    let band = { full: 0, half: 0, unpaid: u.weight };
    if (!(a.probationEndDate && u.date <= a.probationEndDate)) {
      const year = serviceYear(a.joiningDate, u.date);
      const before = used.get(year) ?? 0;
      band = split(before, u.weight, 15, 30);
      used.set(year, before + u.weight);
    }
    if (!inRange(u.date)) continue;
    out.leaveDays += u.weight;
    out.sickFullDays += band.full;
    out.halfPayDays += band.half;
    out.unpaidDays += band.unpaid;
  }

  for (const r of a.records.filter((x) => x.type === 'MATERNITY')) {
    let before = 0;
    for (const u of unitsOf(r)) {
      const band = split(before, u.weight, 45, 15);
      before += u.weight;
      if (!inRange(u.date)) continue;
      out.leaveDays += u.weight;
      out.otherPaidDays += band.full;
      out.halfPayDays += band.half;
      out.unpaidDays += band.unpaid;
    }
  }

  return {
    annualDays: round2(out.annualDays),
    sickFullDays: round2(out.sickFullDays),
    halfPayDays: round2(out.halfPayDays),
    unpaidDays: round2(out.unpaidDays),
    otherPaidDays: round2(out.otherPaidDays),
    leaveDays: round2(out.leaveDays),
  };
}

/** Post-probation sick days per service year (0 = the first year), for the 90-day limit. */
export function sickDaysByServiceYear(a: {
  records: LeaveRecordInput[];
  joiningDate: string;
  probationEndDate: string | null;
}): Map<number, number> {
  const m = new Map<number, number>();
  for (const u of a.records.filter((r) => r.type === 'SICK').flatMap(unitsOf)) {
    if (a.probationEndDate && u.date <= a.probationEndDate) continue;
    const y = serviceYear(a.joiningDate, u.date);
    m.set(y, round2((m.get(y) ?? 0) + u.weight));
  }
  return m;
}

/** Every 'YYYY-MM' a date range touches. */
export function recordPeriods(r: { startDate: string; endDate: string }): string[] {
  const out: string[] = [];
  let cursor = `${r.startDate.slice(0, 7)}-01`;
  while (cursor.slice(0, 7) <= r.endDate.slice(0, 7)) {
    out.push(cursor.slice(0, 7));
    const [y, m] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  return out;
}
