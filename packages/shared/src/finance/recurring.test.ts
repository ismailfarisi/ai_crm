import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped, dueOccurrences, monthlyEquivalent, monthsPerInterval,
  occurrenceDate, occurrenceIndexOnOrAfter, periodFor,
} from './recurring';

describe('recurring schedule maths', () => {
  it('knows the length of each interval', () => {
    expect([monthsPerInterval('MONTHLY'), monthsPerInterval('QUARTERLY'), monthsPerInterval('SEMI_ANNUAL'), monthsPerInterval('ANNUAL')]).toEqual([1, 3, 6, 12]);
    expect(monthlyEquivalent(120_000, 'ANNUAL')).toBe(10_000);
    expect(monthlyEquivalent(30_000, 'QUARTERLY')).toBe(10_000);
  });

  it('clamps to month end without drifting off the anchor day', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(occurrenceDate('2026-01-31', 2, 'MONTHLY')).toBe('2026-03-31');
  });

  it('handles an annual schedule anchored on 29 February', () => {
    expect(occurrenceDate('2028-02-29', 1, 'ANNUAL')).toBe('2029-02-28');
    expect(occurrenceDate('2028-02-29', 4, 'ANNUAL')).toBe('2032-02-29');
  });

  it('gives each period from its occurrence to the day before the next', () => {
    expect(periodFor('2026-01-01', 0, 'ANNUAL')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodFor('2026-01-31', 0, 'MONTHLY')).toEqual({ start: '2026-01-31', end: '2026-02-27' });
    expect(periodFor('2026-04-01', 1, 'QUARTERLY')).toEqual({ start: '2026-07-01', end: '2026-09-30' });
  });

  it('lists every missed occurrence up to today for catch-up', () => {
    expect(dueOccurrences({ startDate: '2026-07-01', endDate: null, interval: 'MONTHLY', fromIndex: 0, today: '2026-10-16' })).toEqual([0, 1, 2, 3]);
    expect(dueOccurrences({ startDate: '2026-07-01', endDate: null, interval: 'MONTHLY', fromIndex: 2, today: '2026-10-16' })).toEqual([2, 3]);
  });

  it('stops at the end date (exclusive)', () => {
    expect(dueOccurrences({ startDate: '2026-07-01', endDate: '2026-09-01', interval: 'MONTHLY', fromIndex: 0, today: '2026-10-16' })).toEqual([0, 1]);
  });

  it('finds the first occurrence on or after a date (resume)', () => {
    expect(occurrenceIndexOnOrAfter('2026-01-15', 'MONTHLY', '2026-10-16')).toBe(10); // 2026-11-15
    expect(occurrenceIndexOnOrAfter('2026-01-15', 'MONTHLY', '2026-10-15')).toBe(9);
  });
});
