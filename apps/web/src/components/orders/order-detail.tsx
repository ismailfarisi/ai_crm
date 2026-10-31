'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, Factory, FileText, Lock, ReceiptText, Wrench } from 'lucide-react';
import { PERMISSIONS, type SalesOrderDto, type SalesOrderStatus } from '@saas/shared';
import { useInvoiceStage, useSalesOrder, useSalesOrderAction } from '@/hooks/use-sales-orders';
import { usePlanWorkOrders, useWorkOrders } from '@/hooks/use-work-orders';
import { useCan } from '@/lib/session-context';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/field';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { cn, formatMoney } from '@/lib/utils';
import { money, OrderStatusPill } from './orders-view';
import { OrderDeliveries } from './order-deliveries';

const NEXT: Partial<Record<SalesOrderStatus, { to: SalesOrderStatus; label: string; icon: typeof Factory }[]>> = {
  OPEN: [
    { to: 'IN_PRODUCTION', label: 'Start production', icon: Factory },
    { to: 'FULFILLED', label: 'Mark fulfilled', icon: CheckCircle2 },
  ],
  IN_PRODUCTION: [{ to: 'FULFILLED', label: 'Mark fulfilled', icon: CheckCircle2 }],
  FULFILLED: [{ to: 'CLOSED', label: 'Close order', icon: Lock }],
};

/** What each step does, said before it is done. */
const STEP_DESCRIPTIONS: Partial<Record<SalesOrderStatus, string>> = {
  IN_PRODUCTION:
    'Marks the order as being made. It does not plan any work orders: Plan production does that.',
  FULFILLED: 'Says the customer has everything they ordered. Check what has shipped first.',
  CLOSED: 'Closes the order. Nothing more can be shipped or invoiced against it.',
};

type PendingStep =
  | { kind: 'status'; to: SalesOrderStatus; label: string }
  | { kind: 'plan' }
  | { kind: 'invoice'; stageId: string; label: string; amount: number };

