'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, Clock, Pause, Play, Plus, Rocket, Undo2, PackageMinus } from 'lucide-react';
import {
  canTransitionWorkOrder,
  elapsedMinutes,
  isOnTheFloor,
  PERMISSIONS,
  type CostSplit,
  type WorkOrderMaterialDto,
  type WorkOrderOperationDto,
} from '@saas/shared';
import { useWorkOrder, useWorkOrderAction } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/primitives';
import { WO_STATUS_LABELS } from './production-board';

const fmtMinutes = (n: number) => {
  const r = Math.round(n);
  if (r < 60) return `${r} min`;
  return `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, '0')}m`;
};
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Re-renders once a second while any clock is running, so the time on screen moves. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

type MaterialDialog = { material: WorkOrderMaterialDto; mode: 'issue' | 'return' } | null;

/**
 * The job, as the shop floor uses it.
 *
 * Built for a tablet on a bench: every control is at least 56px tall, state is
 * carried by text and colour together, and nothing depends on hover.
 */
export function WorkOrderFloor({ id }: { id: string }) {
  const { data: wo, isPending, isError, error } = useWorkOrder(id);
  const act = useWorkOrderAction(id);
  const canExecute = useCan({ permission: PERMISSIONS.WORK_ORDER_EXECUTE });
  const canUpdate = useCan({ permission: PERMISSIONS.WORK_ORDER_UPDATE });

  const [logging, setLogging] = useState<WorkOrderOperationDto | null>(null);
  const [logMinutes, setLogMinutes] = useState('');
  const [materialDialog, setMaterialDialog] = useState<MaterialDialog>(null);
  const [materialQty, setMaterialQty] = useState('');
  const [completing, setCompleting] = useState(false);
  const [goodQty, setGoodQty] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const running = wo?.operations.some((op) => op.status === 'RUNNING') ?? false;
  const now = useNow(running);

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !wo) {
    return <EmptyState title="Couldn't load this job" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }

  const onFloor = isOnTheFloor(wo.status);
  const busy = act.isPending;
  const liveMinutes = (op: WorkOrderOperationDto) =>
    op.actualMinutes + (op.status === 'RUNNING' && op.runningSince ? elapsedMinutes(op.runningSince, new Date(now)) : 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm text-ink-subtle">
            <Link href="/production" className="hover:underline">
              Production
            </Link>{' '}
            / {wo.woNumber}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{wo.description}</h1>
          <p className="mt-1 text-base text-ink-muted">
            {wo.qty} to make
            {wo.customerName ? ` · ${wo.customerName}` : ''}
            {wo.salesOrderNumber && (
              <>
                {' · '}
                <Link href={`/orders/${wo.salesOrderId}`} className="text-accent hover:underline">
                  {wo.salesOrderNumber}
                </Link>
              </>
            )}
            {wo.dueDate ? ` · due ${new Date(wo.dueDate).toLocaleDateString()}` : ''}
          </p>
          {wo.templateName && (
            <p className="text-sm text-ink-subtle">
              Routing from {wo.templateName} v{wo.templateVersion}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-surface-sunk px-3 py-1.5 text-sm font-medium text-ink">{WO_STATUS_LABELS[wo.status]}</span>
          {canUpdate && wo.status === 'PLANNED' && (
            <Button size="lg" className="min-h-14" loading={busy} onClick={() => act.mutate({ kind: 'release' })}>
              <Rocket className="size-5" />
              Release to floor
            </Button>
          )}
          {canUpdate && canTransitionWorkOrder(wo.status, 'COMPLETE') && (
            <Button
              size="lg"
              className="min-h-14"
              disabled={busy || running}
              title={running ? 'Stop the running operation first' : undefined}
              onClick={() => {
                setGoodQty(String(wo.qty));
                setCompleting(true);
              }}
            >
              <CheckCircle2 className="size-5" />
              Complete job
            </Button>
          )}
          {canUpdate && canTransitionWorkOrder(wo.status, 'CANCELLED') && (
            <Button size="lg" variant="secondary" className="min-h-14" disabled={busy} onClick={() => setCancelling(true)}>
              <Ban className="size-5" />
              Cancel
            </Button>
          )}
        </div>
      </header>

      {wo.estimatedCost && <CostSummary wo={wo} />}

      <section aria-labelledby="ops-heading">
        <h2 id="ops-heading" className="mb-3 text-lg font-semibold text-ink">
          Operations
        </h2>
        <ol className="space-y-3">
          {wo.operations.map((op) => {
            const estimate = op.estimatedSetupMinutes + op.estimatedRunMinutes;
            const actual = liveMinutes(op);
            const over = estimate > 0 && actual > estimate;
            const finished = op.status === 'DONE' || op.status === 'SKIPPED';
            return (
              <li
                key={op.id}
                className={`rounded-lg border-2 p-4 ${
                  op.status === 'RUNNING' ? 'border-success bg-success-soft/30' : 'border-line bg-surface'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-ink">
                      {op.sequence}. {op.label}
                    </p>
                    <p className="text-base text-ink-muted">{op.workCenterName}</p>
                    <p className="mt-1 text-sm font-medium uppercase tracking-wide text-ink-subtle">
                      {{ PENDING: 'Not started', RUNNING: 'Running', PAUSED: 'Paused', DONE: 'Done', SKIPPED: 'Skipped' }[op.status]}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-3xl tabular-nums ${over ? 'text-warning' : 'text-ink'}`}>
                      {fmtMinutes(actual)}
                    </p>
                    <p className="text-sm text-ink-subtle">
                      of {fmtMinutes(estimate)} estimated
                      {op.estimatedSetupMinutes > 0 ? ` (incl. ${fmtMinutes(op.estimatedSetupMinutes)} setup)` : ''}
                    </p>
                  </div>
                </div>

                {canExecute && onFloor && !finished && (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {op.status === 'RUNNING' ? (
                      <Button
                        size="lg"
                        variant="secondary"
                        className="min-h-14 text-base"
                        disabled={busy}
                        onClick={() => act.mutate({ kind: 'stop', operationId: op.id })}
                      >
                        <Pause className="size-5" />
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className="min-h-14 text-base"
                        disabled={busy}
                        onClick={() => act.mutate({ kind: 'start', operationId: op.id })}
                      >
                        <Play className="size-5" />
                        {op.status === 'PAUSED' ? 'Resume' : 'Start'}
                      </Button>
                    )}
                    <Button
                      size="lg"
                      variant="secondary"
                      className="min-h-14 text-base"
                      disabled={busy}
                      onClick={() => act.mutate({ kind: 'finish', operationId: op.id })}
                    >
                      <CheckCircle2 className="size-5" />
                      Done
                    </Button>
                    <Button
                      size="lg"
                      variant="secondary"
                      className="col-span-2 min-h-14 text-base sm:col-span-1"
                      disabled={busy}
                      onClick={() => {
                        setLogMinutes('');
                        setLogging(op);
                      }}
                    >
                      <Clock className="size-5" />
                      Log time
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {wo.materials.length > 0 && (
        <section aria-labelledby="mat-heading">
          <h2 id="mat-heading" className="mb-3 text-lg font-semibold text-ink">
            Material
          </h2>
          <ul className="space-y-3">
            {wo.materials.map((m) => {
              const onJob = Math.round((m.qtyIssued - m.qtyReturned) * 10000) / 10000;
              const toIssue = Math.max(0, Math.round((m.qtyPlanned - onJob) * 10000) / 10000);
              return (
                <li key={m.id} className="rounded-lg border-2 border-line bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-lg font-semibold text-ink">{m.materialName}</p>
                    <p className="text-base text-ink-muted">
                      <span className="font-mono tabular-nums text-ink">{onJob}</span> of {m.qtyPlanned}{' '}
                      {m.uom.toLowerCase()} on the job
                    </p>
                  </div>
                  {canExecute && onFloor && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        size="lg"
                        className="min-h-14 text-base"
                        disabled={busy}
                        onClick={() => {
                          setMaterialQty(String(toIssue || ''));
                          setMaterialDialog({ material: m, mode: 'issue' });
                        }}
                      >
                        <PackageMinus className="size-5" />
                        Issue
                      </Button>
                      <Button
                        size="lg"
                        variant="secondary"
                        className="min-h-14 text-base"
                        disabled={busy || onJob <= 0}
                        onClick={() => {
                          setMaterialQty('');
                          setMaterialDialog({ material: m, mode: 'return' });
                        }}
                      >
                        <Undo2 className="size-5" />
                        Return
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Dialog
        open={logging !== null}
        onClose={() => setLogging(null)}
        title={`Log time — ${logging?.label ?? ''}`}
        description="Time worked without the timer running."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setLogging(null)}>
              Cancel
            </Button>
            <Button
              size="lg"
              loading={busy}
              disabled={!(Number(logMinutes) > 0)}
              onClick={() =>
                logging &&
                act.mutate(
                  { kind: 'logTime', operationId: logging.id, minutes: Number(logMinutes) },
                  { onSuccess: () => setLogging(null) },
                )
              }
            >
              <Plus className="size-5" />
              Add {Number(logMinutes) > 0 ? fmtMinutes(Number(logMinutes)) : 'time'}
            </Button>
          </>
        }
      >
        <Input
          label="Minutes"
          type="number"
          inputMode="decimal"
          min={1}
          value={logMinutes}
          onChange={(e) => setLogMinutes(e.target.value)}
          className="text-2xl"
          autoFocus
        />
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[15, 30, 45, 60].map((n) => (
            <Button key={n} variant="secondary" size="lg" className="min-h-12" onClick={() => setLogMinutes(String(n))}>
              {n}
            </Button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={materialDialog !== null}
        onClose={() => setMaterialDialog(null)}
        title={`${materialDialog?.mode === 'return' ? 'Return' : 'Issue'} ${materialDialog?.material.materialName ?? ''}`}
        description={
          materialDialog?.mode === 'return'
            ? 'Unused material going back on the shelf.'
            : 'Taking material off the shelf for this job.'
        }
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setMaterialDialog(null)}>
              Cancel
            </Button>
            <Button
              size="lg"
              loading={busy}
              disabled={!(Number(materialQty) > 0)}
              onClick={() =>
                materialDialog &&
                act.mutate(
                  {
                    kind: 'issue',
                    workOrderMaterialId: materialDialog.material.id,
                    qty: materialDialog.mode === 'return' ? -Number(materialQty) : Number(materialQty),
                  },
                  { onSuccess: () => setMaterialDialog(null) },
                )
              }
            >
              {materialDialog?.mode === 'return' ? 'Return' : 'Issue'} {materialQty || ''}{' '}
              {materialDialog?.material.uom.toLowerCase()}
            </Button>
          </>
        }
      >
        <Input
          label={`Quantity (${materialDialog?.material.uom.toLowerCase() ?? ''})`}
          type="number"
          inputMode="decimal"
          min={0}
          value={materialQty}
          onChange={(e) => setMaterialQty(e.target.value)}
          className="text-2xl"
          autoFocus
        />
      </Dialog>

      <Dialog
        open={completing}
        onClose={() => setCompleting(false)}
        title={`Complete ${wo.woNumber}`}
        description="Operations never started are marked skipped. Material on the job moves to cost of sales."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setCompleting(false)}>
              Not yet
            </Button>
            <Button
              size="lg"
              loading={busy}
              disabled={!(Number(goodQty) >= 0) || goodQty === ''}
              onClick={() =>
                act.mutate({ kind: 'complete', qtyCompleted: Number(goodQty) }, { onSuccess: () => setCompleting(false) })
              }
            >
              <CheckCircle2 className="size-5" />
              Complete
            </Button>
          </>
        }
      >
        <Input
          label="Good pieces made"
          type="number"
          inputMode="numeric"
          min={0}
          value={goodQty}
          onChange={(e) => setGoodQty(e.target.value)}
          hint={`Ordered ${wo.qty}. Scrap shows up as a dearer unit cost.`}
          className="text-2xl"
        />
      </Dialog>

      <Dialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${wo.woNumber}?`}
        description="Return any material on the job to stock first."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Keep job
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                act.mutate({ kind: 'cancel', reason: reason.trim() || null }, { onSuccess: () => setCancelling(false) })
              }
            >
              Cancel job
            </Button>
          </>
        }
      >
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </div>
  );
}

function CostSummary({ wo }: { wo: NonNullable<ReturnType<typeof useWorkOrder>['data']> }) {
  const rows: [string, keyof CostSplit][] = [
    ['Material', 'material'],
    ['Machine', 'machine'],
    ['Labour', 'labor'],
    ['Tooling', 'tooling'],
    ['Overhead', 'overhead'],
    ['Total', 'total'],
  ];
  const est = wo.estimatedCost!;
  const act = wo.actualCost;
  const unitDelta = act && est.unit > 0 ? (act.unit - est.unit) / est.unit : null;

  return (
    <section className="overflow-x-auto rounded-lg border border-line bg-surface" aria-labelledby="cost-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="cost-heading" className="text-sm font-medium text-ink">
          Cost
        </h2>
        <p className="text-sm text-ink-muted">
          {wo.quotedUnitCost != null && <>Quoted {money(wo.quotedUnitCost)} · </>}
          Estimated {money(est.unit)} / unit
          {act && (
            <>
              {' · '}
              <span className={unitDelta != null && unitDelta > 0.05 ? 'font-medium text-danger' : 'font-medium text-ink'}>
                Actual {money(act.unit)}
                {unitDelta != null && ` (${unitDelta > 0 ? '+' : ''}${(unitDelta * 100).toFixed(1)}%)`}
              </span>
            </>
          )}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-subtle">
          <tr>
            <th className="px-4 py-2 font-medium" />
            <th className="px-4 py-2 text-right font-medium">Estimated</th>
            <th className="px-4 py-2 text-right font-medium">Actual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([label, key]) => (
            <tr key={key} className={key === 'total' ? 'font-medium' : ''}>
              <td className="px-4 py-2 text-ink">{label}</td>
              <td className="px-4 py-2 text-right tabular-nums">{money(est[key])}</td>
              <td className="px-4 py-2 text-right tabular-nums">{act ? money(act[key]) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!act && (
        <p className="border-t border-line px-4 py-2 text-xs text-ink-subtle">
          Actual cost is worked out when the job is completed.
        </p>
      )}
    </section>
  );
}
