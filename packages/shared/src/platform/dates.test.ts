import { describe, expect, it } from 'vitest';
import { formatDisplayDate, formatDisplayDateTime, formatDisplayMonth } from './dates';

describe('formatDisplayDate', () => {
  it('writes the day first with the month as a word', () => {
    expect(formatDisplayDate('2026-11-24T10:00:00Z', { timeZone: 'Asia/Dubai' })).toBe('24 Nov 2026');
    expect(formatDisplayDate(new Date(Date.UTC(2026, 0, 5, 12)), { timeZone: 'UTC' })).toBe('5 Jan 2026');
  });

  it('keeps a calendar day on its day in any time zone', () => {
    expect(formatDisplayDate('2026-11-24', { timeZone: 'America/Los_Angeles' })).toBe('24 Nov 2026');
    expect(formatDisplayDate('2026-11-24')).toBe('24 Nov 2026');
  });

  it('counts a moment in the time zone it is given', () => {
    // 22:30 UTC is already the next day in Dubai.
    expect(formatDisplayDate('2026-11-24T22:30:00Z', { timeZone: 'Asia/Dubai' })).toBe('25 Nov 2026');
  });

  it('can leave the year off for the start of a range', () => {
    expect(formatDisplayDate('2026-11-01', { withYear: false })).toBe('1 Nov');
  });

  it('prints the fallback for a missing or broken date', () => {
    expect(formatDisplayDate(null)).toBe('—');
    expect(formatDisplayDate(undefined, {}, '')).toBe('');
    expect(formatDisplayDate('not a date')).toBe('—');
  });

  it('writes Arabic month names with Western digits', () => {
    expect(formatDisplayDate('2026-11-24', { arabic: true })).toMatch(/^24 .+ 2026$/);
  });
});

describe('formatDisplayDateTime', () => {
  it('adds a 24-hour time', () => {
    expect(formatDisplayDateTime('2026-11-24T10:05:00Z', { timeZone: 'Asia/Dubai' })).toBe(
      '24 Nov 2026, 14:05',
    );
  });
});

describe('formatDisplayMonth', () => {
  it('names the month and year', () => {
    expect(formatDisplayMonth('2026-11-01')).toBe('November 2026');
    expect(formatDisplayMonth('2026-11-01', { short: true })).toBe('Nov 2026');
  });
});
