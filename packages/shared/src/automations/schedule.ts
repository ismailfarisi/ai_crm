import { z } from 'zod';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIMEZONE = 'Asia/Dubai';

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const automationScheduleSchema = z
  .object({
    frequency: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
    minute: z.number().int().min(0).max(59).optional(),
    time: z.string().regex(TIME_RE).optional(),
    /** 1 = Monday ... 7 = Sunday. */
    daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    timezone: z
      .string()
      .refine(isValidTimeZone, { message: 'Unknown time zone' })
      .default(DEFAULT_TIMEZONE),
  })
  .superRefine((s, ctx) => {
    const need = (field: string, ok: boolean) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required` });
    };
    if (s.frequency === 'hourly') need('minute', s.minute !== undefined);
    else need('time', s.time !== undefined);
    if (s.frequency === 'weekly') {
      need('daysOfWeek', s.daysOfWeek !== undefined);
      if (s.daysOfWeek && new Set(s.daysOfWeek).size !== s.daysOfWeek.length) {
        ctx.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'Days must be unique' });
      }
    }
    if (s.frequency === 'monthly') need('dayOfMonth', s.dayOfMonth !== undefined);
  });

export type AutomationSchedule = z.output<typeof automationScheduleSchema>;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function describeSchedule(s: AutomationSchedule): string {
  let text: string;
  switch (s.frequency) {
    case 'hourly':
      text = `Every hour at :${String(s.minute ?? 0).padStart(2, '0')}`;
      break;
    case 'daily':
      text = `Every day at ${s.time}`;
      break;
    case 'weekly': {
      const days = [...new Set(s.daysOfWeek ?? [])].sort((a, b) => a - b);
      const weekdays = days.length === 5 && days.every((d, i) => d === i + 1);
      text = weekdays
        ? `Weekdays at ${s.time}`
        : `Every ${days.map((d) => DAY_NAMES[d - 1]).join(', ')} at ${s.time}`;
      break;
    }
    case 'monthly':
      text = `Monthly on day ${s.dayOfMonth} at ${s.time}`;
      break;
  }
  return `${text} (${s.timezone === DEFAULT_TIMEZONE ? 'Gulf time' : s.timezone})`;
}

const WEEKDAY_NUMBER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

interface WallClock {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  weekday: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: Date, timeZone: string): WallClock {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(instant)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAY_NUMBER[p.weekday],
    day: Number(p.day),
  };
}

const STEP_MS = 15 * 60 * 1000;
const WINDOW_MS = 32 * 24 * 60 * 60 * 1000;

/**
 * Next `count` run instants after `from` (exclusive). The search gives up once
 * 32 days pass without a match, measured from `from` and then from each match
 * (a monthly gap is at most 31 days, so valid schedules never hit it).
 *
 * Candidates are the 15-minute grid points after `from`; every real-world
 * UTC offset is a multiple of 15 minutes, so wall-clock minutes land on the grid.
 * DST: for daily/weekly/monthly schedules, a wall-clock time that occurs twice
 * (fall-back) runs only at its first occurrence that day; one that does not exist
 * (spring-forward) never matches, so that day is skipped. Hourly schedules run at
 * every real matching instant.
 */
export function nextScheduleRuns(s: AutomationSchedule, from: Date, count: number): Date[] {
  const out: Date[] = [];
  const [hh, mm] = s.time ? s.time.split(':').map(Number) : [0, 0];
  const seenDates = new Set<string>();
  let anchor = from.getTime();
  const first = Math.floor(anchor / STEP_MS) * STEP_MS + STEP_MS;
  for (let t = first; t - anchor <= WINDOW_MS && out.length < count; t += STEP_MS) {
    const instant = new Date(t);
    const w = wallClock(instant, s.timezone);
    if (s.frequency === 'hourly') {
      if (w.minute !== s.minute) continue;
    } else {
      if (w.hour !== hh || w.minute !== mm) continue;
      if (s.frequency === 'weekly' && !s.daysOfWeek?.includes(w.weekday)) continue;
      if (s.frequency === 'monthly' && w.day !== s.dayOfMonth) continue;
      if (seenDates.has(w.date)) continue;
      seenDates.add(w.date);
    }
    out.push(instant);
    anchor = t;
  }
  return out;
}
