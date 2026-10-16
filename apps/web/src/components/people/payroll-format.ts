import type { PayrollRunStatus } from '@saas/shared';

export const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const STATUS_LABELS: Record<PayrollRunStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  VOIDED: 'Voided',
};

export const STATUS_TONES: Record<PayrollRunStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  APPROVED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  VOIDED: 'danger',
};

/** "2026-10" → "October 2026". */
export function periodLabel(period: string): string {
  const d = new Date(`${period}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return period;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** The month after the latest run (or opening cut-over), else next calendar month. */
export function defaultNextPeriod(
  runs: { period: string; status: PayrollRunStatus }[],
  cutover: string | null,
  now = new Date(),
): string {
  let latest: string | null = null;
  for (const r of runs) if (r.status !== 'VOIDED' && (!latest || r.period > latest)) latest = r.period;
  if (cutover && (!latest || cutover.slice(0, 7) > latest)) latest = cutover.slice(0, 7);
  if (latest) return nextPeriod(latest);
  return nextPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
}
