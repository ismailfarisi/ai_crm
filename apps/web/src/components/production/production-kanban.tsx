'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Edit2,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  PERMISSIONS,
  type ProductionBoardColumn,
  type WorkOrderDto,
} from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { useBoardColumns } from '@/hooks/use-board-columns';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { ColumnModal, COLUMN_COLOR_MAP } from './column-modal';
import { WorkOrderCard } from './work-order-card';

export interface ProductionKanbanProps {
  workOrders: WorkOrderDto[];
  onSelectWorkOrder: (id: string) => void;
  onActionSuccess?: () => void;
  columns?: ProductionBoardColumn[];
}

export function ProductionKanban({
  workOrders,
  onSelectWorkOrder,
  onActionSuccess,
  columns: propColumns,
}: ProductionKanbanProps) {
  const queryClient = useQueryClient();
  const canUpdate = useCan({ permission: PERMISSIONS.WORK_ORDER_UPDATE });
  const canExecute = useCan({ permission: PERMISSIONS.WORK_ORDER_EXECUTE });

  const {
    columns: hookColumns,
    addColumn,
    editColumn,
    deleteColumn,
    moveColumn,
    isUpdating,
  } = useBoardColumns();

  const columns = propColumns || hookColumns;

  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // Column management modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ProductionBoardColumn | null>(null);
  const [openMenuColId, setOpenMenuColId] = useState<string | null>(null);

  // Completion confirmation modal state
  const [completingWo, setCompletingWo] = useState<WorkOrderDto | null>(null);
  const [completingTargetColId, setCompletingTargetColId] = useState<string | null>(null);
  const [goodQty, setGoodQty] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['production-board-columns'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ]);
  };

  const handleDrop = async (targetColumn: ProductionBoardColumn, workOrderId: string) => {
    const wo = workOrders.find((w) => w.id === workOrderId);
    if (!wo) return;
    if (wo.status === 'COMPLETE' || wo.status === 'CANCELLED') return;

    // Check if card is already placed in this target column
    const assigned = wo.parameters?.columnId
      ? columns.find((c) => c.id === wo.parameters?.columnId)
      : null;
    const currentTarget =
      assigned && assigned.status === wo.status
        ? assigned
        : columns.find((c) => c.isDefault && c.status === wo.status) ??
          columns.find((c) => c.status === wo.status);

    if (currentTarget?.id === targetColumn.id) return;

    const targetStatus = targetColumn.status;

    if (targetStatus === 'RELEASED' || targetStatus === 'COMPLETE') {
      if (!canUpdate) {
        toast.error("You don't have permission to update work order status");
        return;
      }
    } else if (targetStatus === 'IN_PROGRESS') {
      if (!canExecute || (wo.status === 'PLANNED' && !canUpdate)) {
        toast.error("You don't have permission to release and start work orders");
        return;
      }
    }

    try {
      if (targetStatus === 'COMPLETE') {
        if (wo.status === 'PLANNED') {
          toast.error('Release the work order before completing it');
          return;
        }
        if (wo.operations.some((op) => op.status === 'RUNNING')) {
          toast.error('Stop running operations before completing the job');
          return;
        }
        setCompletingWo(wo);
        setCompletingTargetColId(targetColumn.id);
        setGoodQty(String(wo.qty));
        return;
      }

      if (targetStatus === 'PLANNED' && wo.status !== 'PLANNED') {
        toast.error(`Cannot revert ${wo.woNumber} back to Planned`);
        return;
      }

      // If moving from PLANNED to RELEASED
      if (targetStatus === 'RELEASED') {
        if (wo.status === 'PLANNED') {
          const res = await api.workOrders.release(wo.id);
          toast.success(`${res.woNumber} released to the floor`);
        }
      } else if (targetStatus === 'IN_PROGRESS') {
        if (wo.status !== 'IN_PROGRESS') {
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
          }
        }
      }

      // Update the column assignment on the work order
      await api.workOrders.updateColumn(wo.id, targetColumn.id);

      toast.success(`Moved ${wo.woNumber} to ${targetColumn.name}`);
      await invalidate();
      onActionSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast.error(msg);
    }
  };

  const handleConfirmComplete = async () => {
    if (!completingWo) return;
    try {
      setIsSubmitting(true);
      await api.workOrders.complete(
        completingWo.id,
        Number(goodQty) || 0,
        completingTargetColId ?? undefined,
      );

      toast.success(`${completingWo.woNumber} completed`);
      await invalidate();
      onActionSuccess?.();
      setCompletingWo(null);
      setCompletingTargetColId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not complete job';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Top Header with + Add Column button */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Board Layout
          </span>
          <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-xs font-medium text-ink-subtle">
            {columns.length} stages
          </span>
        </div>
        {canUpdate && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingColumn(null);
              setIsModalOpen(true);
            }}
            className="gap-1.5 font-medium"
          >
            <Plus className="size-3.5" />
            + Add Column
          </Button>
        )}
      </div>

      {/* Dynamic Columns Grid */}
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
        {columns.map((column, colIdx) => {
          // Card placement: check wo.parameters?.columnId first, fallback to default for status
          const jobs = workOrders.filter((wo) => {
            if (wo.status === 'CANCELLED' && column.status !== 'CANCELLED') return false;
            const paramColId = typeof wo.parameters?.columnId === 'string' ? wo.parameters.columnId : null;
            const assigned = paramColId
              ? columns.find((c) => c.id === paramColId)
              : null;
            const target =
              assigned && assigned.status === wo.status
                ? assigned
                : columns.find((c) => c.isDefault && c.status === wo.status) ??
                  columns.find((c) => c.status === wo.status);
            return target?.id === column.id;
          });

          const isOver = dragOverColId === column.id;
          const colorMeta = COLUMN_COLOR_MAP[column.color] || COLUMN_COLOR_MAP.slate;

          return (
            <section
              key={column.id}
              aria-label={column.name}
              aria-labelledby={`col-${column.id}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDragEnter={() => setDragOverColId(column.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverColId(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverColId(null);
                const workOrderId = e.dataTransfer?.getData('text/plain');
                if (workOrderId) {
                  handleDrop(column, workOrderId);
                }
              }}
              className={`flex flex-col rounded-2xl border transition-all duration-150 p-3 min-h-[350px] min-w-[280px] flex-1 ${
                isOver
                  ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
                  : 'border-line/70 bg-surface-sunk/30'
              }`}
            >
              {/* Column Header */}
              <div className="relative mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`size-2.5 rounded-full shrink-0 ${colorMeta.dot}`} />
                  <h2
                    id={`col-${column.id}`}
                    className="text-xs font-semibold uppercase tracking-wider text-ink truncate"
                    title={column.name}
                  >
                    {column.name}
                  </h2>
                  <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-xs font-semibold text-ink-muted shrink-0">
                    {jobs.length}
                  </span>
                </div>

                {/* Kebab Action Menu */}
                {canUpdate && (
                  <div className="relative">
                    <button
                      type="button"
                      aria-label={`Column options for ${column.name}`}
                      onClick={() =>
                        setOpenMenuColId(openMenuColId === column.id ? null : column.id)
                      }
                      className="rounded p-1 text-ink-subtle hover:bg-surface-sunk hover:text-ink transition-colors cursor-pointer"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>

                    {openMenuColId === column.id && (
                      <>
                        <div
                          className="fixed inset-0 z-20 cursor-default"
                          onClick={() => setOpenMenuColId(null)}
                        />
                        <div
                          role="menu"
                          className="absolute right-0 top-7 z-30 w-44 rounded-xl border border-line bg-surface p-1 shadow-lg backdrop-blur-xs"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuColId(null);
                              setEditingColumn(column);
                              setIsModalOpen(true);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-ink hover:bg-surface-sunk cursor-pointer"
                          >
                            <Edit2 className="size-3.5 text-ink-muted" />
                            Edit Column
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={colIdx === 0}
                            onClick={async () => {
                              setOpenMenuColId(null);
                              try {
                                await moveColumn(column.id, 'left');
                              } catch (err: unknown) {
                                toast.error(err instanceof Error ? err.message : 'Failed to move column');
                              }
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-ink hover:bg-surface-sunk disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ArrowLeft className="size-3.5 text-ink-muted" />
                            Move Left
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={colIdx === columns.length - 1}
                            onClick={async () => {
                              setOpenMenuColId(null);
                              try {
                                await moveColumn(column.id, 'right');
                              } catch (err: unknown) {
                                toast.error(err instanceof Error ? err.message : 'Failed to move column');
                              }
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-ink hover:bg-surface-sunk disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ArrowRight className="size-3.5 text-ink-muted" />
                            Move Right
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={Boolean(column.isDefault)}
                            onClick={async () => {
                              setOpenMenuColId(null);
                              try {
                                await deleteColumn(column.id);
                              } catch (err: unknown) {
                                toast.error(err instanceof Error ? err.message : 'Failed to delete column');
                              }
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <Trash2 className="size-3.5 text-danger" />
                            Delete Column
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Cards List / Drop Area */}
              <div className="flex-1 space-y-2.5">
                {jobs.length === 0 ? (
                  <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-line/60 text-xs text-ink-subtle">
                    No jobs in {column.name.toLowerCase()}
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

      {/* Column Add / Edit Modal */}
      <ColumnModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingColumn(null);
        }}
        column={editingColumn}
        onSave={async (data) => {
          if (editingColumn) {
            await editColumn(editingColumn.id, data);
            toast.success(`Column "${data.name}" updated`);
          } else {
            await addColumn(data);
            toast.success(`Column "${data.name}" added`);
          }
        }}
        isSaving={isUpdating}
      />

      {/* Completion Confirmation Dialog */}
      {completingWo && (
        <Dialog
          open={Boolean(completingWo)}
          onClose={() => {
            setCompletingWo(null);
            setCompletingTargetColId(null);
          }}
          title={`Complete ${completingWo.woNumber}`}
          description="Confirm completed units to finalize this job and record its actual cost."
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCompletingWo(null);
                  setCompletingTargetColId(null);
                }}
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
