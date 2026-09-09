'use client';

import { Receipt } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import type { InvoiceDto } from '@saas/shared';
import { useInvoicePayments } from '@/hooks/use-invoices';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { formatFinanceCurrency } from '../finance/dashboard/treasury-stat-cards';

export interface InvoicePaymentsModalProps {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceDto | null;
}

export function InvoicePaymentsModal({ open, onClose, invoice }: InvoicePaymentsModalProps) {
  const { data: payments = [], isLoading } = useInvoicePayments(invoice?.id ?? null, open);
  const { data: accounts = [] } = useFinanceAccounts();

  if (!invoice) return null;

  const accountName = (accountId?: string | null) =>
    accounts.find((a) => a.id === accountId)?.name ?? '—';

  const remaining = invoice.amount - (invoice.paidAmount ?? 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Payment History — Invoice ${invoice.invoiceNumber}`}
      description="Every payment recorded against this invoice, most recent first."
      size="md"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-border/40 bg-surface-muted/40 p-3 text-xs">
          <div>
            <p className="text-ink-subtle">Total</p>
            <p className="font-mono font-semibold text-ink">
              {formatFinanceCurrency(invoice.amount, invoice.currency)}
            </p>
          </div>
          <div>
            <p className="text-ink-subtle">Paid</p>
            <p className="font-mono font-semibold text-ink">
              {formatFinanceCurrency(invoice.paidAmount ?? 0, invoice.currency)}
            </p>
          </div>
          <div>
            <p className="text-ink-subtle">Remaining</p>
            <p className="font-mono font-semibold text-ink">
              {formatFinanceCurrency(remaining, invoice.currency)}
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-ink-muted">Loading payment history…</p>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-ink-muted">
            <Receipt className="size-6" />
            <p className="text-sm">No payments recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border/30">
            <div className="grid grid-cols-12 border-b border-border/30 bg-surface-muted/60 px-3 py-2 text-[11px] font-bold text-ink-subtle">
              <span className="col-span-3">Date</span>
              <span className="col-span-3 text-right">Amount</span>
              <span className="col-span-3">Account</span>
              <span className="col-span-3">Notes</span>
            </div>
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="grid grid-cols-12 items-center border-b border-border/20 px-3 py-2 text-xs last:border-b-0"
              >
                <span className="col-span-3 text-ink-muted">
                  {new Date(payment.paidAt).toLocaleDateString()}
                </span>
                <span className="col-span-3 text-right font-mono font-semibold text-ink">
                  {formatFinanceCurrency(payment.amount, invoice.currency)}
                </span>
                <span className="col-span-3 truncate text-ink">{accountName(payment.accountId)}</span>
                <span className="col-span-3 truncate text-ink-subtle">{payment.notes || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
