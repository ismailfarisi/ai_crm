'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Package,
  Pause,
  Play,
  Plus,
  Rocket,
  X,
} from 'lucide-react';
import {
  canTransitionWorkOrder,
  elapsedMinutes,
  isOnTheFloor,
  PERMISSIONS,
  type WorkOrderDto,
  type WorkOrderOperationDto,
} from '@saas/shared';
import { useWorkOrder, useWorkOrderAction } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/primitives';
import { WO_STATUS_LABELS } from './production-board';

export interface WorkOrderDrawerProps {
  workOrderId: string | null;
  onClose: () => void;
}

const fmtMinutes = (n: number) => {
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

export function WorkOrderDrawer({ workOrderId, onClose }: WorkOrderDrawerProps) {
  const { data: wo, isPending, isError, error } = useWorkOrder(workOrderId);
  const act = useWorkOrderAction(workOrderId ?? '');
  const canExecute = useCan({ permission: PERMISSIONS.WORK_ORDER_EXECUTE });
  const canUpdate = useCan({ permission: PERMISSIONS.WORK_ORDER_UPDATE });

  // Quick log time state
  const [loggingOp, setLoggingOp] = useState<WorkOrderOperationDto | null>(null);
  const [logMinutes, setLogMinutes] = useState('');

  // Complete job dialog state
  const [completing, setCompleting] = useState(false);
  const [goodQty, setGoodQty] = useState('');

  // Close on Escape key
  useEffect(() => {
    if (!workOrderId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workOrderId, onClose]);

  const running = wo?.operations.some((op) => op.status === 'RUNNING') ?? false;
  const now = useNow(running);

  if (!workOrderId) return null;

  const onFloor = wo ? isOnTheFloor(wo.status) : false;
  const busy = act.isPending;

  const liveMinutes = (op: WorkOrderOperationDto) =>
    op.actualMinutes +
    (op.status === 'RUNNING' && op.runningSince
      ? elapsedMinutes(op.runningSince, new Date(now))
      : 0);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer slide-over container */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
          className="flex w-screen max-w-lg md:max-w-xl flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-200"
        >
          {/* Header */}
          <div className="border-b border-line px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-ink">
                  {wo?.woNumber ?? 'Loading...'}
                </span>
                {wo && (
                  <span className="rounded bg-surface-sunk px-2 py-0.5 text-xs font-medium text-ink">
                    {WO_STATUS_LABELS[wo.status]}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="rounded-full p-1.5 text-ink-subtle hover:bg-surface-sunk hover:text-ink transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            {wo && (
              <div className="mt-3">
                <h2 id="drawer-title" className="text-lg font-semibold text-ink leading-snug">
                  {wo.description}
                </h2>
                <p className="mt-1 text-xs text-ink-muted">
                  {wo.qty} units to make
                  {wo.customerName ? ` · ${wo.customerName}` : ''}
                  {wo.dueDate ? ` · Due ${new Date(wo.dueDate).toLocaleDateString()}` : ''}
                </p>

                {/* Quick lifecycle controls */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canUpdate && wo.status === 'PLANNED' && (
                    <Button
                      size="sm"
                      loading={busy}
                      onClick={() => act.mutate({ kind: 'release' })}
                      className="gap-1.5"
                    >
                      <Rocket className="size-3.5" />
                      Release to floor
                    </Button>
                  )}
                  {canUpdate && canTransitionWorkOrder(wo.status, 'COMPLETE') && (
                    <Button
                      size="sm"
                      disabled={busy || running}
                      title={running ? 'Stop running operations before completing' : undefined}
                      onClick={() => {
                        setGoodQty(String(wo.qty));
                        setCompleting(true);
                      }}
                      className="gap-1.5"
                    >
                      <CheckCircle2 className="size-3.5" />
                      Complete job
                    </Button>
                  )}
                  <Link
                    href={`/production/${wo.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline ml-auto"
                  >
                    Open Bench Mode &rarr;
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Drawer content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {isPending ? (
              <div className="flex items-center justify-center py-16 text-sm text-ink-muted">
                Loading work order details...
              </div>
            ) : isError || !wo ? (
              <EmptyState
                title="Couldn't load work order"
                description={error instanceof Error ? error.message : 'Please try again.'}
              />
            ) : (
              <>
                {/* Operations Tracker */}
                <section aria-labelledby="drawer-ops-title">
                  <div className="flex items-center justify-between mb-3">
                    <h3 id="drawer-ops-title" className="text-sm font-semibold text-ink">
                      Operations ({wo.operations.length})
                    </h3>
                  </div>

                  <div className="space-y-3">
                    {wo.operations.map((op) => {
                      const estimate = op.estimatedSetupMinutes + op.estimatedRunMinutes;
                      const actual = liveMinutes(op);
                      const isRunning = op.status === 'RUNNING';
                      const isFinished = op.status === 'DONE' || op.status === 'SKIPPED';
                      const isOver = estimate > 0 && actual > estimate;

                      return (
                        <div
                          key={op.id}
                          className={`rounded-lg border p-3.5 transition-all ${
                            isRunning
                              ? 'border-success bg-success-soft/20'
                              : 'border-line bg-surface'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink">
                                {op.sequence}. {op.label}
                              </p>
                              <p className="text-xs text-ink-muted">{op.workCenterName}</p>
                              <div className="mt-1 flex items-center gap-2">
                                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                                  {{
                                    PENDING: 'Not started',
                                    RUNNING: 'Running',
                                    PAUSED: 'Paused',
                                    DONE: 'Done',
                                    SKIPPED: 'Skipped',
                                  }[op.status]}
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p
                                className={`font-mono text-base font-bold tabular-nums ${
                                  isOver ? 'text-warning' : isRunning ? 'text-success' : 'text-ink'
                                }`}
                              >
                                {fmtMinutes(actual)}
                              </p>
                              <p className="text-xs text-ink-subtle">of {fmtMinutes(estimate)}</p>
                            </div>
                          </div>

                          {/* Action buttons on floor */}
                          {canExecute && onFloor && !isFinished && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2.5">
                              {isRunning ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => act.mutate({ kind: 'stop', operationId: op.id })}
                                  className="gap-1.5"
                                >
                                  <Pause className="size-3.5" />
                                  Pause
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => act.mutate({ kind: 'start', operationId: op.id })}
                                  className="gap-1.5"
                                >
                                  <Play className="size-3.5" />
                                  {op.status === 'PAUSED' ? 'Resume' : 'Start'}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => act.mutate({ kind: 'finish', operationId: op.id })}
                                className="gap-1.5"
                              >
                                <CheckCircle2 className="size-3.5" />
                                Finish
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  setLogMinutes('');
                                  setLoggingOp(op);
                                }}
                                className="gap-1.5"
                              >
                                <Clock className="size-3.5" />
                                Log time
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Materials Preview */}
                <section aria-labelledby="drawer-mat-title">
                  <h3 id="drawer-mat-title" className="text-sm font-semibold text-ink mb-3">
                    Materials ({wo.materials.length})
                  </h3>

                  {wo.materials.length === 0 ? (
                    <p className="text-xs text-ink-muted">No materials assigned to this job.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {wo.materials.map((m) => {
                        const netIssued = Math.round((m.qtyIssued - m.qtyReturned) * 100) / 100;
                        const pct =
                          m.qtyPlanned > 0
                            ? Math.min(100, Math.round((netIssued / m.qtyPlanned) * 100))
                            : 0;

                        return (
                          <div
                            key={m.id}
                            className="rounded-lg border border-line bg-surface p-3 text-xs"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="font-medium text-ink">{m.materialName}</p>
                              <span className="font-mono text-ink-subtle">
                                {netIssued} / {m.qtyPlanned} {m.uom.toLowerCase()}
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-surface-sunk overflow-hidden">
                              <div
                                className="h-full rounded-full bg-accent transition-all duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          {/* Footer */}
          {wo && (
            <div className="border-t border-line bg-surface px-6 py-3.5 flex items-center justify-between">
              <span className="text-xs text-ink-subtle">
                Ordered: {wo.qty} · Finished: {wo.qtyCompleted ?? 0}
              </span>
              <Link
                href={`/production/${wo.id}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
              >
                Open Bench Mode &rarr;
              </Link>
            </div>
          )}
        </aside>
      </div>

      {/* Log Time Dialog */}
      <Dialog
        open={loggingOp !== null}
        onClose={() => setLoggingOp(null)}
        title={`Log time — ${loggingOp?.label ?? ''}`}
        description="Record retrospective minutes worked on this operation."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setLoggingOp(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              disabled={!(Number(logMinutes) > 0)}
              onClick={() => {
                if (loggingOp) {
                  act.mutate(
                    {
                      kind: 'logTime',
                      operationId: loggingOp.id,
                      minutes: Number(logMinutes),
                    },
                    { onSuccess: () => setLoggingOp(null) },
                  );
                }
              }}
            >
              <Plus className="size-4" />
              Save {Number(logMinutes) > 0 ? `${logMinutes}m` : 'time'}
            </Button>
          </>
        }
      >
        <Input
          label="Minutes"
          type="number"
          min={1}
          value={logMinutes}
          onChange={(e) => setLogMinutes(e.target.value)}
          placeholder="e.g. 30"
          autoFocus
        />
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[15, 30, 45, 60].map((n) => (
            <Button
              key={n}
              variant="outline"
              size="sm"
              onClick={() => setLogMinutes(String(n))}
            >
              +{n}m
            </Button>
          ))}
        </div>
      </Dialog>

      {/* Complete Job Confirmation Dialog */}
      {wo && (
        <Dialog
          open={completing}
          onClose={() => setCompleting(false)}
          title={`Complete ${wo.woNumber}`}
          description="Finalize this work order and post its actual cost."
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setCompleting(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                loading={busy}
                disabled={!(Number(goodQty) >= 0) || goodQty === ''}
                onClick={() =>
                  act.mutate(
                    { kind: 'complete', qtyCompleted: Number(goodQty) },
                    {
                      onSuccess: () => {
                        setCompleting(false);
                        onClose();
                      },
                    },
                  )
                }
              >
                <CheckCircle2 className="size-4" />
                Complete
              </Button>
            </>
          }
        >
          <Input
            label="Good pieces completed"
            type="number"
            min={0}
            value={goodQty}
            onChange={(e) => setGoodQty(e.target.value)}
            hint={`Ordered: ${wo.qty}. Unfinished operations will be marked skipped.`}
            autoFocus
          />
        </Dialog>
      )}
    </div>
  );
}
