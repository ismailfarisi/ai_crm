'use client';

import Link from 'next/link';
import { Receipt, CheckCircle, Clock } from 'lucide-react';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
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

  if (!invoices || invoices.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="size-8" />}
        title="No invoices found"
        description="Invoices will automatically be generated when quotes are approved."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-muted/50 text-xs font-medium text-ink-muted uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Invoice Number</th>
            <th className="px-4 py-3">Quote ID</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Issued Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {invoices.map((invoice) => {
            const formattedDate = invoice.issuedAt
              ? new Date(invoice.issuedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : 'N/A';

            return (
              <tr key={invoice.id} className="transition-colors hover:bg-surface-muted/30">
                <td className="px-4 py-3.5 font-mono font-medium text-ink">
                  {invoice.invoiceNumber}
                </td>
                <td className="px-4 py-3.5">
                  <Link
                    href={`/quotes?id=${invoice.quoteId}`}
                    className="font-mono text-xs text-brand hover:underline"
                  >
                    {invoice.quoteId}
                  </Link>
                </td>
                <td className="px-4 py-3.5 font-medium text-ink">
                  ${(invoice.amount || 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td className="px-4 py-3.5">
                  <InvoiceStatusBadge status={invoice.status} />
                </td>
                <td className="px-4 py-3.5 text-ink-muted text-xs whitespace-nowrap">
                  {formattedDate}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
