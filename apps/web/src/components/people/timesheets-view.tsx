'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { PeopleNav } from './people-nav';
import { TimesheetCrewDay } from './timesheet-crew-day';
import { TimesheetWeekGrid } from './timesheet-week-grid';

const TABS = [
  { id: 'week', label: 'Week' },
  { id: 'crew', label: 'Crew day' },
] as const;

export function TimesheetsView() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('week');

  return (
    <div className="space-y-6">
      <PageHeader title="Timesheets" description="Hours worked by employee, job operation and day." />
      <PeopleNav />
      <div role="tablist" aria-label="Timesheet view" className="flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-xl px-3.5 py-2 text-xs font-semibold transition',
              tab === t.id
                ? 'bg-charcoal text-on-charcoal shadow-xs'
                : 'text-ink-muted hover:bg-surface-muted/80 hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'week' ? <TimesheetWeekGrid /> : <TimesheetCrewDay />}
    </div>
  );
}
