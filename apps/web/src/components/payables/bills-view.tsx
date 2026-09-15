'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ReceiptText } from 'lucide-react';
import {
  AGING_BUCKETS,
  type AgingBucket,
  type BillStatus,
  type SupplierBillDto,
} from '@saas/shared';
import { useBillAging, useBills } from '@/hooks/use-bills';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';

const STATUS_STYLES: Record<BillStatus, string> = {
  DRAFT: 'bg-surface-sunk text-ink-muted',
  DISPUTED: 'bg-danger-soft text-danger',
  APPROVED: 'bg-accent-soft text-accent',
  PARTIALLY_PAID: 'bg-warning-soft text-warning',
  PAID: 'bg-success-soft text-success',
  CANCELLED: 'bg-surface-sunk text-ink-subtle line-through',
};

const STATUS_LABELS: Record<BillStatus, string> = {
  DRAFT: 'Draft',
  DISPUTED: 'Disputed',
  APPROVED: 'Approved',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

export function BillStatusPill({ status }: { status: BillStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: 'Not yet due',
  DAYS_1_30: '1–30 days',
  DAYS_31_60: '31–60 days',
  DAYS_61_90: '61–90 days',
  DAYS_OVER_90: 'Over 90 days',
};

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BillsView() {
  const [status, setStatus] = useState<BillStatus | ''>('');
  const { data, isPending, isError, error } = useBills({ page: 1, limit: 100, ...(status ? { status } : {}) });
  const { data: aging } = useBillAging();

  const columns = useMemo<ColumnDef<SupplierBillDto, unknown>[]>(
    () => [
      {
        accessorKey: 'billNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill" />,
        cell: ({ row }) => (
          <Link href={`/purchasing/bills/${row.original.id}`} className="font-medium text-accent hover:underline">
            {row.original.billNumber}
          </Link>
        ),
      },
      {
        accessorKey: 'supplierName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
        cell: ({ row }) => (
          <div>
            <p className="text-ink">{row.original.supplierName}</p>
            <p className="text-xs text-ink-subtle">Their ref {row.original.supplierInvoiceNumber}</p>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <BillStatusPill status={row.original.status} />
            {row.original.matchStatus === 'VARIANCE' && row.original.status === 'DRAFT' && (
              <span title="Does not match its order" className="text-warning">
                <AlertTriangle className="size-3.5" />
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'totalAmount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
        cell: ({ row }) => <span className="tabular-nums text-ink">{money(row.original.totalAmount)}</span>,
      },
      {
        id: 'outstanding',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Outstanding" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink-muted">
            {money(row.original.totalAmount - row.original.paidAmount)}
          </span>
        ),
      },
      {
        accessorKey: 'dueDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
        cell: ({ row }) => (
          <span className="text-xs text-ink-muted whitespace-nowrap">
            {row.original.dueDate ? new Date(row.original.dueDate).toLocaleDateString() : '—'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Supplier bills"
        description="What suppliers say they are owed, checked against what was ordered and received."
        actions={
          <select
            id="bill-status-filter"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value as BillStatus | '')}
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

      {aging && aging.total > 0 && (
        <section className="mb-6 rounded border border-line bg-surface p-4" aria-label="What is owed">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">Owed to suppliers</h2>
            <p className="text-lg font-semibold tabular-nums text-ink">{money(aging.total)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {AGING_BUCKETS.map((bucket) => (
              <div key={bucket} className="rounded bg-surface-sunk px-3 py-2">
                <dt className="text-xs text-ink-subtle">{BUCKET_LABELS[bucket]}</dt>
                <dd
                  className={`tabular-nums text-sm font-medium ${
                    bucket !== 'CURRENT' && aging.buckets[bucket] > 0 ? 'text-danger' : 'text-ink'
                  }`}
                >
                  {money(aging.buckets[bucket])}
                </dd>
              </div>
            ))}
          </dl>
          {aging.difference !== 0 && (
            // Should never show. If it does, a bill and its journal entry have come apart.
            <p className="mt-3 flex items-center gap-2 text-sm text-danger">
              <AlertTriangle className="size-4" />
              Bills total {money(aging.total)} but the payables account holds {money(aging.ledgerBalance)} — a
              difference of {money(aging.difference)} that needs looking into.
            </p>
          )}
        </section>
      )}

      {isError ? (
        <EmptyState title="Couldn't load bills" description={error instanceof Error ? error.message : 'Please try again.'} />
      ) : (
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isPending}
          getRowId={(row) => row.id}
          cardTitleKey="billNumber"
          cardSubtitleKey="supplierName"
          searchPlaceholder="Search bill or supplier…"
          emptyTitle="No bills yet"
          emptyDescription="Enter one from a purchase order once its goods have arrived."
          emptyIcon={<ReceiptText className="size-8 text-ink-muted" />}
        />
      )}
    </>
  );
}
