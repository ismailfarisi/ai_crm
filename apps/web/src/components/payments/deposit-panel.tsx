'use client';

import { CheckCircle2 } from 'lucide-react';
import type { PublicDepositDto } from '@saas/shared';
import { PayButton } from './pay-button';
import { money } from './public-fetch';
import { publicQuoteCopy, type PublicQuoteCopy } from '@/components/quotes/public-quote-copy';

/** On an accepted quote: the deposit invoice, and a way to pay it. */
export function DepositPanel({
  token,
  deposit,
  currency,
  copy = publicQuoteCopy('en'),
}: {
  token: string;
  deposit: PublicDepositDto;
  currency: string;
  /** Wording in the customer's document language. */
  copy?: PublicQuoteCopy;
}) {
  const justPaid =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('paid') === '1';

  return (
    <section
      aria-labelledby="deposit-heading"
      className="mt-4 rounded-2xl border border-line bg-surface-muted p-4"
    >
      <h2 id="deposit-heading" className="text-sm font-semibold text-ink">
        {deposit.label}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        {copy.label('depositInvoice', { number: deposit.invoiceNumber, amount: money(deposit.amount, currency) })}
      </p>
      <div className="mt-3">
        {deposit.paid ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-5" />
            {copy.label('depositPaid')}
          </p>
        ) : justPaid ? (
          <p className="text-sm text-ink-muted">{copy.label('paymentConfirming')}</p>
        ) : deposit.canPayOnline ? (
          <PayButton
            path={`payments/quotes/${encodeURIComponent(token)}/deposit-checkout`}
            label={copy.label('payDeposit', { amount: money(deposit.balanceDue, currency) })}
          />
        ) : (
          <p className="text-sm text-ink-muted">
            {copy.label('depositDue', { amount: money(deposit.balanceDue, currency) })}
          </p>
        )}
      </div>
    </section>
  );
}
