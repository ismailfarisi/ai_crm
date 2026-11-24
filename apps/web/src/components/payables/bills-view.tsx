'use client';

import { useMemo, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ReceiptText } from 'lucide-react';
import {
  AGING_BUCKETS,
  PERMISSIONS,
  type AgingBucket,
  type BillStatus,
  type SupplierBillDto,
} from '@saas/shared';
import { useBillAging, useBills } from '@/hooks/use-bills';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { Can } from '@/components/auth/can';
import { CaptureBillFlow } from './capture-bill-flow';
import { formatDate } from '@/lib/utils';

type BadgeTone = NonNullable<ComponentProps<typeof Badge>['tone']>;

const STATUS_TONES: Record<BillStatus, BadgeTone> = {
  DRAFT: 'neutral',
  DISPUTED: 'danger',
  APPROVED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CANCELLED: 'neutral',
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
    <Badge tone={STATUS_TONES[status]} className={status === 'CANCELLED' ? 'line-through' : undefined}>
      {STATUS_LABELS[status]}
    </Badge>
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
  // Empty means today. A past date shows what was owed on that day.
  const [asOf, setAsOf] = useState('');
  // A date typed by hand passes through years like 0002 on the way to 2026.
  // The report waits for a real one rather than loading each of those.
  const [reportDate, setReportDate] = useState('');
  // While another date loads, `aging` is still the report for the last one.
  const { data: aging, isPlaceholderData: loadingDate } = useBillAging(reportDate || undefined);
  const pickAsOf = (value: string) => {
    setAsOf(value);
    if (value === '' || Number(value.slice(0, 4)) >= 1900) setReportDate(value);
  };

  const columns = useMemo<ColumnDef<SupplierBillDto, unknown>[]>(
    () => [
      {
        accessorKey: 'billNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill" />,
        cell: ({ row }) => (
          <Link href={`/purchasing/bills/${row.original.id}`} className="font-medium text-ink underline underline-offset-2">
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
              <Badge tone="warning" className="gap-1" title="Does not match its order">
                <AlertTriangle className="size-3" aria-hidden />
                Mismatch
              </Badge>
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
            {row.original.dueDate ? formatDate(row.original.dueDate) : '—'}
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
          <div className="flex flex-wrap items-center gap-2">
            <Can permission={PERMISSIONS.BILL_CREATE}>
              <CaptureBillFlow />
            </Can>
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
          </div>
        }
      />

      {aging && (aging.total !== 0 || (aging.staffClaimsTotal ?? 0) !== 0 || aging.difference !== 0 || asOf || reportDate) && (
        <section
          className={`mb-6 rounded border border-line bg-surface p-4 ${loadingDate ? 'opacity-60' : ''}`}
          aria-label="What is owed"
          aria-busy={loadingDate || undefined}
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">Owed to suppliers</h2>
            <div className="flex flex-wrap items-baseline gap-3">
              <label className="flex items-center gap-2 text-xs text-ink-subtle">
                As of
                <input
                  type="date"
                  aria-label="As of date"
                  value={asOf}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => pickAsOf(e.target.value)}
                  className="h-8 rounded border border-line bg-surface px-2 text-sm text-ink"
                />
              </label>
              <p className="text-lg font-semibold tabular-nums text-ink">{money(aging.total)}</p>
            </div>
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
          {reportDate && !loadingDate && (
            // The list further down is each bill as it stands today. For a
            // past date the bills owed on that day are these, at that day's balance.
            <div className="mt-3" data-testid="bills-owed-on-date">
              <h3 className="mb-1 text-xs font-medium text-ink-subtle">Bills owed on {reportDate}</h3>
              {aging.bills.length === 0 ? (
                <p className="text-sm text-ink-muted">No bill was owed on that day.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {aging.bills.map((bill) => (
                    <li key={bill.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                      <span className="text-ink">
                        {bill.billNumber} <span className="text-ink-muted">{bill.supplierName}</span>
                      </span>
                      <span className="flex items-baseline gap-3">
                        <span className="text-xs text-ink-subtle">{BUCKET_LABELS[bill.bucket]}</span>
                        <span className="tabular-nums font-medium text-ink">
                          {money(bill.outstanding)}
                          {bill.currency ? ` ${bill.currency}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-subtle">
                The list below shows each bill as it stands today, not on {reportDate}.
              </p>
            </div>
          )}
          {(aging.staffClaimsTotal ?? 0) !== 0 && (
            // Approved claims sit in the same payables account as supplier
            // bills until they are reimbursed, so the account is the two together.
            <p className="mt-3 text-sm text-ink-muted" data-testid="staff-claims-owed">
              Also owed to staff:{' '}
              <span className="font-medium tabular-nums text-ink">{money(aging.staffClaimsTotal ?? 0)}</span> on{' '}
              <Link href="/finance/expenses" className="underline underline-offset-2 hover:text-ink">
                {aging.staffClaims?.length === 1
                  ? `expense claim ${aging.staffClaims[0].claimNumber} (${aging.staffClaims[0].employeeName})`
                  : `${aging.staffClaims?.length ?? 0} approved expense claims`}
              </Link>{' '}
              awaiting reimbursement. With the bills above, the payables account holds {money(aging.ledgerBalance)}.
            </p>
          )}
          {aging.difference !== 0 && (
            // Bills and approved claims together should equal the account. When
            // they do not, something was posted to it that is neither.
            <p className="mt-3 flex items-center gap-2 text-sm text-danger" role="alert">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                {(aging.staffClaimsTotal ?? 0) !== 0
                  ? `Bills and approved expense claims total ${money(aging.total + (aging.staffClaimsTotal ?? 0))}`
                  : `Bills total ${money(aging.total)}`}{' '}
                but the payables account holds {money(aging.ledgerBalance)} — a difference of {money(aging.difference)}{' '}
                that needs looking into.
              </span>
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
