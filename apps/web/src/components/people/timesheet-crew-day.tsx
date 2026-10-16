'use client';

import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, type BulkTimesheetInput } from '@saas/shared';
import {
  useCrewTimesheets,
  useSaveTimesheets,
  useTimesheetEmployees,
  useTimesheetOperations,
} from '@/hooks/use-timesheets';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { LOCKED_TIP, SEVERAL_TIP, formatDay, formatHours, parseHoursCell, todayIso } from './timesheet-format';

export function TimesheetCrewDay() {
  const canManage = useCan({ permission: PERMISSIONS.TIMESHEET_MANAGE });
  const employees = useTimesheetEmployees();
  const operations = useTimesheetOperations();
  const save = useSaveTimesheets();

  const [workDate, setWorkDate] = useState(todayIso);
  const [workOrderId, setWorkOrderId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const crew = useCrewTimesheets({ workDate, workOrderId });

  const workOrders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of operations.data ?? []) {
      if (!seen.has(o.workOrderId)) seen.set(o.workOrderId, `${o.woNumber} · ${o.description}`);
    }
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [operations.data]);
  const operationOptions = (operations.data ?? [])
    .filter((o) => o.workOrderId === workOrderId)
    .map((o) => ({ value: o.operationId, label: o.operationLabel }));

  // Only people employed on the chosen day can have worked it.
  const crewMembers = (employees.data ?? []).filter(
    (e) => e.joiningDate <= workDate && (e.leavingDate === null || e.leavingDate >= workDate),
  );
  const entriesFor = (employeeId: string) =>
    (crew.data ?? []).filter((e) => e.employeeId === employeeId && e.operationId === operationId);
  const original = (employeeId: string) => {
    const list = entriesFor(employeeId);
    return list.length === 1 ? formatHours(list[0].hours) : '';
  };
  const valueOf = (employeeId: string) => edits[employeeId] ?? original(employeeId);
  const dirty = Object.entries(edits).filter(([id, v]) => v !== original(id));

  function pick(next: { workDate?: string; workOrderId?: string; operationId?: string }) {
    if (next.workDate !== undefined) setWorkDate(next.workDate);
    if (next.workOrderId !== undefined) setWorkOrderId(next.workOrderId);
    setOperationId(next.operationId ?? '');
    setEdits({});
  }

  async function onSave() {
    const upserts: BulkTimesheetInput['upserts'] = [];
    const deletes: string[] = [];
    for (const [employeeId, raw] of dirty) {
      const existing = entriesFor(employeeId)[0];
      const name = crewMembers.find((e) => e.id === employeeId)?.name ?? 'Employee';
      const parsed = parseHoursCell(raw);
      if (parsed.kind === 'invalid') {
        toast.error(`${name}: ${parsed.reason}`);
        return;
      }
      if (parsed.kind === 'empty') {
        // A cleared hour box deletes the entry; hours of 0 are never sent.
        if (existing) deletes.push(existing.id);
        continue;
      }
      upserts.push({
        ...(existing ? { id: existing.id } : {}),
        employeeId,
        workDate,
        hours: parsed.hours,
        operationId,
        indirectCategory: null,
        // An omitted note is saved as null, which would wipe it: send it back.
        note: existing?.note ?? null,
      });
    }
    if (upserts.length + deletes.length === 0) {
      setEdits({});
      return;
    }
    try {
      await save.mutateAsync({ upserts, deletes });
    } catch {
      return; // the hook toasted the server's message; keep the edits
    }
    setEdits({});
  }

  return (
    <div className="space-y-4" data-testid="timesheet-crew-day">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Date" type="date" value={workDate} onChange={(e) => e.target.value && pick({ workDate: e.target.value, workOrderId })} />
        <Select
          label="Work order"
          containerClassName="min-w-56"
          value={workOrderId}
          placeholder="Choose a work order"
          options={workOrders}
          onChange={(e) => pick({ workOrderId: e.target.value })}
        />
        <Select
          label="Operation"
          containerClassName="min-w-48"
          value={operationId}
          placeholder="Choose an operation"
          options={operationOptions}
          disabled={!workOrderId}
          onChange={(e) => {
            setOperationId(e.target.value);
            setEdits({});
          }}
        />
      </div>

      {!workOrderId || !operationId ? (
        <EmptyState title="Choose a work order and operation" description="Then enter each person's hours for the day." />
      ) : employees.isPending || crew.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : crew.isError ? (
        <EmptyState
          title="Couldn't load the crew"
          description={crew.error instanceof Error ? crew.error.message : 'Please try again.'}
        />
      ) : crewMembers.length === 0 ? (
        <EmptyState title={`Nobody was employed on ${formatDay(workDate)}`} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-xs text-ink-muted">
                <th className="px-3 py-2 font-semibold">Employee</th>
                <th className="w-40 px-3 py-2 text-center font-semibold">Hours</th>
              </tr>
            </thead>
            <tbody>
              {crewMembers.map((e) => {
                const list = entriesFor(e.id);
                const locked = list.some((x) => x.locked);
                const several = list.length > 1;
                const readOnly = !canManage || locked || several;
                const tip = locked ? LOCKED_TIP : several ? SEVERAL_TIP : undefined;
                return (
                  <tr key={e.id} className="border-b border-border/30">
                    <td className="px-3 py-2 text-ink">
                      {e.name} <span className="text-xs text-ink-muted">{e.employeeNumber}</span>
                    </td>
                    <td className="px-3 py-1.5" title={tip}>
                      <div className="relative">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={0.25}
                          min={0}
                          max={24}
                          aria-label={`Hours for ${e.name}`}
                          title={tip}
                          readOnly={readOnly}
                          value={several ? formatHours(list.reduce((s, x) => s + x.hours, 0)) : valueOf(e.id)}
                          onChange={(ev) => setEdits((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                          className={cn(
                            'h-9 w-full rounded-lg border border-border/50 bg-surface px-2 text-center text-sm tabular-nums',
                            readOnly && 'bg-surface-muted/60 text-ink-muted',
                          )}
                        />
                        {locked && <Lock className="absolute right-1 top-0.5 size-3 text-ink-subtle" aria-label="Locked" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && workOrderId && operationId && (
        <div className="flex justify-end">
          <Button onClick={onSave} loading={save.isPending} disabled={dirty.length === 0}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
