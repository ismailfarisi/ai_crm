'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Ban, CheckCircle, Clock, Download, History, Mail, Wallet, Undo2, Printer } from 'lucide-react';
import type { InvoiceDto, InvoiceStatus } from '@saas/shared';
import { PERMISSIONS, isInvoiceOverdue } from '@saas/shared';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { RowActionMenu, type RowMenuAction } from '@/components/documents/row-action-menu';
import { useCan } from '@/lib/session-context';
import { formatMoney } from '@/lib/utils';

interface InvoicesTableProps {
  invoices: InvoiceDto[];
  isLoading?: boolean;
  onRecordPayment?: (invoice: InvoiceDto) => void;
  onSend?: (invoice: InvoiceDto) => void;
  onDownload?: (invoice: InvoiceDto) => void;
  onPrint?: (invoice: InvoiceDto) => void;
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
  onPrint,
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
        // Sorts and filters on the document number, not the UUID behind it:
        // this column used to print `quoteId` raw, which is the only place in
        // the product a user was ever shown one.
        id: 'quoteNumber',
        accessorFn: (invoice) => invoice.quoteNumber ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quote" />,
        cell: ({ row }) => (
          <Link
            href={`/quotes/${row.original.quoteId}`}
            className="font-mono text-xs font-medium text-ink underline-offset-2 hover:underline"
          >
            {row.original.quoteNumber ?? 'Not yet numbered'}
          </Link>
        ),
      },
      {
        accessorKey: 'amount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
          <span className="font-medium tabular-nums text-ink">
            {formatMoney(row.original.amount || 0, row.original.currency)}
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

          // One visible action, the one that moves the invoice on. Everything
          // else, voiding included, is in the menu: a filled red button on
          // every unpaid row made the most destructive action the loudest.
          const more: RowMenuAction[] = [];
          if (onPrint) {
            more.push({ key: 'print', label: 'Preview and print', icon: Printer, onSelect: () => onPrint(invoice) });
          }
          if (onDownload) {
            more.push({ key: 'pdf', label: 'Download PDF', icon: Download, onSelect: () => onDownload(invoice) });
          }
          if (onViewHistory && (invoice.paidAmount ?? 0) > 0) {
            more.push({ key: 'history', label: 'Payment history', icon: History, onSelect: () => onViewHistory(invoice) });
          }
          if (canManage && onSend && invoice.status !== 'CANCELLED') {
            more.push({
              key: 'send',
              label: isSending ? 'Sending…' : 'Email to customer',
              icon: Mail,
              disabled: isSending || !invoice.customerEmail,
              hint: invoice.customerEmail ? undefined : 'The customer has no email address',
              onSelect: () => onSend(invoice),
            });
          }
          if (canCredit && onCredit && invoice.status !== 'CANCELLED') {
            more.push({
              key: 'credit',
              label: (invoice.creditedAmount ?? 0) > 0 ? 'Credits and refunds' : 'Credit or refund',
              icon: Undo2,
              onSelect: () => onCredit(invoice),
            });
          }
          if (canManage && onVoid && invoice.status !== 'CANCELLED' && !(invoice.creditedAmount ?? 0)) {
            more.push({ key: 'void', label: 'Void invoice', icon: Ban, tone: 'danger', onSelect: () => onVoid(invoice) });
          }

          return (
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
              {canManage && onRecordPayment && !isFinal && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Record payment on ${invoice.invoiceNumber}`}
                  onClick={() => onRecordPayment(invoice)}
                >
                  <Wallet className="size-3.5" aria-hidden />
                  Record payment
                </Button>
              )}
              <RowActionMenu actions={more} label={invoice.invoiceNumber} />
            </div>
          );
        },
      },
    ],
    [canManage, canCredit, onRecordPayment, onSend, onDownload, onPrint, onViewHistory, onVoid, onCredit, sendingId]
  );

  return (
    <DataTable
      columns={columns}
      data={invoices}
      isLoading={isLoading}
      getRowId={(row) => row.id}
      cardTitleKey="invoiceNumber"
      cardSubtitleKey="quoteNumber"
      enableRowSelection
      searchPlaceholder="Search invoices..."
      emptyTitle="No invoices found"
      emptyDescription="Invoices will automatically be generated when quotes are approved."
    />
  );
}
