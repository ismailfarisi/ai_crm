'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { PERMISSIONS, type WorkOrderDto, type WorkOrderStatus } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { WorkOrderCard } from './work-order-card';

export interface ProductionKanbanProps {
  workOrders: WorkOrderDto[];
  onSelectWorkOrder: (id: string) => void;
  onActionSuccess?: () => void;
}

interface KanbanColumn {
  status: WorkOrderStatus;
  label: string;
  emptyText: string;
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: 'PLANNED', label: 'Planned', emptyText: 'No planned jobs' },
  { status: 'RELEASED', label: 'Released', emptyText: 'No released jobs' },
  { status: 'IN_PROGRESS', label: 'In progress', emptyText: 'No jobs in progress' },
  { status: 'COMPLETE', label: 'Complete', emptyText: 'No completed jobs' },
];

export function ProductionKanban({
  workOrders,
  onSelectWorkOrder,
  onActionSuccess,
}: ProductionKanbanProps) {
  const queryClient = useQueryClient();
  const canUpdate = useCan({ permission: PERMISSIONS.WORK_ORDER_UPDATE });
  const canExecute = useCan({ permission: PERMISSIONS.WORK_ORDER_EXECUTE });
  const [dragOverCol, setDragOverCol] = useState<WorkOrderStatus | null>(null);

  // Completion confirmation modal state
  const [completingWo, setCompletingWo] = useState<WorkOrderDto | null>(null);
  const [goodQty, setGoodQty] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ]);
  };

  const handleDrop = async (targetStatus: WorkOrderStatus, workOrderId: string) => {
    const wo = workOrders.find((w) => w.id === workOrderId);
    if (!wo) return;
    if (wo.status === targetStatus) return;

    if (targetStatus === 'RELEASED' || targetStatus === 'COMPLETE') {
      if (!canUpdate) {
        toast.error("You don't have permission to update work order status");
        return;
      }
    } else if (targetStatus === 'IN_PROGRESS') {
      if (!canExecute) {
        toast.error("You don't have permission to update work order status");
        return;
      }
    }

    try {
      if (targetStatus === 'RELEASED') {
        if (wo.status === 'PLANNED') {
          const res = await api.workOrders.release(wo.id);
          toast.success(`${res.woNumber} released to the floor`);
          await invalidate();
          onActionSuccess?.();
        } else {
          toast.error(`Cannot move ${wo.woNumber} from ${wo.status} to Released`);
        }
      } else if (targetStatus === 'IN_PROGRESS') {
        let currentWo = wo;
        if (wo.status === 'PLANNED') {
          currentWo = await api.workOrders.release(wo.id);
        }
        const pendingOp = currentWo.operations.find(
          (op) => op.status === 'PENDING' || op.status === 'PAUSED',
        );
        if (pendingOp) {
          await api.workOrders.start(wo.id, pendingOp.id);
          toast.success(`Started ${pendingOp.label} on ${wo.woNumber}`);
          await invalidate();
          onActionSuccess?.();
        } else {
          toast.message(`No pending operations to start on ${wo.woNumber}`);
          await invalidate();
        }
      } else if (targetStatus === 'COMPLETE') {
        if (wo.status === 'PLANNED') {
          toast.error('Release the work order before completing it');
          return;
        }
        if (wo.operations.some((op) => op.status === 'RUNNING')) {
          toast.error('Stop running operations before completing the job');
          return;
        }
        setCompletingWo(wo);
        setGoodQty(String(wo.qty));
      } else if (targetStatus === 'PLANNED') {
        toast.error(`Cannot revert ${wo.woNumber} back to Planned`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast.error(msg);
    }
  };

  const handleConfirmComplete = async () => {
    if (!completingWo) return;
    try {
      setIsSubmitting(true);
      await api.workOrders.complete(completingWo.id, Number(goodQty) || 0);
      toast.success(`${completingWo.woNumber} completed`);
      await invalidate();
      onActionSuccess?.();
      setCompletingWo(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not complete job';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {KANBAN_COLUMNS.map((column) => {
          const jobs = workOrders.filter((wo) => wo.status === column.status);
          const isOver = dragOverCol === column.status;

          return (
            <section
              key={column.status}
              aria-labelledby={`col-${column.status}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDragEnter={() => setDragOverCol(column.status)}
              onDragLeave={(e) => {
                // Only clear if leaving the column element itself
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverCol(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCol(null);
                const workOrderId = e.dataTransfer?.getData('text/plain');
                if (workOrderId) {
                  handleDrop(column.status, workOrderId);
                }
              }}
              className={`flex flex-col rounded-2xl border transition-all duration-150 p-3 min-h-[300px] ${
                isOver
                  ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
                  : 'border-line/70 bg-surface-sunk/30'
              }`}
            >
              {/* Column Header */}
              <div className="mb-3 flex items-center justify-between px-1">
                <h2
                  id={`col-${column.status}`}
                  className="text-xs font-semibold uppercase tracking-wider text-ink"
                >
                  {column.label}
                </h2>
                <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-xs font-semibold text-ink-muted">
                  {jobs.length}
                </span>
              </div>

              {/* Cards List / Drop Area */}
              <div className="flex-1 space-y-2.5">
                {jobs.length === 0 ? (
                  <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-line/60 text-xs text-ink-subtle">
                    {column.emptyText}
                  </div>
                ) : (
                  jobs.map((wo) => (
                    <WorkOrderCard
                      key={wo.id}
                      workOrder={wo}
                      onSelect={onSelectWorkOrder}
                      onActionSuccess={onActionSuccess}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Completion Confirmation Dialog */}
      {completingWo && (
        <Dialog
          open={Boolean(completingWo)}
          onClose={() => setCompletingWo(null)}
          title={`Complete ${completingWo.woNumber}`}
          description="Confirm completed units to finalize this job and record its actual cost."
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCompletingWo(null)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                loading={isSubmitting}
                disabled={!(Number(goodQty) >= 0) || goodQty === ''}
                onClick={handleConfirmComplete}
                className="gap-1.5"
              >
                <CheckCircle2 className="size-4" />
                Confirm Complete
              </Button>
            </>
          }
        >
          <Input
            label="Good pieces produced"
            type="number"
            min={0}
            value={goodQty}
            onChange={(e) => setGoodQty(e.target.value)}
            hint={`Ordered: ${completingWo.qty}. Unfinished operations will be marked skipped.`}
            autoFocus
          />
        </Dialog>
      )}
    </>
  );
}
