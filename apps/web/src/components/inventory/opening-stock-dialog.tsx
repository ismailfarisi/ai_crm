'use client';

import { useState } from 'react';
import { useMaterials } from '@/hooks/use-catalog-admin';
import { useAdjustStock } from '@/hooks/use-inventory';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';

/**
 * Entering stock the business already holds.
 *
 * `StockActionsDialog` corrects a row that exists, which is no help on the day
 * a business arrives holding stock: nothing was in the table, so the only way
 * to get a figure in was to raise a purchase order against a supplier for
 * goods that had already been bought somewhere else.
 *
 * The unit cost is asked for and is not optional in practice. Stock entered at
 * zero is consumed at zero, and every job made from it reports a 100% margin —
 * which is the same wrong number this product was already criticised for.
 */
export function OpeningStockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: materials = [], isPending } = useMaterials();
  const adjust = useAdjustStock();

  const [materialId, setMaterialId] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('Opening stock count');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setMaterialId('');
    setQty('');
    setUnitCost('');
    setNote('Opening stock count');
    setError(null);
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const quantity = Number(qty);
    const cost = Number(unitCost);

    if (!materialId) {
      setError('Pick the material this stock is of.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Enter how many units are on the shelf.');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError('Enter what a unit of this stock cost you.');
      return;
    }
    if (!note.trim()) {
      setError('Say where this figure came from — a stock count, a previous system.');
      return;
    }

    try {
      await adjust.mutateAsync({
        materialId,
        qtyDelta: quantity,
        unitCost: cost,
        note: note.trim(),
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enter the stock.');
    }
  };

  const selected = materials.find((material) => material.id === materialId);

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Enter opening stock"
      description="For stock you already hold. It is added at the cost you give, so jobs made from it carry a real cost."
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="opening-stock-form" size="sm" loading={adjust.isPending}>
            Add to stock
          </Button>
        </>
      }
    >
      <form id="opening-stock-form" onSubmit={submit} noValidate className="space-y-4">
        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger-soft/40 px-3.5 py-2.5 text-xs font-semibold text-danger">
            {error}
          </p>
        )}

        {!isPending && materials.length === 0 ? (
          <p className="text-sm text-ink-muted">
            There are no materials in the catalog yet. Add one under Catalog &rarr; Materials
            first, so the stock has something to be stock of.
          </p>
        ) : (
          <>
            <Select
              label="Material"
              value={materialId}
              onChange={(event) => setMaterialId(event.target.value)}
              placeholder={isPending ? 'Loading materials…' : 'Pick a material'}
              options={materials.map((material) => ({
                value: material.id,
                label: `${material.name} (${material.sku})`,
              }))}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={`Quantity${selected ? ` (${selected.uom})` : ''}`}
                type="number"
                step="0.001"
                min="0"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
              <Input
                label="Cost per unit"
                type="number"
                step="0.01"
                min="0"
                hint="What it cost you, not what you sell it for."
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
              />
            </div>

            <Textarea
              label="Reason"
              rows={2}
              hint="Kept on the movement, so the figure can always be explained."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </>
        )}
      </form>
    </Dialog>
  );
}
