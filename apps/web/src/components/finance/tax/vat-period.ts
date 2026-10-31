import { nextPeriodStart, periodContaining, todayInDubai, type VatSettingsDto } from '@saas/shared';

/** A tax period as the tax report and the VAT return take it: `to` is the first day after it. */
export interface TaxRange {
  from: string;
  to: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The VAT period today falls in. With VAT settings that is the FTA period
 * counted from the first one; without them, the calendar quarter. The Tax page
 * opens on it and the Finance overview reports it, so the two always agree.
 */
export function currentTaxRange(settings?: VatSettingsDto | null, now: Date = new Date()): TaxRange {
  if (settings?.firstPeriodStart && settings.periodFrequency) {
    try {
      const today = todayInDubai(now);
      return {
        from: periodContaining(settings.firstPeriodStart, settings.periodFrequency, today).start,
        to: nextPeriodStart(settings.firstPeriodStart, settings.periodFrequency, today),
      };
    } catch {
      // A malformed first period falls back to the quarter.
    }
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  return { from: iso(start), to: iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1))) };
}

/** "1 Jul – 30 Sep 2026" for a range whose `to` is the day after it ends. */
export function formatTaxRange({ from, to }: TaxRange): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} – ${to}`;
  end.setUTCDate(end.getUTCDate() - 1);
  const day = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return `${day(start, start.getUTCFullYear() !== end.getUTCFullYear())} – ${day(end, true)}`;
}
