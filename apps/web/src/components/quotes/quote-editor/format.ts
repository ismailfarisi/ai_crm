import { formatDisplayDate } from '@saas/shared';

/**
 * One way of writing a date across the quote editor: "30 Oct 2026". Day
 * first, as the UAE writes it, with the month as a word so 01/11 and 11/01
 * can never be mistaken for each other.
 */
export function formatDate(value: string | Date): string {
  return formatDisplayDate(value, {}, String(value));
}

/** A date thirty days on from today, as the YYYY-MM-DD a date input holds. */
export function thirtyDaysFromToday(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
