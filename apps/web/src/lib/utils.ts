import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional classes, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * An amount in an ISO currency, e.g. "AED 1,250.00".
 *
 * Pass the document's own currency, or the company's base currency
 * (`organization.baseCurrency`) for totals that are not on one document. With
 * no currency yet (the company has not loaded) it prints the bare number
 * rather than guess a symbol.
 */
export function formatMoney(
  amount: number,
  currency: string | null | undefined,
  { decimals = 2 }: { decimals?: number } = {},
): string {
  const digits = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  if (!currency) return amount.toLocaleString('en-US', digits);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, ...digits }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US', digits)}`;
  }
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'Never';

  const then = new Date(value).getTime();
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  const thresholds: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  let value_ = diffSeconds;
  for (const [unit, size] of thresholds) {
    if (Math.abs(value_) < size) {
      return formatter.format(Math.round(value_), unit);
    }
    value_ /= size;
  }
  return formatter.format(Math.round(value_), 'year');
}

export function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}
