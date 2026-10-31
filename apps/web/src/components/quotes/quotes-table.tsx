'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { Bot, User, Check, X, FileText, Download, Printer } from 'lucide-react';
import { QuoteStatusBadge } from '@/components/quotes/quote-status-badge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { type Quote, useDownloadQuotePdf } from '@/hooks/use-quotes';
import { formatMoney } from '@/lib/utils';

interface QuotesTableProps {
  quotes: Quote[];
  isLoading?: boolean;
  /**
   * Opens the approve or reject confirmation. The row never signals on its
   * own: a decision is always made looking at the total and the margin.
   */
  onDecide?: (quote: Quote, action: 'APPROVE' | 'REJECT') => void;
  onPrint?: (quote: Quote) => void;
}

export function QuotesTable({ quotes, isLoading = false, onDecide, onPrint }: QuotesTableProps) {
  const downloadPdf = useDownloadQuotePdf();

  const columns = useMemo<ColumnDef<Quote, any>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        cell: ({ row }) => (
          <div>
            <Link
              href={`/quotes/${row.original.id}`}
              className="font-medium text-ink hover:underline underline-offset-2 inline-flex items-center gap-1.5"
            >
              {row.original.quoteNumber && (
                <span className="font-mono text-[11px] text-ink-muted bg-surface-muted/60 px-2 py-0.5 rounded-full border border-border/40">
                  {row.original.quoteNumber}
                </span>
              )}
              <span>{row.original.title}</span>
            </Link>
            {row.original.prompt && (
              <div className="mt-0.5 text-xs text-ink-subtle line-clamp-1 max-w-xs">
                Prompt: &quot;{row.original.prompt}&quot;
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'customerName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
        cell: ({ row }) => (
          <span className="text-ink font-medium">
            {row.original.customerName || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'createdBy',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
        cell: ({ row }) =>
          row.original.createdBy === 'AI' ? (
            <Badge tone="brand" className="gap-1">
              <Bot className="size-3" />
              AI
            </Badge>
          ) : (
            <Badge tone="neutral" className="gap-1">
              <User className="size-3" />
              Human
            </Badge>
          ),
      },
      {
        id: 'items',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Items" />,
        cell: ({ row }) => {
          const itemsCount = row.original.items ? row.original.items.length : 0;
          return (
            <span className="text-ink-muted">
              {itemsCount} {itemsCount === 1 ? 'item' : 'items'}
            </span>
          );
        },
      },
      {
        accessorKey: 'totalAmount',
        sortingFn: (rowA, rowB) => (Number(rowA.original.totalAmount) || 0) - (Number(rowB.original.totalAmount) || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total Amount" />,
        cell: ({ row }) => (
          <span className="font-medium tabular-nums text-ink">
            {formatMoney(Number(row.original.totalAmount) || 0, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <QuoteStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created At" />,
        cell: ({ row }) => {
          const formattedDate = row.original.createdAt
            ? new Date(row.original.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : 'N/A';
          return <span className="text-ink-muted text-xs whitespace-nowrap">{formattedDate}</span>;
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const quote = row.original;
          const label = quote.quoteNumber || quote.title || 'quote';

          return (
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
              {onPrint && (
                <button
                  type="button"
                  onClick={() => onPrint(quote)}
                  title="Print / Preview"
                  className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                  aria-label={`Print preview for ${quote.quoteNumber || 'quote'}`}
                >
                  <Printer className="size-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() => downloadPdf(quote)}
                title="Download PDF"
                className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                aria-label={`Download PDF for ${quote.quoteNumber || 'quote'}`}
              >
                <Download className="size-4" />
              </button>

              {/* Outline, not amber: a list of quotes would otherwise be a column of primary buttons. */}
              {quote.status === 'AWAITING_APPROVAL' && onDecide && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Approve ${label}`}
                    onClick={() => onDecide(quote, 'APPROVE')}
                  >
                    <Check className="size-3.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    aria-label={`Reject ${label}`}
                    onClick={() => onDecide(quote, 'REJECT')}
                  >
                    <X className="size-3.5" />
                    Reject
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [onDecide, downloadPdf, onPrint]
  );

  return (
    <DataTable
      columns={columns}
      data={quotes}
      isLoading={isLoading}
      getRowId={(row) => row.id}
      cardTitleKey="title"
      cardSubtitleKey="status"
      enableRowSelection
      searchPlaceholder="Search quotes..."
      emptyTitle="No quotes found"
      emptyDescription="Get started by creating a new quote manually or using the AI agent."
      emptyIcon={<FileText className="size-8 text-ink-muted" />}
    />
  );
}
