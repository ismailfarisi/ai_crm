import { describe, it, expect } from 'vitest';
import {
  automationScheduleSchema,
  describeSchedule,
  nextScheduleRuns,
  type AutomationSchedule,
} from './schedule';

const hourly: AutomationSchedule = { frequency: 'hourly', minute: 15, timezone: 'Asia/Dubai' };
const daily: AutomationSchedule = { frequency: 'daily', time: '09:00', timezone: 'Asia/Dubai' };
const weekdays: AutomationSchedule = {
  frequency: 'weekly',
  daysOfWeek: [1, 2, 3, 4, 5],
  time: '09:00',
  timezone: 'Asia/Dubai',
};
const monWed: AutomationSchedule = {
  frequency: 'weekly',
  daysOfWeek: [1, 3],
  time: '09:00',
  timezone: 'Asia/Dubai',
};
const monthly: AutomationSchedule = {
  frequency: 'monthly',
  dayOfMonth: 1,
  time: '09:00',
  timezone: 'Asia/Dubai',
};

const iso = (d: Date[]) => d.map((x) => x.toISOString());

describe('automationScheduleSchema', () => {
  it('accepts one valid example per frequency', () => {
    for (const s of [hourly, daily, weekdays, monWed, monthly]) {
      expect(automationScheduleSchema.safeParse(s).success).toBe(true);
    }
  });

  it('defaults the time zone to Asia/Dubai', () => {
    const r = automationScheduleSchema.parse({ frequency: 'daily', time: '09:00' });
    expect(r.timezone).toBe('Asia/Dubai');
  });

  it.each([
    ['minute 60', { ...hourly, minute: 60 }],
    ['dayOfMonth 29', { ...monthly, dayOfMonth: 29 }],
    ['empty daysOfWeek', { ...weekdays, daysOfWeek: [] }],
    ['daysOfWeek 8', { ...weekdays, daysOfWeek: [8] }],
    ['duplicate days', { ...weekdays, daysOfWeek: [1, 1] }],
    ['time 24:00', { ...daily, time: '24:00' }],
    ['unknown zone', { ...daily, timezone: 'Mars/Base' }],
    ['hourly without minute', { frequency: 'hourly', timezone: 'Asia/Dubai' }],
    ['daily without time', { frequency: 'daily', timezone: 'Asia/Dubai' }],
    ['weekly without days', { frequency: 'weekly', time: '09:00' }],
    ['monthly without day', { frequency: 'monthly', time: '09:00' }],
  ])('rejects %s', (_n, value) => {
    expect(automationScheduleSchema.safeParse(value).success).toBe(false);
  });
});

describe('describeSchedule', () => {
  it('describes each frequency', () => {
    expect(describeSchedule(hourly)).toBe('Every hour at :15 (Gulf time)');
    expect(describeSchedule(daily)).toBe('Every day at 09:00 (Gulf time)');
    expect(describeSchedule(weekdays)).toBe('Weekdays at 09:00 (Gulf time)');
    expect(describeSchedule(monWed)).toBe('Every Mon, Wed at 09:00 (Gulf time)');
    expect(describeSchedule(monthly)).toBe('Monthly on day 1 at 09:00 (Gulf time)');
  });

  it('names other zones', () => {
    expect(describeSchedule({ ...daily, timezone: 'Europe/London' })).toBe(
      'Every day at 09:00 (Europe/London)',
    );
  });
});

describe('nextScheduleRuns', () => {
  it('daily 09:00 Dubai', () => {
    expect(iso(nextScheduleRuns(daily, new Date('2026-10-29T06:00:00Z'), 3))).toEqual([
      '2026-10-30T05:00:00.000Z',
      '2026-10-31T05:00:00.000Z',
      '2026-11-01T05:00:00.000Z',
    ]);
  });

  it('hourly at :15', () => {
    expect(iso(nextScheduleRuns(hourly, new Date('2026-10-29T06:20:00Z'), 3))).toEqual([
      '2026-10-29T07:15:00.000Z',
      '2026-10-29T08:15:00.000Z',
      '2026-10-29T09:15:00.000Z',
    ]);
  });

  it('daily 09:10 Dubai (a minute off the quarter-hour grid)', () => {
    const s: AutomationSchedule = { frequency: 'daily', time: '09:10', timezone: 'Asia/Dubai' };
    expect(iso(nextScheduleRuns(s, new Date('2026-10-29T06:00:00Z'), 2))).toEqual([
      '2026-10-30T05:10:00.000Z',
      '2026-10-31T05:10:00.000Z',
    ]);
  });

  it('hourly at :07', () => {
    const s: AutomationSchedule = { frequency: 'hourly', minute: 7, timezone: 'Asia/Dubai' };
    expect(iso(nextScheduleRuns(s, new Date('2026-10-29T06:07:00Z'), 3))).toEqual([
      '2026-10-29T07:07:00.000Z',
      '2026-10-29T08:07:00.000Z',
      '2026-10-29T09:07:00.000Z',
    ]);
  });

  it('excludes from itself', () => {
    expect(iso(nextScheduleRuns(hourly, new Date('2026-10-29T07:15:00Z'), 1))).toEqual([
      '2026-10-29T08:15:00.000Z',
    ]);
  });

  it('weekdays skip the weekend', () => {
    // 2026-10-30 is a Friday
    expect(iso(nextScheduleRuns(weekdays, new Date('2026-10-30T06:00:00Z'), 3))).toEqual([
      '2026-11-02T05:00:00.000Z',
      '2026-11-03T05:00:00.000Z',
      '2026-11-04T05:00:00.000Z',
    ]);
  });

  it('monthly on day 1', () => {
    expect(iso(nextScheduleRuns(monthly, new Date('2026-10-29T00:00:00Z'), 2))).toEqual([
      '2026-11-01T05:00:00.000Z',
      '2026-12-01T05:00:00.000Z',
    ]);
  });

  it('gives up after 32 days without a match', () => {
    // day 30 never occurs in February, so the next match is past the window.
    const never: AutomationSchedule = { ...monthly, dayOfMonth: 30 };
    expect(nextScheduleRuns(never, new Date('2027-01-31T00:00:00Z'), 2)).toEqual([]);
  });

  it('London daily 01:30 across the October fall-back gives one run per day', () => {
    const s: AutomationSchedule = { frequency: 'daily', time: '01:30', timezone: 'Europe/London' };
    // 01:30 happens twice on 2026-10-25; only the first (BST, 00:30Z) counts.
    expect(iso(nextScheduleRuns(s, new Date('2026-10-23T23:00:00Z'), 4))).toEqual([
      '2026-10-24T00:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-26T01:30:00.000Z',
      '2026-10-27T01:30:00.000Z',
    ]);
  });

  it('London daily 01:30 skips the spring-forward day where it does not exist', () => {
    const s: AutomationSchedule = { frequency: 'daily', time: '01:30', timezone: 'Europe/London' };
    // 2027-03-28: clocks jump 01:00 -> 02:00, so 01:30 never happens; that day is skipped.
    expect(iso(nextScheduleRuns(s, new Date('2027-03-26T12:00:00Z'), 3))).toEqual([
      '2027-03-27T01:30:00.000Z',
      '2027-03-29T00:30:00.000Z',
      '2027-03-30T00:30:00.000Z',
    ]);
  });
});
