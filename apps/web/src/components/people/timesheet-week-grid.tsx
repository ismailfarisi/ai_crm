'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Lock } from 'lucide-react';
import { toast } from 'sonner';
import {
  PERMISSIONS,
  TIMESHEET_INDIRECT_CATEGORIES,
  type BulkTimesheetInput,
  type TimesheetEntryDto,
  type TimesheetIndirectCategory,
} from '@saas/shared';
import {
  useSaveTimesheets,
  useTimesheetEmployees,
  useTimesheetOperations,
  useTimesheets,
} from '@/hooks/use-timesheets';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import {
  CATEGORY_LABELS,
  LOCKED_TIP,
  SEVERAL_TIP,
  addDays,
  formatDay,
  formatHours,
  mondayOf,
  parseHoursCell,
  todayIso,
  weekDays,
} from './timesheet-format';

const cellId = (rowKey: string, day: string) => `${rowKey}|${day}`;
const rowKeyOf = (e: Pick<TimesheetEntryDto, 'operationId' | 'indirectCategory'>) =>
  e.operationId ? `op:${e.operationId}` : `cat:${e.indirectCategory}`;

export function TimesheetWeekGrid() {
  const canManage = useCan({ permission: PERMISSIONS.TIMESHEET_MANAGE });
  const employees = useTimesheetEmployees();
  const operations = useTimesheetOperations();
  const save = useSaveTimesheets();

  const [pickedEmployee, setPickedEmployee] = useState('');
  const [monday, setMonday] = useState(() => mondayOf(todayIso()));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [extraRows, setExtraRows] = useState<string[]>([]);

  const employeeId = pickedEmployee || employees.data?.[0]?.id || '';
  const days = useMemo(() => weekDays(monday), [monday]);
  const entries = useTimesheets({ employeeId, from: days[0], to: days[6], enabled: Boolean(employeeId) });

  function reset() {
    setEdits({});
    setExtraRows([]);
  }

  // Entries grouped into cells; a row exists for each target that has hours this week.
  const { cells, rowKeys, labels } = useMemo(() => {
    const cells = new Map<string, TimesheetEntryDto[]>();
    const labels = new Map<string, string>();
    const order: string[] = [];
    const note = (key: string, label: string) => {
      if (!labels.has(key)) {
        labels.set(key, label);
        order.push(key);
      }
    };
    for (const e of entries.data ?? []) {
      const key = rowKeyOf(e);
      note(
        key,
        e.operationId
          ? `${e.woNumber ?? ''} · ${e.operationLabel ?? ''}`
          : CATEGORY_LABELS[e.indirectCategory as TimesheetIndirectCategory],
      );
      const id = cellId(key, e.workDate);
      cells.set(id, [...(cells.get(id) ?? []), e]);
    }
    for (const key of extraRows) {
      if (key.startsWith('op:')) {
        const op = operations.data?.find((o) => o.operationId === key.slice(3));
        note(key, op ? `${op.woNumber} · ${op.operationLabel}` : 'Operation');
      } else {
        note(key, CATEGORY_LABELS[key.slice(4) as TimesheetIndirectCategory]);
      }
    }
    return { cells, rowKeys: order, labels };
  }, [entries.data, extraRows, operations.data]);

  const original = (key: string, day: string) => {
    const list = cells.get(cellId(key, day)) ?? [];
    return list.length === 1 ? formatHours(list[0].hours) : '';
  };
  const valueOf = (key: string, day: string) => edits[cellId(key, day)] ?? original(key, day);

  const dayTotal = (day: string) =>
    rowKeys.reduce((sum, key) => {
      const list = cells.get(cellId(key, day)) ?? [];
      if (list.length > 1) return sum + list.reduce((s, e) => s + e.hours, 0);
      const parsed = parseHoursCell(valueOf(key, day));
      return sum + (parsed.kind === 'ok' ? parsed.hours : 0);
    }, 0);

  const addable = [
    ...(operations.data ?? [])
      .filter((o) => !labels.has(`op:${o.operationId}`))
      .map((o) => ({ value: `op:${o.operationId}`, label: `${o.woNumber} · ${o.operationLabel}` })),
    ...TIMESHEET_INDIRECT_CATEGORIES.filter((c) => !labels.has(`cat:${c}`)).map((c) => ({
      value: `cat:${c}`,
      label: CATEGORY_LABELS[c],
    })),
  ];

  const dirty = Object.entries(edits).filter(([id, v]) => {
    const [key, day] = id.split('|');
    return v !== original(key, day);
  });

  async function onSave() {
    const upserts: BulkTimesheetInput['upserts'] = [];
    const deletes: string[] = [];
    for (const [id, raw] of dirty) {
      const [key, day] = id.split('|');
      const existing = (cells.get(id) ?? [])[0];
      const parsed = parseHoursCell(raw);
      if (parsed.kind === 'invalid') {
        toast.error(`${labels.get(key)}, ${formatDay(day)}: ${parsed.reason}`);
        return;
      }
      if (parsed.kind === 'empty') {
        // A cleared cell deletes its entry; one that never had an entry has nothing to delete.
        if (existing) deletes.push(existing.id);
        continue;
      }
      upserts.push({
        ...(existing ? { id: existing.id } : {}),
        employeeId,
        workDate: day,
        hours: parsed.hours,
        operationId: key.startsWith('op:') ? key.slice(3) : null,
        indirectCategory: key.startsWith('cat:') ? (key.slice(4) as TimesheetIndirectCategory) : null,
        // The bulk schema defaults an omitted note to null, which would wipe it: send it back.
        note: existing?.note ?? null,
      });
    }
    if (upserts.length + deletes.length === 0) {
      reset();
      return;
    }
    try {
      await save.mutateAsync({ upserts, deletes });
    } catch {
      return; // the hook toasted the server's message; keep the edits
    }
    reset();
  }

  const employeeOptions = (employees.data ?? []).map((e) => ({
    value: e.id,
    label: `${e.name} (${e.employeeNumber})`,
  }));

  return (
    <div className="space-y-4" data-testid="timesheet-week-grid">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Employee"
          containerClassName="min-w-56"
          value={employeeId}
          options={employeeOptions}
          onChange={(e) => {
            setPickedEmployee(e.target.value);
            reset();
          }}
        />
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            aria-label="Previous week"
            onClick={() => {
              setMonday(addDays(monday, -7));
              reset();
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span data-testid="week-label" className="min-w-40 text-center text-sm font-semibold text-ink">
            {formatDay(days[0])} – {formatDay(days[6])}
          </span>
          <Button
            variant="ghost"
            aria-label="Next week"
            onClick={() => {
              setMonday(addDays(monday, 7));
              reset();
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {employees.isPending || (Boolean(employeeId) && entries.isPending) ? (
        <Skeleton className="h-48 w-full" />
      ) : !employeeId ? (
        <EmptyState title="No employees to log hours for" />
      ) : entries.isError ? (
        <EmptyState
          title="Couldn't load the timesheet"
          description={entries.error instanceof Error ? entries.error.message : 'Please try again.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/40">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-xs text-ink-muted">
                <th className="px-3 py-2 font-semibold">Job operation / category</th>
                {days.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-semibold">
                    {formatDay(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowKeys.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-ink-muted">
                    No hours this week. Add a row to start.
                  </td>
                </tr>
              )}
              {rowKeys.map((key) => (
                <tr key={key} className="border-b border-border/30">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    {labels.get(key)}
                  </th>
                  {days.map((day) => {
                    const list = cells.get(cellId(key, day)) ?? [];
                    const locked = list.some((e) => e.locked);
                    const several = list.length > 1;
                    const readOnly = !canManage || locked || several;
                    const tip = locked ? LOCKED_TIP : several ? SEVERAL_TIP : undefined;
                    const hasClock = list.some((e) => e.source === 'CLOCK');
                    const shown = several ? formatHours(list.reduce((s, e) => s + e.hours, 0)) : valueOf(key, day);
                    return (
                      <td key={day} className="px-1.5 py-1.5" title={tip}>
                        <div className="relative">
                          <input
                            type="number"
                            inputMode="decimal"
                            step={0.25}
                            min={0}
                            max={24}
                            aria-label={`${labels.get(key)} ${day}`}
                            data-testid={`cell-${key}-${day}`}
                            title={tip}
                            readOnly={readOnly}
                            value={shown}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [cellId(key, day)]: e.target.value }))}
                            className={cn(
                              'h-9 w-full rounded-lg border border-border/50 bg-surface px-2 text-center text-sm tabular-nums',
                              readOnly && 'bg-surface-muted/60 text-ink-muted',
                              edits[cellId(key, day)] !== undefined && !readOnly && 'border-amber-500/70',
                            )}
                          />
                          {(locked || hasClock) && (
                            <span className="pointer-events-none absolute right-1 top-0.5 flex gap-0.5 text-ink-subtle">
                              {hasClock && <Clock className="size-3" aria-label="Clocked in" />}
                              {locked && <Lock className="size-3" aria-label="Locked" />}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-xs font-semibold">
                <th scope="row" className="px-3 py-2 text-left text-ink-muted">
                  Daily total
                </th>
                {days.map((day) => {
                  const total = dayTotal(day);
                  return (
                    <td
                      key={day}
                      data-testid={`day-total-${day}`}
                      className={cn('px-2 py-2 text-center tabular-nums', total > 24 ? 'text-danger' : 'text-ink')}
                    >
                      {formatHours(total)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canManage && employeeId && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Select
            aria-label="Add row"
            containerClassName="min-w-64"
            value=""
            placeholder="Add row…"
            options={addable}
            onChange={(e) => e.target.value && setExtraRows((rows) => [...rows, e.target.value])}
          />
          <Button onClick={onSave} loading={save.isPending} disabled={dirty.length === 0}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
