'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, Factory, FileText, Lock, ReceiptText, Wrench } from 'lucide-react';
import { PERMISSIONS, type SalesOrderStatus } from '@saas/shared';
import { useInvoiceStage, useSalesOrder, useSalesOrderAction } from '@/hooks/use-sales-orders';
import { usePlanWorkOrders, useWorkOrders } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/field';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { money, OrderStatusPill } from './orders-view';

const NEXT: Partial<Record<SalesOrderStatus, { to: SalesOrderStatus; label: string; icon: typeof Factory }[]>> = {
  OPEN: [
    { to: 'IN_PRODUCTION', label: 'Start production', icon: Factory },
    { to: 'FULFILLED', label: 'Mark fulfilled', icon: CheckCircle2 },
  ],
  IN_PRODUCTION: [{ to: 'FULFILLED', label: 'Mark fulfilled', icon: CheckCircle2 }],
  FULFILLED: [{ to: 'CLOSED', label: 'Close order', icon: Lock }],
};

const INVOICE_STATUS: Record<string, string> = {
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  CANCELLED: 'Voided',
};

export function OrderDetail({ id }: { id: string }) {
  const { data: order, isPending, isError, error } = useSalesOrder(id);
  const invoiceStage = useInvoiceStage();
  const act = useSalesOrderAction();
  const plan = usePlanWorkOrders();
  const canReadWork = useCan({ permission: PERMISSIONS.WORK_ORDER_READ });
  const { data: workOrders = [] } = useWorkOrders({ salesOrderId: id }, { enabled: canReadWork });
  const [cancelling, setCancelling] = useState(false);
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

  const nextStage = order.billingSchedule.find((s) => !s.invoiceId);
  const hasLiveInvoice = order.billingSchedule.some(
    (s) => s.invoiceId && s.invoiceStatus !== 'CANCELLED',
  );
  const outstanding = Math.round((order.invoicedAmount - order.paidAmount) * 100) / 100;

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        description={`${order.customerName} · ${money(order.totalAmount)} ${order.currency}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusPill status={order.status} />
            <Can permission={PERMISSIONS.SALES_ORDER_UPDATE}>
              {(NEXT[order.status] ?? []).map(({ to, label, icon: Icon }) => (
                <Button
                  key={to}
                  variant={to === 'CLOSED' ? 'secondary' : 'primary'}
                  loading={act.isPending && act.variables?.status === to}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ id, status: to })}
                >
                  <Icon className="size-4" />
                  {label}
                </Button>
              ))}
            </Can>
            {order.status !== 'CANCELLED' && order.status !== 'CLOSED' && (
              <Can permission={PERMISSIONS.WORK_ORDER_CREATE}>
                <Button
                  variant="secondary"
                  loading={plan.isPending}
                  onClick={() => plan.mutate({ salesOrderId: id })}
                >
                  <Wrench className="size-4" />
                  Plan production
                </Button>
              </Can>
            )}
            {order.status !== 'CANCELLED' && order.status !== 'CLOSED' && !hasLiveInvoice && (
              <Can permission={PERMISSIONS.SALES_ORDER_CANCEL}>
                <Button variant="secondary" onClick={() => setCancelling(true)}>
                  <Ban className="size-4" />
                  Cancel
                </Button>
              </Can>
            )}
          </div>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Order value', money(order.totalAmount)],
          ['Invoiced', money(order.invoicedAmount)],
          ['Paid', money(order.paidAmount)],
          ['Owed now', money(outstanding)],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-line bg-surface px-3 py-2">
            <dt className="text-xs text-ink-subtle">{label}</dt>
            <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        {order.quoteNumber && (
          <Link href={`/quotes/${order.quoteId}`} className="inline-flex items-center gap-1 text-accent hover:underline">
            <FileText className="size-3.5" />
            {order.quoteNumber}
          </Link>
        )}
        {order.acceptedAt ? (
          <span>
            Accepted by {order.acceptedByName} on {new Date(order.acceptedAt).toLocaleDateString()}
          </span>
        ) : (
          <span>Not accepted online by the customer</span>
        )}
      </div>

      <section className="mb-6 rounded border border-line bg-surface" aria-labelledby="billing-heading">
        <h2 id="billing-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
          Billing
        </h2>
        <ol className="divide-y divide-line">
          {order.billingSchedule.map((stage) => {
            const isNext = nextStage?.id === stage.id;
            return (
              <li key={stage.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {stage.label}{' '}
                    <span className="text-ink-subtle">· {stage.percent}%</span>
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {stage.invoiceId
                      ? `${stage.invoiceNumber} · ${INVOICE_STATUS[stage.invoiceStatus ?? ''] ?? ''} · ${
                          stage.invoicedAt ? new Date(stage.invoicedAt).toLocaleDateString() : ''
                        }`
                      : stage.trigger === 'ON_APPROVAL'
                        ? 'Invoiced on approval'
                        : 'Invoice when this stage is reached'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums text-ink">
                    {money(stage.totalAmount)}
                  </span>
                  {stage.invoiceId ? (
                    <Link
                      href="/invoices"
                      className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                    >
                      <ReceiptText className="size-3.5" />
                      View
                    </Link>
                  ) : (
                    order.status !== 'CANCELLED' && (
                      <Can permission={PERMISSIONS.SALES_ORDER_INVOICE}>
                        <Button
                          size="sm"
                          variant={isNext ? 'primary' : 'secondary'}
                          disabled={!isNext || invoiceStage.isPending}
                          title={isNext ? undefined : 'Stages are invoiced in order'}
                          loading={invoiceStage.isPending && invoiceStage.variables?.stageId === stage.id}
                          onClick={() => invoiceStage.mutate({ id, stageId: stage.id })}
                        >
                          Raise invoice
                        </Button>
                      </Can>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {canReadWork && workOrders.length > 0 && (
        <section className="mb-6 rounded border border-line bg-surface" aria-labelledby="wo-heading">
          <h2 id="wo-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
            Production
          </h2>
          <ul className="divide-y divide-line">
            {workOrders.map((wo) => {
              const ops = wo.operations.filter((op) => op.status !== 'SKIPPED');
              const done = ops.filter((op) => op.status === 'DONE').length;
              return (
                <li key={wo.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <Link href={`/production/${wo.id}`} className="font-mono text-accent hover:underline">
                    {wo.woNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-ink">{wo.description}</span>
                  <span className="text-ink-muted">
                    {done}/{ops.length} operations · {wo.status.toLowerCase().replace('_', ' ')}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {order.lines.length > 0 && (
        <section className="overflow-x-auto rounded border border-line bg-surface" aria-labelledby="lines-heading">
          <h2 id="lines-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
            What was ordered
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Fulfilled</th>
                <th className="px-4 py-2 text-right font-medium">Unit price</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-2 text-ink">{line.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {line.qtyOrdered} {line.uom ?? ''}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{line.qtyFulfilled}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(line.unitPrice)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Dialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${order.orderNumber}?`}
        description="Only an order with no live invoices can be cancelled."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              loading={act.isPending}
              onClick={() =>
                act.mutate(
                  { id, status: 'CANCELLED', cancelReason: reason.trim() || null },
                  { onSuccess: () => setCancelling(false) },
                )
              }
            >
              Cancel order
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Customer withdrew, duplicate order…"
        />
      </Dialog>
    </>
  );
}
