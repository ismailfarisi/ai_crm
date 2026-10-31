'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { PackageCheck } from 'lucide-react';
import type { SalesOrderDto, SalesOrderStatus } from '@saas/shared';
import { useSalesOrders } from '@/hooks/use-sales-orders';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';

const STATUS_TONES: Record<SalesOrderStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  OPEN: 'info',
  IN_PRODUCTION: 'warning',
  FULFILLED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};

export const ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  OPEN: 'Open',
  IN_PRODUCTION: 'In production',
  FULFILLED: 'Fulfilled',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export function OrderStatusPill({ status }: { status: SalesOrderStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={status === 'CANCELLED' ? 'line-through' : undefined}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OrdersView() {
  const [status, setStatus] = useState<SalesOrderStatus | ''>('');
  const { data = [], isPending, isError, error } = useSalesOrders(status ? { status } : {});

  const columns = useMemo<ColumnDef<SalesOrderDto, unknown>[]>(
    () => [
      {
        accessorKey: 'orderNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Order" />,
        cell: ({ row }) => (
          <Link href={`/orders/${row.original.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
            {row.original.orderNumber}
          </Link>
        ),
      },
      {
        accessorKey: 'customerName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
        cell: ({ row }) => (
          <div>
            <p className="text-ink">{row.original.customerName}</p>
            {row.original.quoteNumber && (
              <p className="text-xs text-ink-subtle">From {row.original.quoteNumber}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <OrderStatusPill status={row.original.status} />,
      },
      {
        accessorKey: 'totalAmount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Value" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {money(row.original.totalAmount)} {row.original.currency}
          </span>
        ),
      },
      {
        id: 'billing',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoiced" />,
        cell: ({ row }) => {
          const { invoicedAmount, totalAmount, billingSchedule } = row.original;
          const billed = billingSchedule.filter((s) => s.invoiceId).length;
          const pct = totalAmount > 0 ? Math.min(100, (invoicedAmount / totalAmount) * 100) : 0;
          return (
            <div className="min-w-32">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                <div
                  data-testid="invoiced-bar"
                  className="h-1.5 rounded-full bg-charcoal"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-ink-muted tabular-nums">
                {money(invoicedAmount)} · {billed} of {billingSchedule.length}{' '}
                {billingSchedule.length === 1 ? 'stage' : 'stages'}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ordered" />,
        cell: ({ row }) => (
          <span className="text-xs text-ink-muted whitespace-nowrap">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Sales orders"
        description="What customers have committed to, and how much of it has been billed."
        actions={
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SalesOrderStatus | '')}
            className="h-10 rounded-xl border border-border-control bg-surface px-3 text-sm text-ink"
          >
            <option value="">All statuses</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        }
      />

      {isError ? (
        <EmptyState
          title="Couldn't load sales orders"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          isLoading={isPending}
          getRowId={(row) => row.id}
          cardTitleKey="orderNumber"
          cardSubtitleKey="customerName"
          searchPlaceholder="Search order or customer…"
          emptyTitle="No sales orders yet"
          emptyDescription="An order is created when a quote is approved."
          emptyIcon={<PackageCheck className="size-8 text-ink-muted" />}
        />
      )}
    </>
  );
}
