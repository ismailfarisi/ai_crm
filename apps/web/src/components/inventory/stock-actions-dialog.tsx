'use client';

import { useState } from 'react';
import { useAdjustStock, useSetReorderLevels } from '@/hooks/use-inventory';
import type { StockItemDto } from '@/lib/api/endpoints';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';

interface StockActionsDialogProps {
  open: boolean;
  onClose: () => void;
  item: StockItemDto | null;
  mode: 'adjust' | 'reorder';
}

/**
 * Correcting a count, and setting when to reorder.
 *
 * Two small jobs against the same row, so they share a dialog rather than two
 * near-identical ones.
 */
export function StockActionsDialog({ open, onClose, item, mode }: StockActionsDialogProps) {
  const adjust = useAdjustStock();
  const setLevels = useSetReorderLevels();

  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [point, setPoint] = useState('');
  const [qty, setQty] = useState('');

  const close = () => {
    setCounted('');
    setNote('');
    setPoint('');
    setQty('');
    onClose();
  };

  if (!item) return null;

  // The user counts what is on the shelf; the delta is derived. Asking for a
  // signed adjustment instead is how someone writes off 900 when they meant
  // to correct 900 down to 890.
  const countedNum = counted === '' ? null : Number(counted);
  const delta =
    countedNum == null || Number.isNaN(countedNum)
      ? 0
      : Math.round((countedNum - item.qtyOnHand) * 10000) / 10000;

  if (mode === 'reorder') {
    return (
      <Dialog
        open={open}
        onClose={close}
        size="sm"
        title={`Reorder levels — ${item.materialName}`}
        description="Leave both blank to switch the low-stock check off for this material."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              loading={setLevels.isPending}
              onClick={async () => {
                await setLevels.mutateAsync({
                  materialId: item.materialId,
                  locationId: item.locationId,
                  reorderPoint: point === '' ? null : Number(point),
                  reorderQty: qty === '' ? null : Number(qty),
                });
                close();
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            id="reorder-point"
            label="Reorder when stock reaches"
            type="number"
            min={0}
            step="any"
            hint={`Currently ${item.reorderPoint ?? 'not set'}. Counts stock already on order.`}
            value={point}
            onChange={(event) => setPoint(event.target.value)}
            placeholder={item.reorderPoint == null ? 'Not set' : String(item.reorderPoint)}
          />
          <Input
            id="reorder-qty"
            label="Suggest ordering"
            type="number"
            min={0}
            step="any"
            hint="How much to put on the suggested order. Defaults to the shortfall."
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            placeholder={item.reorderQty == null ? 'Shortfall' : String(item.reorderQty)}
          />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title={`Adjust stock — ${item.materialName}`}
      description={`${item.qtyOnHand} ${item.uom.toLowerCase()} on record at ${item.avgUnitCost.toFixed(4)} each.`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            loading={adjust.isPending}
            disabled={delta === 0 || !note.trim()}
            onClick={async () => {
              await adjust.mutateAsync({
                materialId: item.materialId,
                locationId: item.locationId,
                qtyDelta: delta,
                note: note.trim(),
              });
              close();
            }}
          >
            {delta === 0 ? 'No change' : `Adjust by ${delta > 0 ? '+' : ''}${delta}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          id="counted-qty"
          label="Counted quantity"
          type="number"
          min={0}
          step="any"
          hint="What is actually on the shelf. The adjustment is worked out from this."
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
        />

        {delta !== 0 && (
          <p className="text-sm text-ink-muted">
            That is{' '}
            <span className={delta < 0 ? 'text-danger' : 'text-success'}>
              {delta > 0 ? '+' : ''}
              {delta} {item.uom.toLowerCase()}
            </span>
            {delta < 0 && (
              <>
                {' '}
                — a write-off of {(Math.abs(delta) * item.avgUnitCost).toFixed(2)} against cost of
                sales.
              </>
            )}
          </p>
        )}

        <Textarea
          id="adjust-note"
          label="Reason"
          required
          placeholder="Stock count, water damage, miscount on delivery…"
          hint="Recorded against the movement. An adjustment nobody can explain erodes trust in the whole figure."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
