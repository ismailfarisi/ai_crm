'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { ClipboardList } from 'lucide-react';
import type { PurchaseOrderDto, PurchaseOrderStatus } from '@saas/shared';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { formatRelative } from '@/lib/utils';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';

/**
 * State reads at a glance, not just as a word: an order needing someone's
 * attention should not look the same as one that is finished.
 */
const STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'bg-surface-sunk text-ink-muted',
  AWAITING_APPROVAL: 'bg-warning-soft text-warning',
  APPROVED: 'bg-accent-soft text-accent',
  SENT: 'bg-accent-soft text-accent',
  PARTIALLY_RECEIVED: 'bg-warning-soft text-warning',
  RECEIVED: 'bg-success-soft text-success',
  CANCELLED: 'bg-surface-sunk text-ink-subtle line-through',
};

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  SENT: 'Sent',
  PARTIALLY_RECEIVED: 'Part received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export function StatusPill({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);

export function PurchaseOrdersView() {
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const { data, isPending, isError, error } = usePurchaseOrders({
    page: 1,
    limit: 100,
    ...(status ? { status } : {}),
  });

  const orders = data?.items ?? [];

  const columns = useMemo<ColumnDef<PurchaseOrderDto, unknown>[]>(
    () => [
      {
        accessorKey: 'poNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Number" />,
        cell: ({ row }) => (
          <Link
            href={`/purchasing/orders/${row.original.id}`}
            className="font-medium text-accent hover:underline"
          >
            {row.original.poNumber}
          </Link>
        ),
      },
      {
        accessorKey: 'supplierName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
        cell: ({ row }) => <span className="text-ink">{row.original.supplierName}</span>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusPill status={row.original.status} />,
      },
      {
        accessorKey: 'totalAmount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {money(row.original.totalAmount, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: 'expectedDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expected" />,
        cell: ({ row }) => (
          <span className="text-ink-muted text-xs whitespace-nowrap">
            {row.original.expectedDate
              ? new Date(row.original.expectedDate).toLocaleDateString()
              : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Raised" />,
        cell: ({ row }) => (
          <span className="text-ink-subtle text-xs whitespace-nowrap">
            {formatRelative(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="What you have on order, and what still needs approving."
        actions={
          <select
            id="po-status-filter"
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value as PurchaseOrderStatus | '')}
            className="rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        }
      />

      {isError ? (
        <EmptyState
          title="Couldn't load purchase orders"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <DataTable
          columns={columns}
          data={orders}
          isLoading={isPending}
          getRowId={(row) => row.id}
          cardTitleKey="poNumber"
          cardSubtitleKey="supplierName"
          searchPlaceholder="Search order number or supplier…"
          emptyTitle="No purchase orders yet"
          emptyDescription="Raise one from a quote, or from a chat message on a linked channel."
          emptyIcon={<ClipboardList className="size-8 text-ink-muted" />}
        />
      )}
    </>
  );
}
