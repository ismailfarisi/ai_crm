'use client';

import { useState, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Bot, User, Check, X, FileText } from 'lucide-react';
import { QuoteStatusBadge } from '@/components/quotes/quote-status-badge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import type { Quote } from '@/hooks/use-quotes';

interface QuotesTableProps {
  quotes: Quote[];
  isLoading?: boolean;
  onSignal?: (id: string, action: 'APPROVE' | 'REJECT') => Promise<void>;
}

export function QuotesTable({ quotes, isLoading = false, onSignal }: QuotesTableProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<'APPROVE' | 'REJECT' | null>(null);

  const handleAction = async (id: string, action: 'APPROVE' | 'REJECT') => {
    if (!onSignal) return;
    setProcessingId(id);
    setProcessingAction(action);
    try {
      await onSignal(id, action);
    } finally {
      setProcessingId(null);
      setProcessingAction(null);
    }
  };

  const columns = useMemo<ColumnDef<Quote, any>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-ink">{row.original.title}</div>
            {row.original.prompt && (
              <div className="mt-0.5 text-xs text-ink-subtle line-clamp-1 max-w-xs">
                Prompt: &quot;{row.original.prompt}&quot;
              </div>
            )}
          </div>
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
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total Amount" />,
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            ${(row.original.totalAmount || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
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
          const isProcessing = processingId === quote.id;

          if (quote.status === 'AWAITING_APPROVAL' && onSignal) {
            return (
              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                <Button
                  size="sm"
                  variant="primary"
                  loading={isProcessing && processingAction === 'APPROVE'}
                  disabled={isProcessing}
                  onClick={() => handleAction(quote.id, 'APPROVE')}
                >
                  <Check className="size-3.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={isProcessing && processingAction === 'REJECT'}
                  disabled={isProcessing}
                  onClick={() => handleAction(quote.id, 'REJECT')}
                >
                  <X className="size-3.5" />
                  Reject
                </Button>
              </div>
            );
          }
          return <span className="text-xs text-ink-subtle">—</span>;
        },
      },
    ],
    [processingId, processingAction, onSignal]
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
