'use client';

import type { ComponentProps } from 'react';
import type { QuoteDepositStatusDto } from '@saas/shared';
import { useQuoteDeposit } from '@/hooks/use-online-payments';
import { Badge } from '@/components/ui/primitives';
import { formatCurrency } from './quote-lines-table';

type Tone = NonNullable<ComponentProps<typeof Badge>['tone']>;

export function depositState(deposit: QuoteDepositStatusDto): { label: string; tone: Tone } {
  if (deposit.invoiceStatus === 'CANCELLED') return { label: 'Voided', tone: 'neutral' };
  if (deposit.balanceDue <= 0) {
    return { label: deposit.paidOnline > 0 ? 'Paid online' : 'Paid', tone: 'success' };
  }
  if (deposit.paidAmount > 0) return { label: 'Part paid', tone: 'warning' };
  if (deposit.lastCheckoutStatus === 'OPEN') return { label: 'Checkout started', tone: 'info' };
  if (deposit.lastCheckoutStatus === 'FAILED') return { label: 'Payment failed', tone: 'danger' };
  return { label: 'Awaiting payment', tone: 'warning' };
}

/** On an accepted quote: the deposit invoice and whether it has been paid. */
export function QuoteDepositStatus({ quoteId, currency }: { quoteId: string; currency: string }) {
  const { data: deposit } = useQuoteDeposit(quoteId, true);
  if (!deposit) return null;
  const state = depositState(deposit);
  return (
    <section
      aria-labelledby="deposit-status-title"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/40 bg-surface p-4 shadow-2xs"
    >
      <h2 id="deposit-status-title" className="text-sm font-semibold text-ink">
        {deposit.label}
      </h2>
      <span className="text-sm text-ink-muted">
        {deposit.invoiceNumber} · {formatCurrency(deposit.amount, currency)}
      </span>
      <Badge tone={state.tone} className="ms-auto">
        {state.label}
      </Badge>
    </section>
  );
}
