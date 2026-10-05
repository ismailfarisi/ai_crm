'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Calendar,
  CalendarClock,
  Clock,
  Kanban,
  Search,
  Timer,
} from 'lucide-react';
import {
  PERMISSIONS,
  type WorkOrderStatus,
} from '@saas/shared';
import { useWorkOrders } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { ProductionKanban } from './production-kanban';
import { WorkOrderDrawer } from './work-order-drawer';

export const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  PLANNED: 'Planned',
  RELEASED: 'Released',
  IN_PROGRESS: 'In progress',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
};

/**
 * Modern Jira-like Production Board.
 * Features live KPI summary strip, multi-attribute text search,
 * work centre and due date filters, Board / Gantt view switcher,
 * HTML5 drag-and-drop Kanban, and slide-over floor drawer.
 */
export function ProductionBoard() {
  const [workCenterId, setWorkCenterId] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'board' | 'gantt'>('board');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);

  const canSeeVariance = useCan({ permission: [PERMISSIONS.QUOTE_VIEW_COST] });

  const { data = [], isPending, isError, error } = useWorkOrders(
    {
      ...(workCenterId ? { workCenterId } : {}),
      ...(dueBefore ? { dueBefore } : {}),
    },
    { refetchInterval: 30_000 },
  );

  // Work centres learned from the unfiltered jobs
  const { data: unfiltered = [] } = useWorkOrders({});
  const centres = useMemo(() => {
    const map = new Map<string, string>();
    for (const wo of unfiltered) {
      for (const op of wo.operations) {
        map.set(op.workCenterId, op.workCenterName);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [unfiltered]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Live KPI Summary calculations
  const kpis = useMemo(() => {
    let activeJobs = 0;
    let runningClocks = 0;
    let overdueJobs = 0;
    let totalActualMinutes = 0;
    let totalQuotedMinutes = 0;

    for (const wo of data) {
      if (wo.status === 'RELEASED' || wo.status === 'IN_PROGRESS') {
        activeJobs++;
      }
      if (wo.operations.some((op) => op.status === 'RUNNING')) {
        runningClocks++;
      }
      if (wo.dueDate && wo.status !== 'COMPLETE' && wo.status !== 'CANCELLED') {
        const due = new Date(wo.dueDate);
        const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        if (dueMidnight.getTime() < today.getTime()) {
          overdueJobs++;
        }
      }
      for (const op of wo.operations) {
        if (op.status !== 'SKIPPED') {
          totalActualMinutes += op.actualMinutes;
          totalQuotedMinutes +=
            op.estimatedChargedMinutes || op.estimatedSetupMinutes + op.estimatedRunMinutes;
        }
      }
    }

    const actualHours = (totalActualMinutes / 60).toFixed(1);
    const quotedHours = (totalQuotedMinutes / 60).toFixed(1);

    return {
      activeJobs,
      runningClocks,
      overdueJobs,
      totalActualHours: actualHours,
      totalQuotedHours: quotedHours,
    };
  }, [data, today]);

  // Filtered by text search: woNumber, description, or customerName
  const filteredWorkOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (wo) =>
        wo.woNumber.toLowerCase().includes(q) ||
        wo.description.toLowerCase().includes(q) ||
        (wo.customerName && wo.customerName.toLowerCase().includes(q)),
    );
  }, [data, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production"
        description="Shop floor command center: track running jobs, live clocks, and estimated vs actual time."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* View Switcher: Board vs Gantt */}
            <div className="flex items-center rounded-lg border border-line bg-surface-sunk p-0.5">
              <button
                type="button"
                onClick={() => setView('board')}
                aria-label="Board view"
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  view === 'board'
                    ? 'bg-surface text-ink shadow-2xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Kanban className="size-3.5" />
                Board
              </button>
              <button
                type="button"
                onClick={() => setView('gantt')}
                aria-label="Gantt view"
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  view === 'gantt'
                    ? 'bg-surface text-ink shadow-2xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Calendar className="size-3.5" />
                Gantt
              </button>
            </div>

            {/* Work Centre Filter */}
            <select
              aria-label="Filter by work centre"
              value={workCenterId}
              onChange={(e) => setWorkCenterId(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink"
            >
              <option value="">All work centres</option>
              {centres.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>

            {/* Due Date Filter */}
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              Due by
              <input
                type="date"
                value={dueBefore}
                onChange={(e) => setDueBefore(e.target.value)}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink"
              />
            </label>

            {/* Variance link */}
            {canSeeVariance && (
              <Link
                href="/production/variance"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunk transition-colors"
              >
                <BarChart3 className="size-3.5" />
                Estimate vs actual
              </Link>
            )}
          </div>
        }
      />

      {/* KPI Summary Strip */}
      <section aria-label="Production Key Performance Indicators" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Active Jobs */}
        <div data-testid="kpi-active-jobs" className="rounded-xl border border-line bg-surface p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Active Jobs</span>
            <Activity className="size-4 text-accent" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-ink">{kpis.activeJobs}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">Released &amp; In progress</p>
        </div>

        {/* Running Clocks */}
        <div data-testid="kpi-running-clocks" className="rounded-xl border border-line bg-surface p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Running Clocks</span>
            <div className="flex items-center gap-1">
              {kpis.runningClocks > 0 && (
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-success" />
                </span>
              )}
              <Timer className="size-4 text-success" />
            </div>
          </div>
          <p className={`mt-2 text-2xl font-bold tracking-tight ${kpis.runningClocks > 0 ? 'text-success' : 'text-ink'}`}>
            {kpis.runningClocks}
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">Timers ticking on floor</p>
        </div>

        {/* Overdue Jobs */}
        <div data-testid="kpi-overdue-jobs" className="rounded-xl border border-line bg-surface p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Overdue Jobs</span>
            <AlertTriangle className={`size-4 ${kpis.overdueJobs > 0 ? 'text-danger' : 'text-ink-subtle'}`} />
          </div>
          <p className={`mt-2 text-2xl font-bold tracking-tight ${kpis.overdueJobs > 0 ? 'text-danger' : 'text-ink'}`}>
            {kpis.overdueJobs}
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">Past target completion date</p>
        </div>

        {/* Total Actual vs Quoted Hours */}
        <div data-testid="kpi-variance" className="rounded-xl border border-line bg-surface p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Quoted vs Actual</span>
            <Clock className="size-4 text-ink-muted" />
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-ink font-mono">
            {kpis.totalActualHours}h <span className="text-xs font-normal text-ink-subtle">/ {kpis.totalQuotedHours}h</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">Actual vs Quoted hours</p>
        </div>
      </section>

      {/* Search Input Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-subtle pointer-events-none" />
          <input
            type="text"
            placeholder="Search WO #, description, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-hidden focus:border-accent transition-colors"
            aria-label="Search work orders"
          />
        </div>

        <div className="text-xs text-ink-muted">
          Showing <span className="font-semibold text-ink">{filteredWorkOrders.length}</span> of {data.length} work orders
        </div>
      </div>

      {/* Main Board Area */}
      {isError ? (
        <EmptyState
          title="Couldn't load work orders"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : !isPending && data.length === 0 ? (
        <EmptyState
          title="No work orders"
          description="Plan production from a sales order whose lines were priced from a product template."
        />
      ) : !isPending && filteredWorkOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-12 text-center">
          <p className="text-sm font-semibold text-ink">No matching work orders</p>
          <p className="mt-1 text-xs text-ink-muted">
            No work orders match the query &ldquo;{search}&rdquo;. Try another search or clear the filter.
          </p>
          <button
            type="button"
            onClick={() => setSearch('')}
            className="mt-3 inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunk cursor-pointer"
          >
            Clear search
          </button>
        </div>
      ) : view === 'board' ? (
        <ProductionKanban
          workOrders={filteredWorkOrders}
          onSelectWorkOrder={(id) => setSelectedWorkOrderId(id)}
        />
      ) : (
        /* Gantt View / Timeline Schedule */
        <section aria-label="Production Gantt Schedule" className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
          <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Floor Schedule &amp; Timeline</h2>
              <p className="text-xs text-ink-muted">
                Visual timeline sequencing operations across work centres.
              </p>
            </div>
            <span className="rounded-full bg-surface-sunk px-3 py-1 text-xs font-medium text-ink-muted">
              {filteredWorkOrders.length} jobs scheduled
            </span>
          </div>

          <div className="space-y-4">
            {filteredWorkOrders.map((wo) => {
              const ops = [...wo.operations].sort((a, b) => a.sequence - b.sequence);

              return (
                <div
                  key={wo.id}
                  onClick={() => setSelectedWorkOrderId(wo.id)}
                  className="rounded-xl border border-line p-4 transition-all hover:border-accent hover:bg-surface-sunk/30 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ink">{wo.woNumber}</span>
                      <span className="text-xs text-ink-muted font-medium truncate max-w-xs">
                        {wo.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ink-subtle">
                      <span>{wo.qty} units</span>
                      {wo.dueDate && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3" />
                          {new Date(wo.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Operation Timeline Track */}
                  <div className="flex items-center gap-1.5 pt-2">
                    {ops.map((op) => (
                      <div
                        key={op.id}
                        className={`flex-1 rounded-md px-2 py-1.5 text-[11px] border font-medium ${
                          op.status === 'RUNNING'
                            ? 'bg-success/15 border-success text-success animate-pulse'
                            : op.status === 'DONE'
                              ? 'bg-surface-sunk border-line text-ink-subtle line-through'
                              : 'bg-surface border-line text-ink'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">{op.sequence}. {op.label}</span>
                          <span className="font-mono text-[10px] ml-1">{op.workCenterName}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Slide-Over Work Order Floor Drawer */}
      <WorkOrderDrawer
        workOrderId={selectedWorkOrderId}
        onClose={() => setSelectedWorkOrderId(null)}
      />
    </div>
  );
}
