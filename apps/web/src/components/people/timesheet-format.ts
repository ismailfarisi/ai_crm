import type { TimesheetIndirectCategory } from '@saas/shared';

const DAY = 86_400_000;

export const LOCKED_TIP = 'Payroll for this month is posted';
export const SEVERAL_TIP = 'Several entries — edit in Crew day';

export const CATEGORY_LABELS: Record<TimesheetIndirectCategory, string> = {
  CLEANING: 'Cleaning',
  MAINTENANCE: 'Maintenance',
  TRAINING: 'Training',
  IDLE: 'Idle',
  OTHER: 'Other',
};

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
}

/** The Monday on or before `iso` (weeks run Mon–Sun). */
export function mondayOf(iso: string): string {
  const dow = new Date(Date.parse(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function formatDay(iso: string): string {
  return new Date(Date.parse(iso)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatHours(h: number): string {
  return String(Math.round(h * 100) / 100);
}

export type HoursCell = { kind: 'empty' } | { kind: 'ok'; hours: number } | { kind: 'invalid'; reason: string };

/** A cleared cell is a delete, never a save of 0: the API refuses hours that are not above zero. */
export function parseHoursCell(raw: string): HoursCell {
  const text = raw.trim();
  if (text === '') return { kind: 'empty' };
  const n = Number(text);
  if (!Number.isFinite(n)) return { kind: 'invalid', reason: 'Enter hours as a number' };
  if (n <= 0) return { kind: 'invalid', reason: 'Hours must be more than 0 — clear the cell to remove the entry' };
  if (n > 24) return { kind: 'invalid', reason: 'A day has 24 hours' };
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { kind: 'invalid', reason: 'Use at most two decimals' };
  return { kind: 'ok', hours: n };
}
