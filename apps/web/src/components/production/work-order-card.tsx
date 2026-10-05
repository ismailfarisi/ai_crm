'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Pause, Play, Rocket } from 'lucide-react';
import {
  elapsedMinutes,
  isOnTheFloor,
  PERMISSIONS,
  type WorkOrderDto,
} from '@saas/shared';
import { useWorkOrderAction } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';

export interface WorkOrderCardProps {
  workOrder: WorkOrderDto;
  onSelect: (id: string) => void;
  onActionSuccess?: () => void;
}

const formatMinutes = (n: number) => {
  const r = Math.round(n);
  if (r < 60) return `${r}m`;
  return `${Math.floor(r / 60)}h${r % 60 ? ` ${r % 60}m` : ''}`;
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function WorkOrderCard({ workOrder, onSelect, onActionSuccess }: WorkOrderCardProps) {
  const act = useWorkOrderAction(workOrder.id);
  const canUpdate = useCan({ permission: PERMISSIONS.WORK_ORDER_UPDATE });
  const canExecute = useCan({ permission: PERMISSIONS.WORK_ORDER_EXECUTE });

  const runningOp = workOrder.operations.find((op) => op.status === 'RUNNING');
  const pendingOp = workOrder.operations.find(
    (op) => op.status === 'PENDING' || op.status === 'PAUSED',
  );
  const now = useNow(Boolean(runningOp));

  const liveElapsed = runningOp
    ? runningOp.actualMinutes +
      (runningOp.runningSince ? elapsedMinutes(runningOp.runningSince, new Date(now)) : 0)
    : 0;

  const sortedOps = useMemo(
    () => [...workOrder.operations].sort((a, b) => a.sequence - b.sequence),
    [workOrder.operations],
  );

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const dueBadge = useMemo(() => {
    if (!workOrder.dueDate) return null;
    const due = new Date(workOrder.dueDate);
    const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const isFinished = workOrder.status === 'COMPLETE' || workOrder.status === 'CANCELLED';
    const isOverdue = !isFinished && dueMidnight.getTime() < today.getTime();
    const isToday = !isFinished && dueMidnight.getTime() === today.getTime();

    return {
      text: due.toLocaleDateString(),
      tone: isOverdue ? ('overdue' as const) : isToday ? ('today' as const) : ('standard' as const),
    };
  }, [workOrder.dueDate, workOrder.status, today]);

  // Determine quick action button
  const quickAction = useMemo(() => {
    if (workOrder.status === 'PLANNED' && canUpdate) {
      return {
        label: 'Release',
        icon: <Rocket className="size-3.5" />,
        action: () => act.mutate({ kind: 'release' }, { onSuccess: onActionSuccess }),
      };
    }
    if (runningOp && canExecute) {
      return {
        label: 'Pause',
        icon: <Pause className="size-3.5" />,
        action: () =>
          act.mutate({ kind: 'stop', operationId: runningOp.id }, { onSuccess: onActionSuccess }),
      };
    }
    if (pendingOp && isOnTheFloor(workOrder.status) && canExecute && !runningOp) {
      return {
        label: 'Start',
        icon: <Play className="size-3.5" />,
        action: () =>
          act.mutate({ kind: 'start', operationId: pendingOp.id }, { onSuccess: onActionSuccess }),
      };
    }
    return null;
  }, [workOrder.status, canUpdate, canExecute, runningOp, pendingOp, act, onActionSuccess]);

  const handleQuickAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    quickAction?.action();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={workOrder.status !== 'COMPLETE'}
      onDragStart={(e) => {
        if (workOrder.status === 'COMPLETE') {
          e.preventDefault();
          return;
        }
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', workOrder.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      }}
      onClick={() => onSelect(workOrder.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(workOrder.id);
        }
      }}
      className={`group relative flex flex-col justify-between rounded-xl border bg-surface p-3.5 shadow-2xs transition-all duration-150 hover:border-accent hover:shadow-sm cursor-pointer select-none ${
        runningOp ? 'border-l-4 border-l-success border-line' : 'border-line'
      }`}
    >
      <div>
        {/* Top Header: WO Number & Due Date Badge */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xs font-semibold tracking-tight text-ink">
            {workOrder.woNumber}
          </span>
          {dueBadge && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${
                dueBadge.tone === 'overdue'
                  ? 'text-danger'
                  : dueBadge.tone === 'today'
                    ? 'text-warning'
                    : 'text-ink-subtle'
              }`}
            >
              <CalendarClock className="size-3" />
              {dueBadge.text}
            </span>
          )}
        </div>

        {/* Title / Description */}
        <p className="mt-1 line-clamp-2 text-sm font-medium text-ink leading-snug">
          {workOrder.description}
        </p>

        {/* Qty & Customer */}
        <p className="mt-1 truncate text-xs text-ink-subtle">
          {workOrder.qty} units · {workOrder.customerName ?? 'No customer'}
        </p>

        {/* Operation Mini-Stepper */}
        {sortedOps.length > 0 && (
          <div className="mt-3 flex items-center gap-1 overflow-x-auto py-1 scrollbar-none">
            {sortedOps.map((op, idx) => {
              const isDone = op.status === 'DONE';
              const isRunning = op.status === 'RUNNING';
              const isPaused = op.status === 'PAUSED';

              return (
                <div
                  key={op.id}
                  className="flex items-center gap-1 shrink-0"
                  title={`${op.sequence}. ${op.label} (${op.status.toLowerCase()})`}
                >
                  {idx > 0 && <div className="h-0.5 w-2 bg-line shrink-0" />}
                  <div
                    className={`flex items-center justify-center rounded-full text-[10px] font-semibold transition-all ${
                      isDone
                        ? 'size-5 bg-success text-white'
                        : isRunning
                          ? 'h-5 px-1.5 bg-success/15 border border-success text-success gap-1'
                          : isPaused
                            ? 'size-5 bg-warning/20 border border-warning/50 text-warning'
                            : 'size-5 bg-surface-sunk border border-line text-ink-subtle'
                    }`}
                  >
                    {isDone ? (
                      <Check className="size-3" strokeWidth={3} />
                    ) : isRunning ? (
                      <>
                        <span className="relative flex size-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                          <span className="relative inline-flex rounded-full size-2 bg-success" />
                        </span>
                        <span className="font-mono text-[10px] tabular-nums font-semibold">
                          {formatMinutes(liveElapsed)}
                        </span>
                      </>
                    ) : isPaused ? (
                      <Pause className="size-2.5" />
                    ) : (
                      <span>{op.sequence}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer: Quick Action on Hover */}
      {quickAction && (
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={handleQuickAction}
            disabled={act.isPending}
            aria-label={`${quickAction.label} ${workOrder.woNumber}`}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink shadow-2xs hover:bg-surface-sunk hover:border-accent active:scale-95 transition-all opacity-90 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
          >
            {quickAction.icon}
            <span>{quickAction.label}</span>
          </button>
        </div>
      )}
    </div>
  );
}
