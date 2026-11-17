'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { fromMinorUnits } from '@saas/shared';
import { money, publicCall } from './public-fetch';

/** Only follows a return address back into this app. */
const safeReturn = (url: string | undefined) => {
  if (!url) return '/';
  try {
    return new URL(url).origin === window.location.origin ? url : '/';
  } catch {
    return '/';
  }
};

/**
 * Stands in for the provider's hosted checkout in development and staging.
 * The API refuses to complete it wherever the test checkout is switched off.
 */
export function TestCheckout(props: {
  session: string;
  amount: number;
  currency: string;
  description: string;
  success?: string;
  cancel?: string;
}) {
  const [busy, setBusy] = useState<'PAID' | 'EXPIRED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = async (outcome: 'PAID' | 'EXPIRED') => {
    setBusy(outcome);
    setError(null);
    try {
      await publicCall(`payments/fake/${encodeURIComponent(props.session)}/complete`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
      });
      window.location.assign(safeReturn(outcome === 'PAID' ? props.success : props.cancel));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-surface-muted px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-surface px-6 py-5 shadow-[0_2px_10px_rgba(0,0,0,0.015)]">
        <p className="mb-1 text-xs font-medium text-warning">Test checkout. No card is charged.</p>
        <h1 className="text-xl font-semibold text-ink">{props.description}</h1>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
          {money(fromMinorUnits(props.amount, props.currency), props.currency)}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || !props.session}
            onClick={() => void finish('PAID')}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
          >
            {busy === 'PAID' ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            Pay
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void finish('EXPIRED')}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-5 py-2 text-sm font-medium text-ink disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}
