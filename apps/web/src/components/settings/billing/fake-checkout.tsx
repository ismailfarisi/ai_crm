'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { useBillingAction, usePlans } from '@/hooks/use-platform';
import { Button } from '@/components/ui/button';

/**
 * Stands in for the payment provider's checkout page in development and
 * staging. The API refuses to complete it anywhere simulated checkout is not
 * switched on, so reaching this page in production changes nothing.
 */
export function FakeCheckout() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: plans = [] } = usePlans();
  const act = useBillingAction();
  const session = params.get('session') ?? '';
  const plan = plans.find((p) => p.code === params.get('plan'));
  const seats = Number(params.get('seats') ?? 1);

  return (
    <div className="mx-auto max-w-md rounded-lg border border-line bg-surface p-6">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-warning">Test checkout — no card is charged</p>
      <h1 className="text-xl font-semibold text-ink">{plan ? plan.name : 'Subscription'}</h1>
      {plan && (
        <p className="mt-2 text-sm text-ink-muted">
          {seats} {seats === 1 ? 'seat' : 'seats'} ×{' '}
          {plan.pricePerSeat.toLocaleString(undefined, { style: 'currency', currency: plan.currency })} ={' '}
          <strong className="text-ink">
            {(plan.pricePerSeat * seats).toLocaleString(undefined, { style: 'currency', currency: plan.currency })}
          </strong>{' '}
          per {plan.interval.toLowerCase()}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <Button
          loading={act.isPending}
          disabled={!session}
          onClick={() =>
            act.mutate({ kind: 'fakeComplete', session }, { onSuccess: () => router.push('/settings/billing?checkout=success') })
          }
        >
          <CreditCard className="size-4" />
          Pay
        </Button>
        <Button variant="secondary" onClick={() => router.push('/settings/billing?checkout=cancelled')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
