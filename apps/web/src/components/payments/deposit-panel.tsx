'use client';

import { CheckCircle2 } from 'lucide-react';
import type { PublicDepositDto } from '@saas/shared';
import { PayButton } from './pay-button';
import { money } from './public-fetch';

/** On an accepted quote: the deposit invoice, and a way to pay it. */
export function DepositPanel({
  token,
  deposit,
  currency,
}: {
  token: string;
  deposit: PublicDepositDto;
  currency: string;
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
        Invoice {deposit.invoiceNumber} · {money(deposit.amount, currency)}
      </p>
      <div className="mt-3">
        {deposit.paid ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-5" />
            Deposit paid. Thank you.
          </p>
        ) : justPaid ? (
          <p className="text-sm text-ink-muted">Thank you. Your payment is being confirmed.</p>
        ) : deposit.canPayOnline ? (
          <PayButton
            path={`payments/quotes/${encodeURIComponent(token)}/deposit-checkout`}
            label={`Pay deposit ${money(deposit.balanceDue, currency)}`}
          />
        ) : (
          <p className="text-sm text-ink-muted">
            {money(deposit.balanceDue, currency)} is due before work starts. The invoice has the payment details.
          </p>
        )}
      </div>
    </section>
  );
}
