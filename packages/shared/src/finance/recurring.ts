/**
 * Schedule maths for recurring expenses. Dates are ISO calendar dates
 * (`YYYY-MM-DD`) in UTC; organizations have no timezone of their own.
 *
 * Every occurrence is computed from the anchor, never from the previous
 * occurrence, so a schedule on the 31st bills 28 Feb and then 31 Mar again.
 */
export type RecurringInterval = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

export const RECURRING_INTERVALS: RecurringInterval[] = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

const MONTHS: Record<RecurringInterval, number> = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 };

export function monthsPerInterval(interval: RecurringInterval): number {
  return MONTHS[interval];
}

export function monthlyEquivalent(amount: number, interval: RecurringInterval): number {
  return Math.round((amount / MONTHS[interval]) * 100) / 100;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function utcToday(now: Date = new Date()): string {
  return isoDate(now);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}

export function addMonthsClamped(anchor: string, months: number): string {
  const [y, m, d] = parts(anchor);
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return isoDate(target);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return isoDate(new Date(Date.UTC(y, m, d + days)));
}

export function occurrenceDate(startDate: string, n: number, interval: RecurringInterval): string {
  return addMonthsClamped(startDate, n * MONTHS[interval]);
}

export function periodFor(startDate: string, n: number, interval: RecurringInterval): { start: string; end: string } {
  return {
    start: occurrenceDate(startDate, n, interval),
    end: addDays(occurrenceDate(startDate, n + 1, interval), -1),
  };
}

export function dueOccurrences(args: {
  startDate: string;
  endDate: string | null;
  interval: RecurringInterval;
  fromIndex: number;
  today: string;
}): number[] {
  const out: number[] = [];
  // 1200 periods = 100 years monthly; a hard stop against a bad anchor.
  for (let n = args.fromIndex; n < args.fromIndex + 1200; n++) {
    const date = occurrenceDate(args.startDate, n, args.interval);
    if (date > args.today) break;
    if (args.endDate && date >= args.endDate) break;
    out.push(n);
  }
  return out;
}

export function occurrenceIndexOnOrAfter(startDate: string, interval: RecurringInterval, date: string): number {
  let n = 0;
  while (occurrenceDate(startDate, n, interval) < date) n++;
  return n;
}