const qty = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** Shipped against ordered, per line, so "Mark fulfilled" is decided on what actually went out. */
function ShippedSummary({ order }: { order: SalesOrderDto }) {
  const short = order.lines.filter((line) => line.qtyFulfilled < line.qtyOrdered);
  return (
    <div className="space-y-3">
      <p
        className={cn(
          'rounded-xl border px-3 py-2 text-sm',
          short.length > 0 ? 'border-warning/30 bg-warning-soft text-ink' : 'border-success/20 bg-success-soft text-ink',
        )}
      >
        {short.length === 0
          ? 'Every line has shipped in full.'
          : `${short.length} of ${order.lines.length} ${order.lines.length === 1 ? 'line has' : 'lines have'} not shipped in full. Marking the order fulfilled says it is done anyway.`}
      </p>
      <table className="w-full text-sm">
        <thead className="text-start text-xs text-ink-subtle">
          <tr>
            <th className="py-1 text-start font-medium">Item</th>
            <th className="py-1 text-end font-medium">Shipped</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td className="py-1.5 pe-3 text-ink">{line.description}</td>
              <td
                className={cn(
                  'py-1.5 text-end tabular-nums whitespace-nowrap',
                  line.qtyFulfilled < line.qtyOrdered ? 'font-semibold text-warning' : 'text-ink',
                )}
              >
                {qty(line.qtyFulfilled)} of {qty(line.qtyOrdered)} {line.uom ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const [pending, setPending] = useState<PendingStep | null>(null);

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
  const inCurrency = (n: number) => formatMoney(Number(n) || 0, order.currency);
  const steps = NEXT[order.status] ?? [];

  const runPending = async () => {
    if (!pending) return;
    if (pending.kind === 'status') await act.mutateAsync({ id, status: pending.to });
    else if (pending.kind === 'plan') await plan.mutateAsync({ salesOrderId: id });
    else await invoiceStage.mutateAsync({ id, stageId: pending.stageId });
  };

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        description={`${order.customerName} · ${money(order.totalAmount)} ${order.currency}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusPill status={order.status} />
            {/* One amber button: the next step. The rest are there, but quieter. */}
            <Can permission={PERMISSIONS.SALES_ORDER_UPDATE}>
              {steps.map(({ to, label, icon: Icon }, index) => (
                <Button
                  key={to}
                  variant={index === 0 ? 'primary' : 'outline'}
                  loading={act.isPending && act.variables?.status === to}
                  disabled={act.isPending}
                  onClick={() => setPending({ kind: 'status', to, label })}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Button>
              ))}
            </Can>
            {order.status !== 'CANCELLED' && order.status !== 'CLOSED' && (
              <Can permission={PERMISSIONS.WORK_ORDER_CREATE}>
                <Button variant="outline" loading={plan.isPending} onClick={() => setPending({ kind: 'plan' })}>
                  <Wrench className="size-4" aria-hidden />
                  Plan production
                </Button>
              </Can>
            )}
            {order.status !== 'CANCELLED' && order.status !== 'CLOSED' && !hasLiveInvoice && (
              <Can permission={PERMISSIONS.SALES_ORDER_CANCEL}>
                <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setCancelling(true)}>
                  <Ban className="size-4" aria-hidden />
                  Cancel order
                </Button>
              </Can>
            )}
          </div>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Order value', inCurrency(order.totalAmount)],
          ['Invoiced', inCurrency(order.invoicedAmount)],
          ['Paid', inCurrency(order.paidAmount)],
          ['Owed now', inCurrency(outstanding)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-surface px-3 py-2">
            <dt className="text-xs text-ink-subtle">{label}</dt>
            <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        {order.quoteNumber && (
          <Link
            href={`/quotes/${order.quoteId}`}
            className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline"
          >
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

      <section className="mb-6 rounded-2xl border border-border bg-surface" aria-labelledby="billing-heading">
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
                        ? 'Invoiced when accepted'
                        : stage.trigger === 'ON_DELIVERY'
                          ? stage.invoicedAt
                            ? 'Invoiced in full across its deliveries'
                            : 'Each dispatched delivery is invoiced for what it carried'
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
                      className="inline-flex items-center gap-1 text-sm font-medium text-ink underline-offset-2 hover:underline"
                    >
                      <ReceiptText className="size-3.5" aria-hidden />
                      View invoice
                    </Link>
                  ) : (
                    order.status !== 'CANCELLED' &&
                    stage.trigger !== 'ON_DELIVERY' && (
                      <Can permission={PERMISSIONS.SALES_ORDER_INVOICE}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isNext || invoiceStage.isPending}
                          title={isNext ? undefined : 'Stages are invoiced in order'}
                          loading={invoiceStage.isPending && invoiceStage.variables?.stageId === stage.id}
                          onClick={() =>
                            setPending({
                              kind: 'invoice',
                              stageId: stage.id,
                              label: stage.label,
                              amount: stage.totalAmount,
                            })
                          }
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

      <OrderDeliveries order={order} />

      {canReadWork && workOrders.length > 0 && (
        <section className="mb-6 rounded-2xl border border-border bg-surface" aria-labelledby="wo-heading">
          <h2 id="wo-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
            Production
          </h2>
          <ul className="divide-y divide-line">
            {workOrders.map((wo) => {
              const ops = wo.operations.filter((op) => op.status !== 'SKIPPED');
              const done = ops.filter((op) => op.status === 'DONE').length;
              return (
                <li key={wo.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <Link
                    href={`/production/${wo.id}`}
                    className="font-mono font-medium text-ink underline-offset-2 hover:underline"
                  >
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
        <section className="overflow-x-auto rounded-2xl border border-border bg-surface" aria-labelledby="lines-heading">
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
            {/* The lines add up to the subtotal; VAT is what takes it to the order value. */}
            <tfoot className="border-t border-line">
              <tr>
                <th scope="row" colSpan={4} className="px-4 pt-3 pb-1 text-right font-medium text-ink-muted">
                  Subtotal
                  {order.discountAmount > 0 && (
                    <span className="block text-xs font-normal text-ink-subtle">
                      after {inCurrency(order.discountAmount)} discount
                    </span>
                  )}
                </th>
                <td className="px-4 pt-3 pb-1 text-right align-top tabular-nums text-ink">
                  {inCurrency(order.subtotalAmount)}
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={4} className="px-4 py-1 text-right font-medium text-ink-muted">
                  VAT
                </th>
                <td className="px-4 py-1 text-right tabular-nums text-ink">{inCurrency(order.taxAmount)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={4} className="px-4 pt-1 pb-3 text-right font-semibold text-ink">
                  Order total
                </th>
                <td className="px-4 pt-1 pb-3 text-right font-semibold tabular-nums text-ink">
                  {inCurrency(order.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        title={
          pending?.kind === 'plan'
            ? `Plan production for ${order.orderNumber}?`
            : pending?.kind === 'invoice'
              ? `Raise the ${pending.label} invoice?`
              : `${pending?.label ?? 'Change'} ${order.orderNumber}?`
        }
        description={
          pending?.kind === 'plan'
            ? 'Creates work orders for the lines that can be made from a product template. Lines that cannot, or are already planned, are skipped and listed.'
            : pending?.kind === 'invoice'
              ? `Issues an invoice to ${order.customerName} for ${inCurrency(pending.amount)} and posts it to the books.`
              : pending
                ? STEP_DESCRIPTIONS[pending.to]
                : undefined
        }
        confirmLabel={
          pending?.kind === 'plan'
            ? 'Plan production'
            : pending?.kind === 'invoice'
              ? 'Raise invoice'
              : (pending?.label ?? 'Confirm')
        }
      >
        {pending?.kind === 'status' && pending.to === 'FULFILLED' && order.lines.length > 0 && (
          <ShippedSummary order={order} />
        )}
      </ConfirmDialog>

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
