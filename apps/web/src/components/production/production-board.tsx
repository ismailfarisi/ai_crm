'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CalendarClock, Timer } from 'lucide-react';
import { PERMISSIONS, type WorkOrderDto, type WorkOrderStatus } from '@saas/shared';
import { useWorkOrders } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';
import { EmptyState, PageHeader } from '@/components/ui/primitives';

const COLUMNS: { status: WorkOrderStatus; label: string }[] = [
  { status: 'PLANNED', label: 'Planned' },
  { status: 'RELEASED', label: 'Released' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'COMPLETE', label: 'Complete' },
];

export const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  PLANNED: 'Planned',
  RELEASED: 'Released',
  IN_PROGRESS: 'In progress',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
};

const minutes = (n: number) => {
  const r = Math.round(n);
  return r < 60 ? `${r}m` : `${Math.floor(r / 60)}h${r % 60 ? ` ${r % 60}m` : ''}`;
};

function progress(wo: WorkOrderDto) {
  const ops = wo.operations.filter((op) => op.status !== 'SKIPPED');
  const done = ops.filter((op) => op.status === 'DONE').length;
  const estimated = ops.reduce((s, op) => s + op.estimatedSetupMinutes + op.estimatedRunMinutes, 0);
  const actual = ops.reduce((s, op) => s + op.actualMinutes, 0);
  const running = wo.operations.find((op) => op.status === 'RUNNING');
  return { done, total: ops.length, estimated, actual, running };
}

/**
 * Work orders by status. Refreshes every 30 seconds, because the board is
 * usually on a screen by the door and nobody is going to press reload.
 */
export function ProductionBoard() {
  const [workCenterId, setWorkCenterId] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const canSeeVariance = useCan({ permission: [PERMISSIONS.QUOTE_VIEW_COST] });
  const { data = [], isPending, isError, error } = useWorkOrders(
    {
      ...(workCenterId ? { workCenterId } : {}),
      ...(dueBefore ? { dueBefore } : {}),
    },
    { refetchInterval: 30_000 },
  );

  // Work centres are learned from the jobs themselves: the board only ever
  // needs to filter by centres that have work.
  const { data: unfiltered = [] } = useWorkOrders({});
  const centres = useMemo(() => {
    const map = new Map<string, string>();
    for (const wo of unfiltered) for (const op of wo.operations) map.set(op.workCenterId, op.workCenterName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [unfiltered]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      <PageHeader
        title="Production"
        description="Every job on the floor, and how its time compares with what was quoted."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by work centre"
              value={workCenterId}
              onChange={(e) => setWorkCenterId(e.target.value)}
              className="rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">All work centres</option>
              {centres.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Due by
              <input
                type="date"
                value={dueBefore}
                onChange={(e) => setDueBefore(e.target.value)}
                className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            {canSeeVariance && (
              <Link
                href="/production/variance"
                className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm text-ink hover:bg-surface-sunk"
              >
                <BarChart3 className="size-4" />
                Estimate vs actual
              </Link>
            )}
          </div>
        }
      />

      {isError ? (
        <EmptyState title="Couldn't load work orders" description={error instanceof Error ? error.message : 'Please try again.'} />
      ) : !isPending && data.length === 0 ? (
        <EmptyState
          title="No work orders"
          description="Plan production from a sales order whose lines were priced from a product template."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const jobs = data.filter((wo) => wo.status === column.status);
            return (
              <section key={column.status} aria-labelledby={`col-${column.status}`} className="min-w-0">
                <h2 id={`col-${column.status}`} className="mb-2 flex items-center justify-between text-sm font-medium text-ink">
                  {column.label}
                  <span className="rounded bg-surface-sunk px-2 py-0.5 text-xs text-ink-muted">{jobs.length}</span>
                </h2>
                <ul className="space-y-2">
                  {jobs.map((wo) => {
                    const p = progress(wo);
                    const late = wo.dueDate && new Date(wo.dueDate) < today && wo.status !== 'COMPLETE';
                    const over = p.estimated > 0 && p.actual > p.estimated;
                    return (
                      <li key={wo.id}>
                        <Link
                          href={`/production/${wo.id}`}
                          className="block rounded border border-line bg-surface p-3 hover:border-accent"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-sm font-medium text-ink">{wo.woNumber}</span>
                            {wo.dueDate && (
                              <span className={`inline-flex items-center gap-1 text-xs ${late ? 'text-danger' : 'text-ink-subtle'}`}>
                                <CalendarClock className="size-3" />
                                {new Date(wo.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-sm text-ink">{wo.description}</p>
                          <p className="truncate text-xs text-ink-subtle">
                            {wo.qty} · {wo.customerName ?? 'No customer'}
                          </p>
                          {p.total > 0 && (
                            <div className="mt-2">
                              <div className="h-1.5 rounded bg-surface-sunk" aria-hidden>
                                <div
                                  className="h-1.5 rounded bg-accent"
                                  style={{ width: `${(p.done / p.total) * 100}%` }}
                                />
                              </div>
                              <p className="mt-1 flex items-center justify-between text-xs text-ink-muted">
                                <span>
                                  {p.done}/{p.total} operations
                                </span>
                                <span className={over ? 'text-warning' : ''}>
                                  {minutes(p.actual)} / {minutes(p.estimated)}
                                </span>
                              </p>
                            </div>
                          )}
                          {p.running && (
                            <p className="mt-1 inline-flex items-center gap-1 text-xs text-success">
                              <Timer className="size-3" />
                              {p.running.label} running
                            </p>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
