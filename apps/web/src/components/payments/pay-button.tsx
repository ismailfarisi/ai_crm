'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import type { CheckoutRedirectDto } from '@saas/shared';
import { publicCall } from './public-fetch';

/** Starts a hosted checkout and sends the customer there. */
export function PayButton({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await publicCall<CheckoutRedirectDto>(path, { method: 'POST' });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
        {label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
