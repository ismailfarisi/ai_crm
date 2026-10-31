'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  automationScheduleSchema,
  describeSchedule,
  nextScheduleRuns,
  type AutomationSchedule,
} from '@saas/shared';

export interface ScheduleTriggerFieldsProps {
  /** The stored schedule. Without one the editor starts empty and writes nothing until the user picks. */
  schedule?: AutomationSchedule;
  onChange: (schedule: AutomationSchedule) => void;
  /** False while the inputs do not make a valid schedule. */
  onValidityChange?: (valid: boolean) => void;
  /** Read-only users see the saved schedule but no inputs. */
  canEdit?: boolean;
  /** Injected for tests. */
  now?: () => Date;
}

const ZONES: { value: string; label: string }[] = [
  { value: 'Asia/Dubai', label: 'Gulf time (Dubai)' },
  { value: 'Asia/Riyadh', label: 'Riyadh' },
  { value: 'Asia/Kolkata', label: 'India (Kolkata)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'UTC', label: 'UTC' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Draft = {
  frequency: AutomationSchedule['frequency'];
  minute?: number;
  time?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  timezone: string;
};

const DEFAULT_ZONE = 'Asia/Dubai';

function formatRun(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function ScheduleTriggerFields({
  schedule,
  onChange,
  onValidityChange,
  canEdit = true,
  now,
}: ScheduleTriggerFieldsProps) {
  const [draft, setDraft] = useState<Draft | null>(schedule ?? null);

  const parsed = useMemo(() => (draft ? automationScheduleSchema.safeParse(draft) : null), [draft]);
  const valid = parsed ? parsed.success : true;

  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);

  const update = (next: Draft) => {
    setDraft(next);
    const result = automationScheduleSchema.safeParse(next);
    if (result.success) onChange(result.data);
  };

  const setFrequency = (frequency: Draft['frequency']) => {
    const prev: Partial<Draft> = draft ?? {};
    const base: Draft = { frequency, timezone: prev.timezone ?? DEFAULT_ZONE };
    if (frequency === 'hourly') base.minute = prev.minute ?? 0;
    else base.time = prev.time ?? '09:00';
    if (frequency === 'weekly') base.daysOfWeek = prev.daysOfWeek ?? [1];
    if (frequency === 'monthly') base.dayOfMonth = prev.dayOfMonth ?? 1;
    update(base);
  };

  const toggleDay = (day: number) => {
    if (!draft) return;
    const current = draft.daysOfWeek ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    update({ ...draft, daysOfWeek: next.sort((a, b) => a - b) });
  };

  const timezone = draft?.timezone ?? DEFAULT_ZONE;
  const zones = ZONES.some((z) => z.value === timezone) ? ZONES : [...ZONES, { value: timezone, label: timezone }];

  const runs = parsed?.success ? nextScheduleRuns(parsed.data, (now ?? (() => new Date()))(), 3) : [];

  return (
    <div data-testid="schedule-trigger-fields" className="space-y-3 pt-2 border-t border-border/40">
      {!draft && (
        <p data-testid="schedule-empty-prompt" className="text-[11px] font-semibold text-ink">
          Choose when this automation runs
        </p>
      )}

      {canEdit && (
        <>
          <div className="space-y-1">
            <label htmlFor="schedule-frequency" className="text-[11px] font-medium text-ink">Repeat</label>
            <select
              id="schedule-frequency"
              data-testid="schedule-frequency"
              value={draft?.frequency ?? ''}
              onChange={(e) => setFrequency(e.target.value as Draft['frequency'])}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink bg-surface-muted"
            >
              {!draft && (
                <option value="" disabled>
                  Select…
                </option>
              )}
              <option value="hourly">Every hour</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </div>

          {draft?.frequency === 'hourly' && (
            <div className="space-y-1">
              <label htmlFor="schedule-minute" className="text-[11px] font-medium text-ink">Minute past the hour</label>
              <input
                id="schedule-minute"
                type="number"
                data-testid="schedule-minute"
                value={draft.minute ?? ''}
                onChange={(e) =>
                  update({ ...draft, minute: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-ink"
              />
            </div>
          )}

          {draft?.frequency === 'weekly' && (
            <div className="flex flex-wrap gap-1" data-testid="schedule-days">
              {DAYS.map((label, i) => {
                const day = i + 1;
                const on = (draft.daysOfWeek ?? []).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    data-testid={`schedule-day-${day}`}
                    onClick={() => toggleDay(day)}
                    className={`rounded-lg border px-2 py-1 text-xs ${on ? 'border-brand bg-brand text-on-brand' : 'border-border text-ink-muted'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {draft?.frequency === 'monthly' && (
            <div className="space-y-1">
              <label htmlFor="schedule-day-of-month" className="text-[11px] font-medium text-ink">Day of the month (1-28)</label>
              <input
                id="schedule-day-of-month"
                type="number"
                data-testid="schedule-day-of-month"
                value={draft.dayOfMonth ?? ''}
                onChange={(e) =>
                  update({ ...draft, dayOfMonth: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-ink"
              />
            </div>
          )}

          {draft && draft.frequency !== 'hourly' && (
            <div className="space-y-1">
              <label htmlFor="schedule-time" className="text-[11px] font-medium text-ink">Time</label>
              <input
                id="schedule-time"
                type="time"
                data-testid="schedule-time"
                value={draft.time ?? ''}
                onChange={(e) => update({ ...draft, time: e.target.value || undefined })}
                className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-ink"
              />
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="schedule-timezone" className="text-[11px] font-medium text-ink">Time zone</label>
            <select
              id="schedule-timezone"
              data-testid="schedule-timezone"
              value={timezone}
              disabled={!draft}
              onChange={(e) => draft && update({ ...draft, timezone: e.target.value })}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink bg-surface-muted"
            >
              {zones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {parsed?.success ? (
        <div className="space-y-1">
          <p data-testid="schedule-summary" className="text-xs font-semibold text-ink">
            {describeSchedule(parsed.data)}
          </p>
          <ul data-testid="schedule-next-runs" className="text-[11px] text-ink-muted space-y-0.5">
            {runs.map((r) => (
              <li key={r.toISOString()}>{formatRun(r, parsed.data.timezone)}</li>
            ))}
          </ul>
        </div>
      ) : parsed ? (
        <p data-testid="schedule-error" role="alert" className="text-[11px] text-danger">
          {parsed.error.issues[0]?.message}
        </p>
      ) : null}
    </div>
  );
}
