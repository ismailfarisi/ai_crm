'use client';

import { useState } from 'react';
import { AlertTriangle, FileDown, Receipt, Truck } from 'lucide-react';
import { PERMISSIONS, type SalesOrderDto } from '@saas/shared';
import { downloadPackingSlip, useDeliveryNoteAction, useDeliveryNotes } from '@/hooks/use-credits';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';

/**
 * What has shipped on an order, and a form to ship more.
 *
 * Quantities left to ship count draft deliveries too, so two people cannot
 * both prepare the whole order.
 */
/**
 * Lines with no catalog material behind them.
 *
 * A quote line typed by hand carries no `stockMaterialId`, so dispatching it
 * moves nothing off the shelf. That is legitimate for a service or for goods
 * bought straight to the job — it just has to be visible, rather than looking
 * like stock that quietly failed to move.
 */
function untrackedLines(note: { lines: { stockMaterialId: string | null }[] }): number {
  return note.lines.filter((line) => line.stockMaterialId === null).length;
}

export function OrderDeliveries({ order }: { order: SalesOrderDto }) {
  const canRead = useCan({ permission: PERMISSIONS.DELIVERY_NOTE_READ });
  const canCreate = useCan({ permission: PERMISSIONS.DELIVERY_NOTE_CREATE });
  const canDispatch = useCan({ permission: PERMISSIONS.DELIVERY_NOTE_DISPATCH });
  const canInvoice = useCan({ permission: PERMISSIONS.SALES_ORDER_INVOICE });
  const { data: notes = [] } = useDeliveryNotes(order.id, canRead);
  const act = useDeliveryNoteAction(order.id);

  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');

  if (!canRead) return null;

  const perDelivery = order.billingSchedule.length === 1 && order.billingSchedule[0].trigger === 'ON_DELIVERY';
  const inDraft = (lineId: string) =>
    notes
      .filter((n) => n.status === 'DRAFT')
      .flatMap((n) => n.lines)
      .filter((l) => l.salesOrderLineId === lineId)
      .reduce((s, l) => s + l.qty, 0);
  const remaining = (line: SalesOrderDto['lines'][number]) =>
    Math.max(0, Math.round((line.qtyOrdered - line.qtyFulfilled - inDraft(line.id)) * 10000) / 10000);
  const anythingLeft = order.lines.some((l) => remaining(l) > 0);
  const shippable = order.status !== 'CANCELLED' && order.status !== 'CLOSED';

  const openForm = () => {
    setQty(Object.fromEntries(order.lines.map((l) => [l.id, String(remaining(l))])));
    setCarrier('');
    setTracking('');
    setOpen(true);
  };
  const lines = order.lines
    .map((l) => ({ salesOrderLineId: l.id, qty: Number(qty[l.id]) || 0 }))
    .filter((l) => l.qty > 0);

  return (
    <section className="mb-6 rounded border border-line bg-surface" aria-labelledby="deliveries-heading">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="deliveries-heading" className="text-sm font-medium text-ink">
          Deliveries
        </h2>
        {canCreate && shippable && anythingLeft && (
          <Button size="sm" variant="secondary" onClick={openForm}>
            <Truck className="size-4" />
            Prepare delivery
          </Button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-subtle">Nothing has shipped yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="text-ink">
                  <span className="font-mono">{note.deliveryNoteNumber}</span>
                  <span className="text-ink-subtle">
                    {' · '}
                    {note.status === 'DISPATCHED' && note.dispatchedAt
                      ? `dispatched ${new Date(note.dispatchedAt).toLocaleDateString()}`
                      : note.status.toLowerCase()}
                    {note.carrier ? ` · ${note.carrier}` : ''}
                    {note.trackingReference ? ` ${note.trackingReference}` : ''}
                  </span>
                </p>
                <p className="truncate text-xs text-ink-subtle">
                  {note.lines.map((l) => `${l.qty} × ${l.description}`).join(', ')}
                  {note.invoiceNumber ? ` · invoiced on ${note.invoiceNumber}` : ''}
                </p>
                {/*
                  Dispatching a line with no material behind it moves no stock
                  and used to say nothing at all, so 500 units could go out
                  against an empty shelf and the stock figure never flinched.
                  A line sold from stock is checked against what is on hand and
                  refused if it is short; these are the ones that are not.
                */}
                {untrackedLines(note) > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="size-3 shrink-0" />
                    {untrackedLines(note) === note.lines.length
                      ? 'Not from stock — dispatching this will not move any stock.'
                      : `${untrackedLines(note)} of ${note.lines.length} lines are not from stock and will not move any.`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => downloadPackingSlip(note.id, note.deliveryNoteNumber)}>
                  <FileDown className="size-4" />
                  Packing slip
                </Button>
                {note.status === 'DRAFT' && canDispatch && (
                  <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ kind: 'dispatch', id: note.id })}>
                    Dispatch
                  </Button>
                )}
                {note.status === 'DRAFT' && canCreate && (
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'cancel', id: note.id })}>
                    Discard
                  </Button>
                )}
                {note.status === 'DISPATCHED' && perDelivery && !note.invoiceId && canInvoice && (
                  <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ kind: 'invoice', id: note.id })}>
                    <Receipt className="size-4" />
                    Invoice delivery
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Prepare delivery — ${order.orderNumber}`}
        description="Saved as a draft. Stock and fulfilment move when it is dispatched."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={lines.length === 0}
              loading={act.isPending}
              onClick={() =>
                act.mutate(
                  { kind: 'create', lines, carrier: carrier || undefined, trackingReference: tracking || undefined },
                  { onSuccess: () => setOpen(false) },
                )
              }
            >
              Save delivery
            </Button>
          </>
        }
      >
        <table className="mb-4 w-full text-sm">
          <thead className="text-left text-xs text-ink-subtle">
            <tr>
              <th className="py-1 font-medium">Item</th>
              <th className="py-1 text-right font-medium">Left</th>
              <th className="py-1 text-right font-medium">Ship now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2 pr-2 text-ink">{line.description}</td>
                <td className="py-2 text-right tabular-nums text-ink-muted">{remaining(line)}</td>
                <td className="py-2 pl-2 text-right">
                  <input
                    aria-label={`Quantity of ${line.description}`}
                    type="number"
                    min={0}
                    max={remaining(line)}
                    step="any"
                    value={qty[line.id] ?? ''}
                    onChange={(e) => setQty((q) => ({ ...q, [line.id]: e.target.value }))}
                    className="w-24 rounded border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          <Input label="Tracking reference" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </div>
      </Dialog>
    </section>
  );
}
