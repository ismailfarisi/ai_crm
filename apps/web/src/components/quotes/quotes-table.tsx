'use client';

import { useState } from 'react';
import { Bot, User, Check, X, FileText } from 'lucide-react';
import { QuoteStatusBadge } from '@/components/quotes/quote-status-badge';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
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

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!quotes || quotes.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="size-8" />}
        title="No quotes found"
        description="Get started by creating a new quote manually or using the AI agent."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-muted/50 text-xs font-medium text-ink-muted uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Created By</th>
            <th className="px-4 py-3">Items</th>
            <th className="px-4 py-3">Total Amount</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Created At</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {quotes.map((quote) => {
            const isProcessing = processingId === quote.id;
            const itemsCount = quote.items ? quote.items.length : 0;
            const formattedDate = quote.createdAt
              ? new Date(quote.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : 'N/A';

            return (
              <tr key={quote.id} className="transition-colors hover:bg-surface-muted/30">
                <td className="px-4 py-3.5 font-medium text-ink">
                  <div>{quote.title}</div>
                  {quote.prompt && (
                    <div className="mt-0.5 text-xs text-ink-subtle line-clamp-1 max-w-xs">
                      Prompt: &quot;{quote.prompt}&quot;
                    </div>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  {quote.createdBy === 'AI' ? (
                    <Badge tone="brand" className="gap-1">
                      <Bot className="size-3" />
                      AI
                    </Badge>
                  ) : (
                    <Badge tone="neutral" className="gap-1">
                      <User className="size-3" />
                      Human
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3.5 text-ink-muted">
                  {itemsCount} {itemsCount === 1 ? 'item' : 'items'}
                </td>
                <td className="px-4 py-3.5 font-medium text-ink">
                  ${(quote.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3.5">
                  <QuoteStatusBadge status={quote.status} />
                </td>
                <td className="px-4 py-3.5 text-ink-muted text-xs whitespace-nowrap">
                  {formattedDate}
                </td>
                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                  {quote.status === 'AWAITING_APPROVAL' && onSignal ? (
                    <div className="flex items-center justify-end gap-1.5">
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
                  ) : (
                    <span className="text-xs text-ink-subtle">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
