'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Boxes, Package, Pencil, Plus, Trash2, Wrench, Factory } from 'lucide-react';
import {
  PERMISSIONS,
  type CatalogItemDto,
  type MaterialDto,
  type ToolingDto,
  type WorkCenterDto,
} from '@saas/shared';
import {
  useCatalogItems,
  useDeleteCatalogItem,
  useDeleteMaterial,
  useDeleteTooling,
  useDeleteWorkCenter,
  useMaterials,
  useTooling,
  useWorkCenters,
} from '@/hooks/use-catalog-admin';
import { cn } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { CatalogItemFormDialog } from './catalog-item-form-dialog';
import { MaterialFormDialog } from './material-form-dialog';
import { WorkCenterFormDialog } from './work-center-form-dialog';
import { ToolingFormDialog } from './tooling-form-dialog';

type Tab = 'products' | 'materials' | 'work-centers' | 'tooling';

const TABS: Array<{ id: Tab; label: string; icon: typeof Package }> = [
  { id: 'products', label: 'Products', icon: Package },
  { id: 'materials', label: 'Materials', icon: Boxes },
  { id: 'work-centers', label: 'Work centres', icon: Factory },
  { id: 'tooling', label: 'Tooling', icon: Wrench },
];

const UOM_LABELS: Record<string, string> = {
  SHEET: 'Sheet',
  METRE: 'Metre',
  KG: 'Kilogram',
  EACH: 'Each',
};

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/** Struck through when inactive, so a retired record reads as retired. */
function NameCell({ name, sub, isActive }: { name: string; sub?: string | null; isActive: boolean }) {
  return (
    <div>
      <p className={cn('font-medium text-ink', !isActive && 'line-through opacity-60')}>{name}</p>
      {sub ? <p className="text-xs text-ink-subtle">{sub}</p> : null}
    </div>
  );
}

/**
 * Maintenance for the costing catalog.
 *
 * The API has had full CRUD for all four of these since the costing engine
 * landed, but nothing in the web app ever wrote to it, so the picker in the
 * quote editor could only ever say "Your catalog is empty. Add materials, work
 * centres and a product template" — an instruction the product gave no way to
 * follow.
 */
