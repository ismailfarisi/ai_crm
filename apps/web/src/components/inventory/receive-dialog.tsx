'use client';

import { useState } from 'react';
import type { PurchaseOrderDto } from '@saas/shared';
import { useReceiveGoods } from '@/hooks/use-inventory';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';

interface ReceiveDialogProps {
  open: boolean;
  onClose: () => void;
  order: PurchaseOrderDto | null;
}

/**
 * Booking a delivery in.
 *
 * Quantities default to what is still outstanding, because that is what
 * arrives most of the time and retyping it on every line is how mistakes get
 * made. Anything already received is shown alongside, so a part delivery is
 * obvious before anyone types a number.
 */
export function ReceiveDialog({ open, onClose, order }: ReceiveDialogProps) {
  const receive = useReceiveGoods();
  // Only what the user has actually typed. Defaults are derived below rather
  // than seeded into state by an effect, so opening the dialog for a different
  // order cannot leave a previous order's quantities behind.
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [reference, setReference] = useState('');

  const close = () => {
    setEdited({});
    setReference('');
    onClose();
  };

  if (!order) return null;

  const lines = (order.lines ?? []).map((line) => {
    const outstanding = Math.max(0, line.qtyOrdered - line.qtyReceived);
    const shown = edited[line.id] ?? String(outstanding);
    return { line, outstanding, shown, entered: Number(shown) || 0 };
  });

  const receivable = lines.filter((l) => l.entered > 0);
  const total = receivable.reduce((sum, l) => sum + l.entered * l.line.unitCost, 0);

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={`Book in ${order.poNumber}`}
      description={`Delivery from ${order.supplierName}.`}
      footer={
        <>
          <Button variant="secondary" onClick={close} type="button">
            Cancel
          </Button>
          <Button
            loading={receive.isPending}
            disabled={receivable.length === 0}
            onClick={async () => {
              await receive.mutateAsync({
                purchaseOrderId: order.id,
                input: {
                  supplierReference: reference || null,
                  notes: null,
                  lines: receivable.map((l) => ({
                    purchaseOrderLineId: l.line.id,
                    qtyReceived: l.entered,
                    qtyRejected: 0,
                  })),
                },
              });
              close();
            }}
          >
            {receivable.length === 0
              ? 'Nothing to book in'
              : `Book in ${total.toFixed(2)} ${order.currency}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          id="supplier-reference"
          label="Supplier delivery note"
          hint="Their reference, so their bill can be matched to this delivery later."
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />

        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full min-w-[460px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunk text-left">
                <th className="px-3 py-2 font-medium text-ink-muted">Item</th>
                <th className="px-3 py-2 text-right font-medium text-ink-muted">Ordered</th>
                <th className="px-3 py-2 text-right font-medium text-ink-muted">Received</th>
                <th className="px-3 py-2 text-right font-medium text-ink-muted">Booking in</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ line, outstanding, shown }) => (
                <tr key={line.id} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-2 text-ink">{line.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {line.qtyOrdered}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {line.qtyReceived}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      id={`qty-${line.id}`}
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`Quantity received for ${line.description}`}
                      className="w-24 rounded border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
                      value={shown}
                      onChange={(event) =>
                        setEdited((prev) => ({ ...prev, [line.id]: event.target.value }))
                      }
                    />
                    {outstanding === 0 && (
                      <p className="mt-1 text-xs text-ink-subtle">Fully received</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-ink-subtle">
          Booking in moves stock, updates the order, and posts the value to inventory. Over-delivery
          is refused unless your purchasing policy allows a tolerance.
        </p>
      </div>
    </Dialog>
  );
}
