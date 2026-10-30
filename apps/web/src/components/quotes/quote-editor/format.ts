/**
 * One way of writing a date across the quote editor: "30 Oct 2026". Day
 * first, as the UAE writes it, with the month as a word so 01/11 and 11/01
 * can never be mistaken for each other.
 */
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T00:00:00` : value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : DATE.format(date);
}

/** A date thirty days on from today, as the YYYY-MM-DD a date input holds. */
export function thirtyDaysFromToday(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
