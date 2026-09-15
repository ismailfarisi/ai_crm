'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Ban, CheckCircle, Clock, Download, History, Mail, Wallet, Undo2 } from 'lucide-react';
import type { InvoiceDto, InvoiceStatus } from '@saas/shared';
import { PERMISSIONS, isInvoiceOverdue } from '@saas/shared';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { useCan } from '@/lib/session-context';

interface InvoicesTableProps {
  invoices: InvoiceDto[];
  isLoading?: boolean;
  onRecordPayment?: (invoice: InvoiceDto) => void;
  onSend?: (invoice: InvoiceDto) => void;
  onDownload?: (invoice: InvoiceDto) => void;
  onViewHistory?: (invoice: InvoiceDto) => void;
  onVoid?: (invoice: InvoiceDto) => void;
  onCredit?: (invoice: InvoiceDto) => void;
  sendingId?: string | null;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  switch (status) {
    case 'PAID':
      return (
        <Badge tone="success" className="gap-1">
          <CheckCircle className="size-3" />
          Paid
        </Badge>
      );
    case 'PARTIALLY_PAID':
      return (
        <Badge tone="info" className="gap-1">
          <Clock className="size-3" />
          Partially Paid
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge tone="neutral" className="gap-1">
          <Ban className="size-3" />
          Voided
        </Badge>
      );
    default:
      return (
        <Badge tone="warning" className="gap-1">
          <Clock className="size-3" />
          Issued
        </Badge>
      );
  }
}

export function InvoicesTable({
  invoices,
  isLoading = false,
  onRecordPayment,
  onSend,
  onDownload,
  onViewHistory,
  onVoid,
  onCredit,
  sendingId = null,
}: InvoicesTableProps) {
  const canManage = useCan({ permission: PERMISSIONS.INVOICE_MANAGE });
  const canCredit = useCan({ permission: PERMISSIONS.CREDIT_NOTE_READ });

  const columns = useMemo<ColumnDef<InvoiceDto>[]>(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Number" />,
        cell: ({ row }) => (
          <div>
            <span className="font-mono font-medium text-ink">{row.original.invoiceNumber}</span>
            {row.original.stageLabel && (
              <p className="text-xs text-ink-subtle">{row.original.stageLabel}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'customerName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
        cell: ({ row }) => <span className="text-ink font-medium">{row.original.customerName}</span>,
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
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <InvoiceStatusBadge status={row.original.status} />
            {isInvoiceOverdue(row.original) && (
              <Badge tone="danger" className="gap-1">
                <AlertTriangle className="size-3" />
                Overdue
              </Badge>
            )}
          </div>
        ),
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
      {
        id: 'actions',
        cell: ({ row }) => {
          const invoice = row.original;
          const isFinal = invoice.status === 'PAID' || invoice.status === 'CANCELLED';
          const isSending = sendingId === invoice.id;

          return (
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
              {onDownload && (
                <Button size="sm" variant="ghost" onClick={() => onDownload(invoice)}>
                  <Download className="size-3.5" />
                </Button>
              )}
              {onViewHistory && (invoice.paidAmount ?? 0) > 0 && (
                <Button size="sm" variant="ghost" onClick={() => onViewHistory(invoice)}>
                  <History className="size-3.5" />
                </Button>
              )}
              {canManage && onSend && invoice.status !== 'CANCELLED' && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={isSending}
                  disabled={isSending || !invoice.customerEmail}
                  title={invoice.customerEmail ? undefined : 'Invoice has no customer email'}
                  onClick={() => onSend(invoice)}
                >
                  <Mail className="size-3.5" />
                </Button>
              )}
              {canManage && onRecordPayment && !isFinal && (
                <Button size="sm" variant="primary" onClick={() => onRecordPayment(invoice)}>
                  <Wallet className="size-3.5" />
                  Record Payment
                </Button>
              )}
              {canCredit && onCredit && invoice.status !== 'CANCELLED' && (
                <Button size="sm" variant="ghost" onClick={() => onCredit(invoice)} title="Credits and refunds">
                  <Undo2 className="size-3.5" />
                  {(invoice.creditedAmount ?? 0) > 0 ? 'Credits' : 'Credit'}
                </Button>
              )}
              {canManage && onVoid && invoice.status !== 'CANCELLED' && !(invoice.creditedAmount ?? 0) && (
                <Button size="sm" variant="danger" onClick={() => onVoid(invoice)}>
                  <Ban className="size-3.5" />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [canManage, canCredit, onRecordPayment, onSend, onDownload, onViewHistory, onVoid, onCredit, sendingId]
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
