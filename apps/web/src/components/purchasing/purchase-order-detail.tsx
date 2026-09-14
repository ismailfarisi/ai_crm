'use client';

import { useState } from 'react';
import { AlertTriangle, PackageCheck, Send, ShieldCheck, Undo2, X } from 'lucide-react';
import { PERMISSIONS, canTransition, type PurchaseOrderStatus } from '@saas/shared';
import {
  usePurchaseOrder,
  usePurchaseOrderAction,
  usePurchaseOrderGuardrails,
} from '@/hooks/use-purchase-orders';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { Textarea } from '@/components/ui/field';
import { StatusPill } from './purchase-orders-view';
import { ReceiveDialog } from '@/components/inventory/receive-dialog';

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);

export function PurchaseOrderDetail({ id }: { id: string }) {
  const { data: order, isPending, isError, error } = usePurchaseOrder(id);
  const { data: violations = [] } = usePurchaseOrderGuardrails(id);
  const act = usePurchaseOrderAction();
  const [cancelling, setCancelling] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [reason, setReason] = useState('');

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !order) {
    return (
      <EmptyState
        title="Couldn't load this order"
        description={error instanceof Error ? error.message : 'Please try again.'}
      />
    );
  }

  const status = order.status as PurchaseOrderStatus;
  const can = (to: PurchaseOrderStatus) => canTransition(status, to);

  return (
    <>
      <PageHeader
        title={order.poNumber}
        description={`${order.supplierName} · ${money(order.totalAmount, order.currency)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />

            {can('AWAITING_APPROVAL') && (
              <Can permission={PERMISSIONS.PURCHASE_ORDER_UPDATE}>
                <Button
                  loading={act.isPending}
                  onClick={() => act.mutate({ id, action: 'submit' })}
                >
                  Send for approval
                </Button>
              </Can>
            )}

            {status === 'AWAITING_APPROVAL' && (
              <>
                <Can permission={PERMISSIONS.PURCHASE_ORDER_APPROVE}>
                  <Button
                    loading={act.isPending}
                    onClick={() => act.mutate({ id, action: 'approve' })}
                  >
                    <ShieldCheck className="size-4" />
                    Approve
                  </Button>
                </Can>
                <Can permission={PERMISSIONS.PURCHASE_ORDER_UPDATE}>
                  <Button
                    variant="secondary"
                    loading={act.isPending}
                    onClick={() => act.mutate({ id, action: 'reopen' })}
                  >
                    <Undo2 className="size-4" />
                    Reopen
                  </Button>
                </Can>
              </>
            )}

            {can('SENT') && (
              <Can permission={PERMISSIONS.PURCHASE_ORDER_UPDATE}>
                <Button loading={act.isPending} onClick={() => act.mutate({ id, action: 'send' })}>
                  <Send className="size-4" />
                  Email to supplier
                </Button>
              </Can>
            )}

            {(status === 'SENT' || status === 'PARTIALLY_RECEIVED') && (
              <Can permission={PERMISSIONS.GOODS_RECEIPT_CREATE}>
                <Button onClick={() => setReceiving(true)}>
                  <PackageCheck className="size-4" />
                  Book in delivery
                </Button>
              </Can>
            )}

            {can('CANCELLED') && (
              <Can permission={PERMISSIONS.PURCHASE_ORDER_DELETE}>
                <Button variant="secondary" onClick={() => setCancelling(true)}>
                  <X className="size-4" />
                  Cancel
                </Button>
              </Can>
            )}
          </div>
        }
      />

      {violations.length > 0 && (
        <div className="mb-6 rounded border border-warning/40 bg-warning-soft/40 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" />
            {violations.length === 1 ? 'One thing to check' : `${violations.length} things to check`}
          </p>
          <ul className="space-y-1 text-sm text-ink-muted">
            {violations.map((violation) => (
              <li key={`${violation.code}-${violation.lineId ?? 'order'}`}>
                {violation.message}
                {violation.overridable && (
                  <span className="text-ink-subtle">
                    {' '}
                    — needs an approver with a higher limit.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunk text-left">
              <th className="px-4 py-2 font-medium text-ink-muted">Description</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Qty</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Unit</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Total</th>
            </tr>
          </thead>
          <tbody>
            {(order.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2 text-ink">{line.description}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {line.qtyOrdered} {line.uom.toLowerCase()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {line.unitCost.toFixed(4)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">
                  {money(line.lineTotal, order.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReceiveDialog open={receiving} order={order} onClose={() => setReceiving(false)} />

      <Dialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        size="sm"
        title={`Cancel ${order.poNumber}`}
        description="The supplier is not notified automatically — tell them separately if it was already sent."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={act.isPending}
              onClick={async () => {
                await act.mutateAsync({ id, action: 'cancel', reason: reason || null });
                setCancelling(false);
                setReason('');
              }}
            >
              Cancel order
            </Button>
          </>
        }
      >
        <Textarea
          id="cancel-reason"
          label="Reason"
          placeholder="Supplier out of stock, ordered in error…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Dialog>
    </>
  );
}
