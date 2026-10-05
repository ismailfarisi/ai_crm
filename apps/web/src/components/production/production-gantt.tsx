'use client';

import { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Wrench,
  AlertTriangle,
  Kanban,
} from 'lucide-react';
import type { WorkOrderDto, WorkOrderOperationDto } from '@saas/shared';

export interface ProductionGanttProps {
  workOrders: WorkOrderDto[];
  onSelectWorkOrder: (id: string) => void;
}

export type GanttTimeScale = 'day' | 'week' | 'month';
export type GanttViewMode = 'work-order' | 'work-center';

interface TimelineColumn {
  id: string;
  label: string;
  subLabel?: string;
  start: Date;
  end: Date;
  isToday: boolean;
}

function getTimeWindow(anchorDate: Date, scale: GanttTimeScale) {
  const d = new Date(anchorDate);
  if (scale === 'day') {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return { start, end };
  }
  if (scale === 'week') {
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff, 0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    return { start, end };
  }
  // month
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function stepTimeWindow(anchorDate: Date, scale: GanttTimeScale, direction: -1 | 1): Date {
  const d = new Date(anchorDate);
  if (scale === 'day') {
    d.setDate(d.getDate() + direction);
    return d;
  }
  if (scale === 'week') {
    d.setDate(d.getDate() + direction * 7);
    return d;
  }
  // month
  d.setMonth(d.getMonth() + direction);
  return d;
}

function formatWindowLabel(start: Date, end: Date, scale: GanttTimeScale): string {
  if (scale === 'day') {
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (scale === 'week') {
    const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString(undefined, {
      month: start.getMonth() === end.getMonth() ? undefined : 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startStr} – ${endStr}`;
  }
  return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function getTimelineColumns(start: Date, end: Date, scale: GanttTimeScale): TimelineColumn[] {
  const cols: TimelineColumn[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (scale === 'day') {
    for (let h = 0; h < 24; h++) {
      const colStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 0, 0);
      const colEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 59, 59, 999);
      const isToday = colStart.toDateString() === today.toDateString();
      cols.push({
        id: `h-${h}`,
        label: `${String(h).padStart(2, '0')}:00`,
        start: colStart,
        end: colEnd,
        isToday,
      });
    }
  } else if (scale === 'week') {
    const current = new Date(start);
    for (let i = 0; i < 7; i++) {
      const colStart = new Date(current.getFullYear(), current.getMonth(), current.getDate() + i, 0, 0, 0);
      const colEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate() + i, 23, 59, 59, 999);
      const isColToday = colStart.getTime() === today.getTime();
      cols.push({
        id: `d-${i}`,
        label: colStart.toLocaleDateString(undefined, { weekday: 'short' }),
        subLabel: String(colStart.getDate()),
        start: colStart,
        end: colEnd,
        isToday: isColToday,
      });
    }
  } else {
    const totalDays = end.getDate();
    for (let day = 1; day <= totalDays; day++) {
      const colStart = new Date(start.getFullYear(), start.getMonth(), day, 0, 0, 0);
      const colEnd = new Date(start.getFullYear(), start.getMonth(), day, 23, 59, 59, 999);
      const isColToday = colStart.getTime() === today.getTime();
      cols.push({
        id: `m-d-${day}`,
        label: String(day),
        subLabel: colStart.toLocaleDateString(undefined, { weekday: 'narrow' }),
        start: colStart,
        end: colEnd,
        isToday: isColToday,
      });
    }
  }

  return cols;
}

interface WorkCenterRow {
  id: string;
  name: string;
  operations: Array<{
    operation: WorkOrderOperationDto;
    workOrder: WorkOrderDto;
    start: Date;
    end: Date;
  }>;
}

export function ProductionGantt({ workOrders, onSelectWorkOrder }: ProductionGanttProps) {
  const [viewMode, setViewMode] = useState<GanttViewMode>('work-order');
  const [timeScale, setTimeScale] = useState<GanttTimeScale>('month');
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  const [hoveredOp, setHoveredOp] = useState<{
    wo: WorkOrderDto;
    op: WorkOrderOperationDto;
    x: number;
    y: number;
  } | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const { start: windowStart, end: windowEnd } = useMemo(
    () => getTimeWindow(anchorDate, timeScale),
    [anchorDate, timeScale],
  );

  const windowLabel = useMemo(
    () => formatWindowLabel(windowStart, windowEnd, timeScale),
    [windowStart, windowEnd, timeScale],
  );

  const columns = useMemo(
    () => getTimelineColumns(windowStart, windowEnd, timeScale),
    [windowStart, windowEnd, timeScale],
  );

  const winStartMs = windowStart.getTime();
  const winEndMs = windowEnd.getTime();
  const winTotalMs = Math.max(winEndMs - winStartMs, 1);

  const isTodayInRange = useMemo(() => {
    const nowMs = Date.now();
    return nowMs >= winStartMs && nowMs <= winEndMs;
  }, [winStartMs, winEndMs]);

  const todayOffsetPct = useMemo(() => {
    if (!isTodayInRange) return 0;
    const nowMs = Date.now();
    return Math.min(100, Math.max(0, ((nowMs - winStartMs) / winTotalMs) * 100));
  }, [isTodayInRange, winStartMs, winTotalMs]);

  // Group work centres
  const workCenterRows = useMemo(() => {
    const map = new Map<string, WorkCenterRow>();

    for (const wo of workOrders) {
      const woStart = wo.releasedAt ? new Date(wo.releasedAt) : new Date(wo.createdAt);
      const woEnd = wo.dueDate
        ? new Date(wo.dueDate)
        : new Date(woStart.getTime() + 7 * 24 * 3600_000);
      const sortedOps = [...wo.operations].sort((a, b) => a.sequence - b.sequence);
      const totalOps = Math.max(sortedOps.length, 1);
      const woDuration = Math.max(woEnd.getTime() - woStart.getTime(), 3600_000);
      const slotDuration = woDuration / totalOps;

      sortedOps.forEach((op, idx) => {
        let start: Date;
        let end: Date;

        if (op.startedAt) {
          start = new Date(op.startedAt);
          end = op.completedAt
            ? new Date(op.completedAt)
            : new Date(
                Math.max(
                  Date.now(),
                  start.getTime() +
                    (op.estimatedChargedMinutes ||
                      op.estimatedSetupMinutes + op.estimatedRunMinutes ||
                      60) *
                      60_000,
                ),
              );
        } else {
          start = new Date(woStart.getTime() + idx * slotDuration);
          end = new Date(woStart.getTime() + (idx + 1) * slotDuration);
        }

        if (!map.has(op.workCenterId)) {
          map.set(op.workCenterId, {
            id: op.workCenterId,
            name: op.workCenterName,
            operations: [],
          });
        }

        map.get(op.workCenterId)!.operations.push({
          operation: op,
          workOrder: wo,
          start,
          end,
        });
      });
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [workOrders]);

  const handlePrev = () => setAnchorDate((curr) => stepTimeWindow(curr, timeScale, -1));
  const handleNext = () => setAnchorDate((curr) => stepTimeWindow(curr, timeScale, 1));
  const handleToday = () => setAnchorDate(new Date());

  return (
    <section
      aria-label="Production Gantt Schedule"
      className="rounded-2xl border border-line bg-surface p-6 shadow-2xs"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4 mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Floor Schedule &amp; Timeline</h2>
          <p className="text-xs text-ink-muted">
            Visual timeline sequencing operations across work centres.
          </p>
        </div>
        <span className="rounded-full bg-surface-sunk px-3 py-1 text-xs font-medium text-ink-muted">
          {workOrders.length} jobs scheduled
        </span>
      </div>

      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        {/* Mode Switcher */}
        <div className="flex items-center rounded-lg border border-line bg-surface-sunk p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('work-order')}
            aria-label="By Work Order"
            aria-pressed={viewMode === 'work-order'}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'work-order'
                ? 'bg-surface text-ink shadow-2xs'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Layers className="size-3.5" />
            By Work Order
          </button>
          <button
            type="button"
            onClick={() => setViewMode('work-center')}
            aria-label="By Work Centre"
            aria-pressed={viewMode === 'work-center'}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'work-center'
                ? 'bg-surface text-ink shadow-2xs'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Wrench className="size-3.5" />
            By Work Centre
          </button>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous period"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-sunk cursor-pointer"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </button>
            <button
              type="button"
              onClick={handleToday}
              aria-label="Today"
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-sunk cursor-pointer"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label="Next period"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-sunk cursor-pointer"
            >
              Next
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <span className="font-semibold text-xs text-ink min-w-36 text-center">
            {windowLabel}
          </span>
        </div>

        {/* Time Scale Zoom Controls */}
        <div className="flex items-center rounded-lg border border-line bg-surface-sunk p-0.5">
          <button
            type="button"
            onClick={() => setTimeScale('day')}
            aria-label="Day zoom"
            aria-pressed={timeScale === 'day'}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
              timeScale === 'day'
                ? 'bg-surface text-ink shadow-2xs font-semibold'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Day
          </button>
          <button
            type="button"
            onClick={() => setTimeScale('week')}
            aria-label="Week zoom"
            aria-pressed={timeScale === 'week'}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
              timeScale === 'week'
                ? 'bg-surface text-ink shadow-2xs font-semibold'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setTimeScale('month')}
            aria-label="Month zoom"
            aria-pressed={timeScale === 'month'}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
              timeScale === 'month'
                ? 'bg-surface text-ink shadow-2xs font-semibold'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Month
          </button>
        </div>
      </div>

      {/* Main Gantt Grid */}
      {workOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-12 text-center text-xs text-ink-muted">
          No work orders available for schedule.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <div className="min-w-[760px]">
            {/* Header row */}
            <div className="flex border-b border-line bg-surface-sunk/60 text-xs font-semibold text-ink-muted">
              {/* Left Column Header */}
              <div className="w-64 shrink-0 border-r border-line p-3">
                {viewMode === 'work-order' ? 'Work Order' : 'Work Centre'}
              </div>

              {/* Timeline Header Columns */}
              <div
                className="flex-1 relative grid select-none"
                style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
              >
                {columns.map((col) => (
                  <div
                    key={col.id}
                    className={`border-r border-line/40 p-2 text-center text-[11px] truncate ${
                      col.isToday ? 'bg-accent/10 font-bold text-accent' : ''
                    }`}
                  >
                    <span>{col.label}</span>
                    {col.subLabel && (
                      <span className="block text-[10px] text-ink-subtle">{col.subLabel}</span>
                    )}
                  </div>
                ))}

                {/* Today Marker on Header */}
                {isTodayInRange && (
                  <div
                    data-testid="gantt-today-marker-header"
                    className="absolute top-0 bottom-0 pointer-events-none border-l-2 border-accent"
                    style={{ left: `${todayOffsetPct}%` }}
                  >
                    <span className="absolute -top-2 -translate-x-1/2 rounded bg-accent px-1 py-0.5 text-[8px] font-bold text-white shadow-xs uppercase">
                      Today
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Rows Section */}
            {viewMode === 'work-order' ? (
              /* BY WORK ORDER ROWS */
              <div className="divide-y divide-line/60">
                {workOrders.map((wo) => {
                  const woStart = wo.releasedAt ? new Date(wo.releasedAt) : new Date(wo.createdAt);
                  const woEnd = wo.completedAt
                    ? new Date(wo.completedAt)
                    : wo.dueDate
                      ? new Date(wo.dueDate)
                      : new Date(woStart.getTime() + 7 * 24 * 3600_000);

                  const isFinished = wo.status === 'COMPLETE' || wo.status === 'CANCELLED';
                  const isOverdue = Boolean(
                    wo.dueDate &&
                      new Date(wo.dueDate).getTime() < today.getTime() &&
                      !isFinished,
                  );

                  const effectiveEnd =
                    isOverdue && woEnd.getTime() < today.getTime() ? today : woEnd;
                  const s = woStart.getTime();
                  const e = Math.max(effectiveEnd.getTime(), s + 3600_000);

                  const isBeforeWindow = e < winStartMs;
                  const isAfterWindow = s > winEndMs;

                  let leftPct: number;
                  let widthPct: number;
                  let isPinnedPast = false;
                  let isPinnedFuture = false;

                  if (isBeforeWindow) {
                    leftPct = 0;
                    widthPct = 12;
                    isPinnedPast = true;
                  } else if (isAfterWindow) {
                    leftPct = 88;
                    widthPct = 12;
                    isPinnedFuture = true;
                  } else {
                    const clampStart = Math.max(winStartMs, s);
                    const clampEnd = Math.min(winEndMs, e);
                    leftPct = ((clampStart - winStartMs) / winTotalMs) * 100;
                    widthPct = Math.max(((clampEnd - clampStart) / winTotalMs) * 100, 5);
                  }

                  const ops = [...wo.operations].sort((a, b) => a.sequence - b.sequence);
                  const totalEst = ops.reduce((acc, o) => {
                    const est =
                      o.estimatedChargedMinutes ||
                      o.estimatedSetupMinutes + o.estimatedRunMinutes ||
                      30;
                    return acc + est;
                  }, 0);

                  return (
                    <div
                      key={wo.id}
                      className="flex items-stretch hover:bg-surface-sunk/20 transition-colors group"
                    >
                      {/* Left Info Column */}
                      <div
                        onClick={() => onSelectWorkOrder(wo.id)}
                        className="w-64 shrink-0 border-r border-line p-3 cursor-pointer select-none"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-xs font-bold text-ink">
                            {wo.woNumber}
                          </span>
                          {isOverdue && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-danger">
                              <AlertTriangle className="size-3" />
                              Overdue
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs font-medium text-ink mt-0.5">
                          {wo.description}
                        </p>
                        <p className="truncate text-[11px] text-ink-muted">
                          {wo.customerName ?? 'No customer'} · {wo.qty} units
                        </p>
                      </div>

                      {/* Right Timeline Track */}
                      <div className="flex-1 relative min-h-16 flex items-center px-1">
                        {/* Background Grid Lines */}
                        <div
                          className="absolute inset-0 grid pointer-events-none"
                          style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
                        >
                          {columns.map((col) => (
                            <div
                              key={col.id}
                              className={`border-r border-line/30 h-full ${
                                col.isToday ? 'bg-accent/5' : ''
                              }`}
                            />
                          ))}
                        </div>

                        {/* Today Marker */}
                        {isTodayInRange && (
                          <div
                            data-testid="gantt-today-marker"
                            className="absolute top-0 bottom-0 pointer-events-none border-l-2 border-accent z-10"
                            style={{ left: `${todayOffsetPct}%` }}
                          />
                        )}

                        {/* Work Order Span Bar */}
                        <div
                          data-testid="gantt-bar"
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectWorkOrder(wo.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectWorkOrder(wo.id);
                            }
                          }}
                          className={`relative z-10 flex h-9 items-center overflow-hidden rounded-lg shadow-2xs border transition-all cursor-pointer ${
                            isOverdue
                              ? 'border-2 border-danger ring-1 ring-danger/40'
                              : 'border-line'
                          } ${
                            isPinnedPast
                              ? 'bg-surface-sunk text-ink-subtle'
                              : isPinnedFuture
                                ? 'bg-surface-sunk text-ink-subtle'
                                : 'bg-surface'
                          }`}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                          }}
                        >
                          {isPinnedPast ? (
                            <div className="px-2 text-[10px] font-semibold truncate">
                              &lt; Past ({wo.woNumber})
                            </div>
                          ) : isPinnedFuture ? (
                            <div className="px-2 text-[10px] font-semibold truncate">
                              {wo.woNumber} &gt;
                            </div>
                          ) : ops.length === 0 ? (
                            <div className="px-2 text-[10px] font-semibold text-ink-muted truncate">
                              {wo.woNumber}
                            </div>
                          ) : (
                            ops.map((op) => {
                              const est =
                                op.estimatedChargedMinutes ||
                                op.estimatedSetupMinutes + op.estimatedRunMinutes ||
                                30;
                              const weightPct = (est / Math.max(totalEst, 1)) * 100;
                              const isDone = op.status === 'DONE';
                              const isRunning = op.status === 'RUNNING';
                              const isPaused = op.status === 'PAUSED';

                              const progress =
                                est > 0
                                  ? Math.min(100, Math.round((op.actualMinutes / est) * 100))
                                  : isDone
                                    ? 100
                                    : 0;

                              const statusClass = isDone
                                ? 'bg-success/80 text-white'
                                : isRunning
                                  ? 'bg-emerald-500 animate-pulse text-white'
                                  : isPaused
                                    ? 'bg-amber-500/80 text-white'
                                    : 'bg-surface-sunk text-ink-muted border-r border-line';

                              return (
                                <div
                                  key={op.id}
                                  className={`relative h-full flex items-center justify-between px-1.5 text-[10px] font-medium overflow-hidden transition-colors ${statusClass}`}
                                  style={{ width: `${weightPct}%` }}
                                  title={`WO: ${wo.woNumber}\nCustomer: ${
                                    wo.customerName ?? 'No customer'
                                  }\nOperation: ${op.sequence}. ${op.label}\nMachine: ${
                                    op.workCenterName
                                  }\nEst: ${est}m | Act: ${op.actualMinutes}m\nStatus: ${op.status}`}
                                  onMouseEnter={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setHoveredOp({
                                      wo,
                                      op,
                                      x: rect.left + rect.width / 2,
                                      y: rect.top,
                                    });
                                  }}
                                  onMouseLeave={() => setHoveredOp(null)}
                                >
                                  {/* Progress fill */}
                                  {isRunning && progress > 0 && (
                                    <div
                                      className="absolute inset-y-0 left-0 bg-white/20 pointer-events-none rounded-l"
                                      style={{ width: `${progress}%` }}
                                    />
                                  )}
                                  <span className="truncate relative z-10">
                                    {op.sequence}. {op.label}
                                  </span>
                                  {isRunning && (
                                    <span className="relative flex size-1.5 shrink-0 ml-1">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                      <span className="relative inline-flex rounded-full size-1.5 bg-white" />
                                    </span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* BY WORK CENTRE ROWS */
              <div className="divide-y divide-line/60">
                {workCenterRows.map((wc) => (
                  <div
                    key={wc.id}
                    className="flex items-stretch hover:bg-surface-sunk/20 transition-colors group"
                  >
                    {/* Left Machine Column */}
                    <div className="w-64 shrink-0 border-r border-line p-3 select-none">
                      <div className="flex items-center gap-1.5">
                        <Wrench className="size-3.5 text-ink-muted" />
                        <span className="font-semibold text-xs text-ink">{wc.name}</span>
                      </div>
                      <p className="text-[11px] text-ink-muted mt-1">
                        {wc.operations.length} {wc.operations.length === 1 ? 'operation' : 'operations'}
                      </p>
                    </div>

                    {/* Right Timeline Track */}
                    <div className="flex-1 relative min-h-16 flex items-center px-1">
                      {/* Background Grid Lines */}
                      <div
                        className="absolute inset-0 grid pointer-events-none"
                        style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
                      >
                        {columns.map((col) => (
                          <div
                            key={col.id}
                            className={`border-r border-line/30 h-full ${
                              col.isToday ? 'bg-accent/5' : ''
                            }`}
                          />
                        ))}
                      </div>

                      {/* Today Marker */}
                      {isTodayInRange && (
                        <div
                          data-testid="gantt-today-marker"
                          className="absolute top-0 bottom-0 pointer-events-none border-l-2 border-accent z-10"
                          style={{ left: `${todayOffsetPct}%` }}
                        />
                      )}

                      {/* Operations on this Machine */}
                      {wc.operations.map(({ operation: op, workOrder: wo, start, end }) => {
                        const s = start.getTime();
                        const e = Math.max(end.getTime(), s + 3600_000);
                        const isBefore = e < winStartMs;
                        const isAfter = s > winEndMs;

                        let leftPct: number;
                        let widthPct: number;
                        let isPinnedPast = false;
                        let isPinnedFuture = false;

                        if (isBefore) {
                          leftPct = 0;
                          widthPct = 12;
                          isPinnedPast = true;
                        } else if (isAfter) {
                          leftPct = 88;
                          widthPct = 12;
                          isPinnedFuture = true;
                        } else {
                          const clampStart = Math.max(winStartMs, s);
                          const clampEnd = Math.min(winEndMs, e);
                          leftPct = ((clampStart - winStartMs) / winTotalMs) * 100;
                          widthPct = Math.max(((clampEnd - clampStart) / winTotalMs) * 100, 6);
                        }

                        const isDone = op.status === 'DONE';
                        const isRunning = op.status === 'RUNNING';
                        const isPaused = op.status === 'PAUSED';

                        const isFinished = wo.status === 'COMPLETE' || wo.status === 'CANCELLED';
                        const isOverdue = Boolean(
                          wo.dueDate &&
                            new Date(wo.dueDate).getTime() < today.getTime() &&
                            !isFinished,
                        );

                        const est =
                          op.estimatedChargedMinutes ||
                          op.estimatedSetupMinutes + op.estimatedRunMinutes ||
                          30;
                        const progress =
                          est > 0
                            ? Math.min(100, Math.round((op.actualMinutes / est) * 100))
                            : isDone
                              ? 100
                              : 0;

                        const statusClass = isDone
                          ? 'bg-success/80 text-white'
                          : isRunning
                            ? 'bg-emerald-500 animate-pulse text-white'
                            : isPaused
                              ? 'bg-amber-500/80 text-white'
                              : 'bg-surface-sunk text-ink-muted border border-line';

                        return (
                          <div
                            key={op.id}
                            data-testid="gantt-bar"
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectWorkOrder(wo.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectWorkOrder(wo.id);
                              }
                            }}
                            className={`absolute z-10 flex h-8 items-center px-2 rounded-lg text-[10px] font-medium shadow-2xs overflow-hidden transition-all cursor-pointer ${statusClass} ${
                              isOverdue ? 'border-2 border-danger' : ''
                            }`}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                            }}
                            title={`WO: ${wo.woNumber}\nCustomer: ${
                              wo.customerName ?? 'No customer'
                            }\nOperation: ${op.sequence}. ${op.label}\nMachine: ${
                              op.workCenterName
                            }\nEst: ${est}m | Act: ${op.actualMinutes}m\nStatus: ${op.status}`}
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoveredOp({
                                wo,
                                op,
                                x: rect.left + rect.width / 2,
                                y: rect.top,
                              });
                            }}
                            onMouseLeave={() => setHoveredOp(null)}
                          >
                            {/* Progress fill */}
                            {isRunning && progress > 0 && (
                              <div
                                className="absolute inset-y-0 left-0 bg-white/20 pointer-events-none rounded-l"
                                style={{ width: `${progress}%` }}
                              />
                            )}

                            {isPinnedPast ? (
                              <span className="truncate">&lt; {wo.woNumber}</span>
                            ) : isPinnedFuture ? (
                              <span className="truncate">{wo.woNumber} &gt;</span>
                            ) : (
                              <div className="flex items-center gap-1 truncate relative z-10">
                                <span className="font-mono font-bold shrink-0">
                                  {wo.woNumber}
                                </span>
                                <span className="truncate">{op.label}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Hover Tooltip */}
      {hoveredOp && (
        <div
          role="tooltip"
          data-testid="gantt-tooltip"
          className="fixed z-50 pointer-events-none rounded-xl border border-line bg-surface p-3 shadow-xl text-xs text-ink min-w-56 -translate-x-1/2 -translate-y-full mb-2"
          style={{
            top: `${hoveredOp.y - 8}px`,
            left: `${hoveredOp.x}px`,
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line pb-1.5 mb-1.5">
            <span className="font-mono font-bold text-ink">{hoveredOp.wo.woNumber}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                hoveredOp.op.status === 'RUNNING'
                  ? 'bg-success/15 text-success border border-success'
                  : hoveredOp.op.status === 'DONE'
                    ? 'bg-success text-white'
                    : hoveredOp.op.status === 'PAUSED'
                      ? 'bg-warning/20 text-warning border border-warning'
                      : 'bg-surface-sunk text-ink-muted border border-line'
              }`}
            >
              {hoveredOp.op.status}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-ink-muted">Customer:</span>
              <span className="font-medium text-ink truncate max-w-36 text-right">
                {hoveredOp.wo.customerName ?? 'No customer'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-muted">Operation:</span>
              <span className="font-medium text-ink truncate max-w-36 text-right">
                {hoveredOp.op.sequence}. {hoveredOp.op.label}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-muted">Machine:</span>
              <span className="font-medium text-ink truncate max-w-36 text-right">
                {hoveredOp.op.workCenterName}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-muted">Time:</span>
              <span className="font-mono text-ink text-right">
                Est:{' '}
                {hoveredOp.op.estimatedChargedMinutes ||
                  hoveredOp.op.estimatedSetupMinutes + hoveredOp.op.estimatedRunMinutes ||
                  0}
                m | Act: {hoveredOp.op.actualMinutes}m
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
