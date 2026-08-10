'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import type { Invoice, InvoiceStatus } from '@/hooks/use-invoices';

interface InvoicesTableProps {
  invoices: Invoice[];
  isLoading?: boolean;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === 'PAID') {
    return (
      <Badge tone="success" className="gap-1">
        <CheckCircle className="size-3" />
        Paid
      </Badge>
    );
  }
  return (
    <Badge tone="warning" className="gap-1">
      <Clock className="size-3" />
      Issued
    </Badge>
  );
}

export function InvoicesTable({ invoices, isLoading = false }: InvoicesTableProps) {
  const columns = useMemo<ColumnDef<Invoice, any>[]>(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Number" />,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-ink">{row.original.invoiceNumber}</span>
        ),
      },
      {
        accessorKey: 'quoteId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quote ID" />,
        cell: ({ row }) => (
          <Link
            href={`/quotes?id=${row.original.quoteId}`}
            className="font-mono text-xs text-brand hover:underline"
          >
            {row.original.quoteId}
          </Link>
        ),
      },
      {
        accessorKey: 'amount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            ${(row.original.amount || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'issuedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issued Date" />,
        cell: ({ row }) => {
          const dateStr = row.original.issuedAt
            ? new Date(row.original.issuedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : 'N/A';
          return <span className="text-ink-muted text-xs whitespace-nowrap">{dateStr}</span>;
        },
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={invoices}
      isLoading={isLoading}
      getRowId={(row) => row.id}
      cardTitleKey="invoiceNumber"
      cardSubtitleKey="quoteId"
      enableRowSelection
      searchPlaceholder="Search invoices..."
      emptyTitle="No invoices found"
      emptyDescription="Invoices will automatically be generated when quotes are approved."
    />
  );
}
