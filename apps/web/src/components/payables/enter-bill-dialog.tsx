'use client';

import { useState } from 'react';
import {
  billTotals,
  summariseMatch,
  type PurchaseOrderDto,
} from '@saas/shared';
import { useBillableLines, useCreateBill } from '@/hooks/use-bills';
import { usePurchasePolicy } from '@/hooks/use-purchase-orders';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';

interface EnterBillDialogProps {
  open: boolean;
  onClose: () => void;
  order: PurchaseOrderDto | null;
}

/**
 * Entering a supplier's bill against an order.
 *
 * It opens on what actually *arrived and has not yet been billed*, at the
 * price that was ordered — so the common case is typing an invoice number and
 * saving. Whatever the user changes is checked live with the same function the
 * API uses, so a variance shows up while it can still be queried rather than
 * at approval.
 */
export function EnterBillDialog({ open, onClose, order }: EnterBillDialogProps) {
  const { data: billable = [] } = useBillableLines(order?.id ?? null, open);
  const { data: policy } = usePurchasePolicy();
  const create = useCreateBill();

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tax, setTax] = useState('');
  const [edits, setEdits] = useState<Record<string, { qty?: string; unitCost?: string }>>({});

  const close = () => {
    setInvoiceNumber('');
    setTax('');
    setEdits({});
    onClose();
  };

  if (!order) return null;

  const rows = billable.map((line) => {
    const edit = edits[line.purchaseOrderLineId] ?? {};
    const qty = Number(edit.qty ?? line.qtyBillable) || 0;
    const unitCost = Number(edit.unitCost ?? line.orderUnitCost) || 0;
    return { line, edit, qty, unitCost };
  });
  const included = rows.filter((r) => r.qty > 0);

  const preview = summariseMatch(
    included.map((r) => ({
      description: r.line.description,
      qty: r.qty,
      unitCost: r.unitCost,
      orderLine: {
        unitCost: r.line.orderUnitCost,
        qtyReceived: r.line.qtyReceived,
        qtyBilledElsewhere: r.line.qtyBilled,
      },
    })),
    policy?.varianceTolerancePct ?? 0,
  );
  const totals = billTotals(included, Number(tax) || 0);

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={`Enter bill for ${order.poNumber}`}
      description={`From ${order.supplierName}. Quantities start at what arrived and has not been billed.`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!invoiceNumber.trim() || included.length === 0}
            onClick={async () => {
              await create.mutateAsync({
                supplierId: order.supplierId,
                purchaseOrderId: order.id,
                supplierInvoiceNumber: invoiceNumber.trim(),
                billDate: new Date(`${billDate}T00:00:00Z`),
                dueDate: null,
                taxAmount: Number(tax) || 0,
                notes: null,
                lines: included.map((r) => ({
                  purchaseOrderLineId: r.line.purchaseOrderLineId,
                  description: r.line.description,
                  qty: r.qty,
                  unitCost: r.unitCost,
                })),
              });
              close();
            }}
          >
            Save draft · {totals.total.toFixed(2)} {order.currency}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            id="bill-invoice-number"
            label="Their invoice number"
            required
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
          <Input
            id="bill-date"
            label="Invoice date"
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
          />
          <Input
            id="bill-tax"
            label="Tax on the invoice"
            type="number"
            min={0}
            step="0.01"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunk text-left">
                <th className="px-3 py-2 font-medium text-ink-muted">Item</th>
                <th className="px-3 py-2 text-right font-medium text-ink-muted">Received</th>
                <th className="px-3 py-2 text-right font-medium text-ink-muted">Billing</th>
                <th className="px-3 py-2 text-right font-medium text-ink-muted">Unit price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, edit }) => (
                <tr key={line.purchaseOrderLineId} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-2 text-ink">
                    {line.description}
                    {line.qtyBilled > 0 && (
                      <p className="text-xs text-ink-subtle">{line.qtyBilled} already on another bill</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{line.qtyReceived}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      id={`bill-qty-${line.purchaseOrderLineId}`}
                      aria-label={`Quantity billed for ${line.description}`}
                      type="number"
                      min={0}
                      step="any"
                      className="w-24 rounded border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
                      value={edit.qty ?? String(line.qtyBillable)}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, [line.purchaseOrderLineId]: { ...p[line.purchaseOrderLineId], qty: e.target.value } }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      id={`bill-cost-${line.purchaseOrderLineId}`}
                      aria-label={`Unit price billed for ${line.description}`}
                      type="number"
                      min={0}
                      step="any"
                      className="w-28 rounded border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
                      value={edit.unitCost ?? String(line.orderUnitCost)}
                      onChange={(e) =>
                        setEdits((p) => ({
                          ...p,
                          [line.purchaseOrderLineId]: { ...p[line.purchaseOrderLineId], unitCost: e.target.value },
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {preview.variances.length > 0 ? (
          <div className="rounded border border-warning/40 bg-warning-soft/40 p-3 text-sm">
            <p className="mb-1 font-medium text-warning">This bill does not match the order</p>
            <ul className="space-y-1 text-ink-muted">
              {preview.variances.map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-subtle">
              You can still save it. Approving it will need someone allowed to accept a variance.
            </p>
          </div>
        ) : (
          included.length > 0 && <p className="text-sm text-success">Matches the order and what was received.</p>
        )}
      </div>
    </Dialog>
  );
}
