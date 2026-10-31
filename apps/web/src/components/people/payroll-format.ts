import type { PayrollRunStatus, SettlementReason, SettlementStatus } from '@saas/shared';
import { useOrganization } from '@/hooks/use-organization';

/** 1234.5 → "1,234.50"; with a currency, "AED 1,234.50". */
export const money = (n: number, currency?: string | null) => {
  const figure = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${figure}` : figure;
};

/**
 * The currency payroll is run in: the organisation's base currency. Undefined
 * until the organisation loads, so a figure shows bare rather than in a guess.
 */
export function usePayrollCurrency(): string | undefined {
  return useOrganization().data?.baseCurrency;
}

/** "Net" → "Net (AED)", for table headers so each cell stays a bare figure. */
export const inCurrency = (label: string, currency: string | undefined) =>
  currency ? `${label} (${currency})` : label;

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

export const SETTLEMENT_REASON_LABELS: Record<SettlementReason, string> = {
  RESIGNATION: 'Resignation',
  TERMINATION: 'Termination',
  END_OF_CONTRACT: 'End of contract',
  DEATH: 'Death',
  OTHER: 'Other',
};

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  PAID: 'Paid',
  VOIDED: 'Voided',
};

export const SETTLEMENT_STATUS_TONES: Record<SettlementStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  APPROVED: 'info',
  PAID: 'success',
  VOIDED: 'danger',
};

/** 800 days → "2 years 70 days". */
export function serviceLabel(days: number): string {
  const years = Math.floor(days / 365);
  const rest = days - years * 365;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return `${plural(years, 'year')} ${plural(rest, 'day')}`;
}
