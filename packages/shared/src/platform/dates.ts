/**
 * One way of writing a date across Kerf, on screen and on documents:
 * "24 Nov 2026". Day first, as the UAE writes it, with the month as a word
 * so 01/11 and 11/01 can never be mistaken for each other.
 */

import { DOCUMENT_TIME_ZONE } from '../templates/document-template.schema';

export type DateValue = string | number | Date | null | undefined;

export interface DisplayDateOptions {
  /**
   * Where the day is counted. Unset means UAE time, the same as documents, so
   * a screen and its PDF never disagree about the day.
   */
  timeZone?: string;
  /** Leave the year off, for the first half of a range ("1 Nov – 30 Nov 2026"). */
  withYear?: boolean;
  /** Arabic month names, Western digits. */
  arabic?: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` value is a calendar day, not a moment: read as UTC midnight
 * and printed in UTC, so it never slips to the day before west of Greenwich.
 */
function toDate(value: DateValue): { date: Date; dateOnly: boolean } | null {
  if (value === null || value === undefined || value === '') return null;
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const date =
    value instanceof Date ? value : new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly };
}

const locale = (arabic?: boolean) => (arabic ? 'ar-AE-u-nu-latn' : 'en-GB');

/** "24 Nov 2026", or the fallback (an em dash) when there is no date. */
export function formatDisplayDate(
  value: DateValue,
  options: DisplayDateOptions = {},
  fallback = '—',
): string {
  const parsed = toDate(value);
  if (!parsed) return fallback;
  return new Intl.DateTimeFormat(locale(options.arabic), {
    day: 'numeric',
    month: 'short',
    ...(options.withYear === false ? {} : { year: 'numeric' }),
    timeZone: parsed.dateOnly ? 'UTC' : (options.timeZone ?? DOCUMENT_TIME_ZONE),
  }).format(parsed.date);
}

/** "24 Nov 2026, 14:05". */
export function formatDisplayDateTime(
  value: DateValue,
  options: Omit<DisplayDateOptions, 'withYear'> = {},
  fallback = '—',
): string {
  const parsed = toDate(value);
  if (!parsed) return fallback;
  return new Intl.DateTimeFormat(locale(options.arabic), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: options.timeZone ?? DOCUMENT_TIME_ZONE,
  }).format(parsed.date);
}

/** "November 2026", for a month as a whole (a pay run, a budget period). */
export function formatDisplayMonth(
  value: DateValue,
  options: Pick<DisplayDateOptions, 'timeZone'> & { short?: boolean } = {},
  fallback = '—',
): string {
  const parsed = toDate(value);
  if (!parsed) return fallback;
  return new Intl.DateTimeFormat('en-GB', {
    month: options.short ? 'short' : 'long',
    year: 'numeric',
    timeZone: parsed.dateOnly ? 'UTC' : (options.timeZone ?? DOCUMENT_TIME_ZONE),
  }).format(parsed.date);
}

/**
 * The calendar day a moment falls on in UAE time, as `YYYY-MM-DD`: the same
 * day {@link formatDisplayDate} prints. A `YYYY-MM-DD` value is returned as is.
 */
export function documentDay(value: Date | string, timeZone: string = DOCUMENT_TIME_ZONE): string {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(value));
}

/** The moment the UAE day containing `now` began (midnight Dubai, 20:00 UTC the day before). */
export function startOfDocumentDay(now: Date = new Date(), timeZone: string = DOCUMENT_TIME_ZONE): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone,
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = wall - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - offset);
}