export function CatalogView() {
  const [tab, setTab] = useState<Tab>('products');

  const items = useCatalogItems();
  const materials = useMaterials();
  const workCenters = useWorkCenters();
  const tooling = useTooling();

  const [editingItem, setEditingItem] = useState<CatalogItemDto | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<MaterialDto | null>(null);
  const [editingWorkCenter, setEditingWorkCenter] = useState<WorkCenterDto | null>(null);
  const [editingTooling, setEditingTooling] = useState<ToolingDto | null>(null);
  const [creating, setCreating] = useState<Tab | null>(null);

  const [pendingDelete, setPendingDelete] = useState<
    { kind: Tab; id: string; name: string } | null
  >(null);

  const deleteItem = useDeleteCatalogItem();
  const deleteMaterial = useDeleteMaterial();
  const deleteWorkCenter = useDeleteWorkCenter();
  const deleteTooling = useDeleteTooling();

  const removing =
    deleteItem.isPending ||
    deleteMaterial.isPending ||
    deleteWorkCenter.isPending ||
    deleteTooling.isPending;

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { kind, id } = pendingDelete;
    if (kind === 'products') await deleteItem.mutateAsync(id);
    if (kind === 'materials') await deleteMaterial.mutateAsync(id);
    if (kind === 'work-centers') await deleteWorkCenter.mutateAsync(id);
    if (kind === 'tooling') await deleteTooling.mutateAsync(id);
    setPendingDelete(null);
  }

  function actionsColumn<T extends { id: string }>(
    kind: Tab,
    nameOf: (row: T) => string,
    onEdit: (row: T) => void,
  ): ColumnDef<T, unknown> {
    return {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${nameOf(row.original)}`}
            onClick={() => onEdit(row.original)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${nameOf(row.original)}`}
            onClick={() =>
              setPendingDelete({ kind, id: row.original.id, name: nameOf(row.original) })
            }
          >
            <Trash2 className="size-4 text-danger" />
          </Button>
        </div>
      ),
    };
  }

  const itemColumns = useMemo<ColumnDef<CatalogItemDto, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Product" />,
        cell: ({ row }) => (
          <NameCell
            name={row.original.name}
            sub={row.original.sku}
            isActive={row.original.isActive}
          />
        ),
      },
      {
        accessorKey: 'listPrice',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Price" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">{money(row.original.listPrice)}</span>
        ),
      },
      {
        accessorKey: 'standardCost',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cost" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink-muted">{money(row.original.standardCost)}</span>
        ),
      },
      {
        id: 'margin',
        header: 'Margin',
        cell: ({ row }) => {
          const { listPrice, standardCost } = row.original;
          if (listPrice <= 0) return <span className="text-ink-subtle">—</span>;
          const margin = ((listPrice - standardCost) / listPrice) * 100;
          return (
            <span
              className={cn(
                'tabular-nums',
                margin < 0 ? 'text-danger' : 'text-ink-muted',
              )}
            >
              {Math.round(margin * 10) / 10}%
            </span>
          );
        },
      },
      {
        accessorKey: 'uom',
        header: 'Sold by',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.uom}</span>,
      },
      {
        accessorKey: 'leadTimeDays',
        header: 'Lead time',
        cell: ({ row }) => (
          <span className="text-ink-muted tabular-nums">{row.original.leadTimeDays} days</span>
        ),
      },
      actionsColumn<CatalogItemDto>('products', (r) => r.name, setEditingItem),
    ],
    [],
  );

  const materialColumns = useMemo<ColumnDef<MaterialDto, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Material" />,
        cell: ({ row }) => (
          <NameCell
            name={row.original.name}
            sub={row.original.sku}
            isActive={row.original.isActive}
          />
        ),
      },
      {
        accessorKey: 'uom',
        header: 'Bought by',
        cell: ({ row }) => (
          <span className="text-ink-muted">
            {UOM_LABELS[row.original.uom] ?? row.original.uom}
          </span>
        ),
      },
      {
        accessorKey: 'costPerUom',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cost" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">{money(row.original.costPerUom)}</span>
        ),
      },
      {
        id: 'sheet',
        header: 'Sheet size',
        cell: ({ row }) =>
          row.original.sheetWidthMm && row.original.sheetHeightMm ? (
            <span className="text-ink-muted tabular-nums">
              {row.original.sheetWidthMm} × {row.original.sheetHeightMm} mm
            </span>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        accessorKey: 'wastePct',
        header: 'Waste',
        cell: ({ row }) => (
          <span className="text-ink-muted tabular-nums">{percent(row.original.wastePct)}</span>
        ),
      },
      actionsColumn<MaterialDto>('materials', (r) => r.name, setEditingMaterial),
    ],
    [],
  );

  const workCenterColumns = useMemo<ColumnDef<WorkCenterDto, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Work centre" />,
        cell: ({ row }) => <NameCell name={row.original.name} isActive={row.original.isActive} />,
      },
      {
        id: 'rate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rate per hour" />,
        cell: ({ row }) => (
          <div className="tabular-nums">
            <p className="text-ink">
              {money(row.original.machineCostPerHour + row.original.laborCostPerHour)}
            </p>
            <p className="text-xs text-ink-subtle">
              {money(row.original.machineCostPerHour)} machine +{' '}
              {money(row.original.laborCostPerHour)} labour
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'setupMinutes',
        header: 'Setup',
        cell: ({ row }) => (
          <span className="text-ink-muted tabular-nums">{row.original.setupMinutes} min</span>
        ),
      },
      {
        accessorKey: 'scrapPct',
        header: 'Scrap',
        cell: ({ row }) => (
          <span className="text-ink-muted tabular-nums">{percent(row.original.scrapPct)}</span>
        ),
      },
      {
        accessorKey: 'dailyCapacityMinutes',
        header: 'Capacity',
        cell: ({ row }) => (
          <span className="text-ink-muted tabular-nums">
            {Math.round((row.original.dailyCapacityMinutes / 60) * 10) / 10} h/day
          </span>
        ),
      },
      actionsColumn<WorkCenterDto>('work-centers', (r) => r.name, setEditingWorkCenter),
    ],
    [],
  );

  const toolingColumns = useMemo<ColumnDef<ToolingDto, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tooling" />,
        cell: ({ row }) => <NameCell name={row.original.name} isActive={row.original.isActive} />,
      },
      {
        accessorKey: 'cost',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cost" />,
        cell: ({ row }) => <span className="tabular-nums text-ink">{money(row.original.cost)}</span>,
      },
      {
        accessorKey: 'amortize',
        header: 'Charged',
        cell: ({ row }) => (
          <span className="text-ink-muted">
            {row.original.amortize ? 'Spread across the run' : 'Whole cost on first order'}
          </span>
        ),
      },
      {
        accessorKey: 'reusable',
        header: 'Repeat orders',
        cell: ({ row }) => (
          <span className="text-ink-muted">
            {row.original.reusable ? 'Kept' : 'Remade each time'}
          </span>
        ),
      },
      actionsColumn<ToolingDto>('tooling', (r) => r.name, setEditingTooling),
    ],
    [],
  );

  const active = TABS.find((t) => t.id === tab)!;
  const query =
    tab === 'products'
      ? items
      : tab === 'materials'
        ? materials
        : tab === 'work-centers'
          ? workCenters
          : tooling;

  return (
    <>
      <PageHeader
        title="Catalog"
        description="What you sell, what you make it from, and what it costs to make."
        actions={
          <Can permission={PERMISSIONS.CATALOG_MANAGE}>
            <Button onClick={() => setCreating(tab)}>
              <Plus className="size-4" />
              New {active.label.replace(/s$/, '').toLowerCase()}
            </Button>
          </Can>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface-muted/40 p-1">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                tab === item.id
                  ? 'bg-surface text-ink shadow-2xs'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {query.isError ? (
        <EmptyState
          title={`Couldn't load ${active.label.toLowerCase()}`}
          description={
            query.error instanceof Error ? query.error.message : 'Please try again.'
          }
        />
      ) : tab === 'products' ? (
        <DataTable
          columns={itemColumns}
          data={items.data ?? []}
          isLoading={items.isPending}
          getRowId={(row) => row.id}
          cardTitleKey="name"
          cardSubtitleKey="sku"
          searchPlaceholder="Search products…"
          emptyTitle="No products yet"
          emptyDescription="Add something you sell at a standing price. Products appear in the quote editor's catalog picker, and their cost is what makes the margin on a quote real."
          emptyIcon={<Package className="size-8 text-ink-muted" />}
        />
      ) : tab === 'materials' ? (
        <DataTable
          columns={materialColumns}
          data={materials.data ?? []}
          isLoading={materials.isPending}
          getRowId={(row) => row.id}
          cardTitleKey="name"
          cardSubtitleKey="sku"
          searchPlaceholder="Search materials…"
          emptyTitle="No materials yet"
          emptyDescription="Add the stock you buy and make things from — board, film, ink. Sheet materials carry their sheet size so the costing engine can work out how many blanks fit."
          emptyIcon={<Boxes className="size-8 text-ink-muted" />}
        />
      ) : tab === 'work-centers' ? (
        <DataTable
          columns={workCenterColumns}
          data={workCenters.data ?? []}
          isLoading={workCenters.isPending}
          getRowId={(row) => row.id}
          cardTitleKey="name"
          searchPlaceholder="Search work centres…"
          emptyTitle="No work centres yet"
          emptyDescription="Add the machines and benches a job passes through. Their hourly rates cost the time on a quote, and their capacity is what production schedules against."
          emptyIcon={<Factory className="size-8 text-ink-muted" />}
        />
      ) : (
        <DataTable
          columns={toolingColumns}
          data={tooling.data ?? []}
          isLoading={tooling.isPending}
          getRowId={(row) => row.id}
          cardTitleKey="name"
          searchPlaceholder="Search tooling…"
          emptyTitle="No tooling yet"
          emptyDescription="Add one-off costs such as cutting formes, dies and print plates, and say whether they are spread across the run or charged whole to the first order."
          emptyIcon={<Wrench className="size-8 text-ink-muted" />}
        />
      )}

      <CatalogItemFormDialog
        open={creating === 'products' || editingItem !== null}
        item={editingItem}
        onClose={() => {
          setCreating(null);
          setEditingItem(null);
        }}
      />
      <MaterialFormDialog
        open={creating === 'materials' || editingMaterial !== null}
        material={editingMaterial}
        onClose={() => {
          setCreating(null);
          setEditingMaterial(null);
        }}
      />
      <WorkCenterFormDialog
        open={creating === 'work-centers' || editingWorkCenter !== null}
        workCenter={editingWorkCenter}
        onClose={() => {
          setCreating(null);
          setEditingWorkCenter(null);
        }}
      />
      <ToolingFormDialog
        open={creating === 'tooling' || editingTooling !== null}
        tooling={editingTooling}
        onClose={() => {
          setCreating(null);
          setEditingTooling(null);
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Remove from catalog"
        description={`${pendingDelete?.name ?? ''} will no longer be available to pick.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={removing} onClick={confirmDelete}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Quotes and jobs that already used it keep the cost they were priced at, so removing it
          changes nothing that has been sent or made. If you only want to stop it being picked from
          now on, edit it and clear “available for new quotes” instead.
        </p>
      </Dialog>
    </>
  );
}
