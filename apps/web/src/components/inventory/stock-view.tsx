'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, BellRing, Boxes, Scale } from 'lucide-react';
import { PERMISSIONS, needsReorder } from '@saas/shared';
import { useReorderSuggestions, useStock } from '@/hooks/use-inventory';
import type { StockItemDto } from '@/lib/api/endpoints';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { StockActionsDialog } from './stock-actions-dialog';

/**
 * Stock on hand.
 *
 * Material names come denormalised from the API rather than a second request:
 * fetching the catalog would need `catalog:manage`, which someone holding only
 * `inventory:read` does not have.
 */
export function StockView() {
  const { data: stock = [], isPending, isError, error } = useStock();
  const { data: suggestions = [] } = useReorderSuggestions();
  const [acting, setActing] = useState<{ item: StockItemDto; mode: 'adjust' | 'reorder' } | null>(
    null,
  );
  const columns = useMemo<ColumnDef<StockItemDto, unknown>[]>(
    () => [
      {
        accessorKey: 'materialId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Material" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{row.original.materialName}</span>
            {needsReorder(row.original) && (
              <span
                className="inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning"
                title="At or below the reorder point"
              >
                <AlertTriangle className="size-3" />
                Low
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'qtyOnHand',
        header: ({ column }) => <DataTableColumnHeader column={column} title="On hand" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {row.original.qtyOnHand} {row.original.uom.toLowerCase()}
          </span>
        ),
      },
      {
        accessorKey: 'qtyReserved',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reserved" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink-muted">{row.original.qtyReserved}</span>
        ),
      },
      {
        accessorKey: 'qtyOnOrder',
        header: ({ column }) => <DataTableColumnHeader column={column} title="On order" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink-muted">{row.original.qtyOnOrder}</span>
        ),
      },
      {
        accessorKey: 'avgUnitCost',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Avg cost" />,
        cell: ({ row }) => (
          // Four places, because a unit cost gets divided before it is
          // multiplied back up by an order quantity.
          <span className="tabular-nums text-ink-muted">
            {row.original.avgUnitCost.toFixed(4)}
          </span>
        ),
      },
      {
        id: 'value',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Value" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {(row.original.qtyOnHand * row.original.avgUnitCost).toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: 'reorderPoint',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reorder at" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink-subtle">
            {row.original.reorderPoint ?? '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Can permission={PERMISSIONS.INVENTORY_ADJUST}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Set reorder levels for ${row.original.materialName}`}
                title="Reorder levels"
                onClick={() => setActing({ item: row.original, mode: 'reorder' })}
              >
                <BellRing className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Adjust stock for ${row.original.materialName}`}
                title="Adjust after a count"
                onClick={() => setActing({ item: row.original, mode: 'adjust' })}
              >
                <Scale className="size-4" />
              </Button>
            </Can>
          </div>
        ),
      },
    ],
    [],
  );

  const totalValue = stock.reduce((sum, s) => sum + s.qtyOnHand * s.avgUnitCost, 0);

  return (
    <>
      <PageHeader
        title="Stock"
        description={
          stock.length > 0
            ? `${stock.length} material${stock.length === 1 ? '' : 's'} on hand, valued at ${totalValue.toFixed(2)} at moving-average cost.`
            : 'What is on the shelf, valued at moving-average cost.'
        }
      />

      {suggestions.length > 0 && (
        <div className="mb-6 rounded border border-warning/40 bg-warning-soft/40 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" />
            {suggestions.length === 1
              ? 'One material needs reordering'
              : `${suggestions.length} materials need reordering`}
          </p>
          <ul className="space-y-1 text-sm text-ink-muted">
            {suggestions.map((s) => (
              <li key={s.item.id}>
                <span className="text-ink">{s.item.materialName}</span> — short by{' '}
                <span className="tabular-nums">{s.shortfall}</span>, suggest ordering{' '}
                <span className="tabular-nums">{s.suggestedQty}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isError ? (
        <EmptyState
          title="Couldn't load stock"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <DataTable
          columns={columns}
          data={stock}
          isLoading={isPending}
          getRowId={(row) => row.id}
          searchPlaceholder="Search material…"
          emptyTitle="Nothing in stock yet"
          emptyDescription="Stock appears here once a delivery is booked in against a purchase order."
          emptyIcon={<Boxes className="size-8 text-ink-muted" />}
        />
      )}

      <StockActionsDialog
        open={acting !== null}
        item={acting?.item ?? null}
        mode={acting?.mode ?? 'adjust'}
        onClose={() => setActing(null)}
      />
    </>
  );
}
