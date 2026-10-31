'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import type { SubscriptionStatus } from '@saas/shared';
import { useBillingAction, usePlans, useSubscription } from '@/hooks/use-platform';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';

type BadgeTone = NonNullable<ComponentProps<typeof Badge>['tone']>;

const STATUS: Record<SubscriptionStatus, { label: string; tone: BadgeTone }> = {
  TRIALING: { label: 'Free trial', tone: 'info' },
  ACTIVE: { label: 'Active', tone: 'success' },
  PAST_DUE: { label: 'Payment failed', tone: 'danger' },
  CANCELED: { label: 'Cancelled', tone: 'neutral' },
  INCOMPLETE: { label: 'Awaiting payment', tone: 'warning' },
};

/** A card per DESIGN.md: solid surface, 1rem corners, hairline, Whisper. */
const CARD = 'rounded-2xl border border-border/60 bg-surface shadow-[0_2px_10px_rgba(0,0,0,0.015)]';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export function BillingView() {
  const params = useSearchParams();
  const { data: sub, isPending, isError, error } = useSubscription();
  const { data: plans = [] } = usePlans();
  const act = useBillingAction();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    const outcome = params.get('checkout');
    if (outcome === 'success') toast.success('Thanks — your payment is being confirmed');
    if (outcome === 'cancelled') toast.message('Checkout cancelled; nothing was charged');
  }, [params]);

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !sub) {
    return <EmptyState title="Couldn't load billing" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }

  const status = STATUS[sub.status];
  // One amber button on the page: choosing a plan, when there isn't a paid one
  // yet. Switching between paid plans is a sideways move, so it stays outline.
  const featuredPlanId = sub.status === 'ACTIVE' ? null : (plans.find((plan) => plan.purchasable)?.id ?? null);
  return (
    <>
      <PageHeader title="Billing" description="Your plan, seats, and what happens next." />

      <section className={`mb-6 px-6 py-5 ${CARD}`} aria-labelledby="current-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="current-heading" className="text-sm font-semibold tracking-tight text-ink">
              {sub.plan ? sub.plan.name : 'No plan chosen'}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {sub.activeUsers} active {sub.activeUsers === 1 ? 'user' : 'users'}
              {sub.plan && ` · billed for ${sub.seats} ${sub.seats === 1 ? 'seat' : 'seats'}`}
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {sub.status === 'TRIALING' && (
            <div>
              <dt className="text-xs text-ink-subtle">Trial ends</dt>
              <dd className="tabular-nums text-ink">{sub.enforced ? date(sub.trialEndsAt) : 'No limit'}</dd>
            </div>
          )}
          {sub.currentPeriodEnd && (
            <div>
              <dt className="text-xs text-ink-subtle">{sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</dt>
              <dd className="tabular-nums text-ink">{date(sub.currentPeriodEnd)}</dd>
            </div>
          )}
          {sub.pastDueSince && (
            <div>
              <dt className="text-xs text-ink-subtle">Payment failing since</dt>
              <dd className="tabular-nums text-danger">{date(sub.pastDueSince)}</dd>
            </div>
          )}
          {sub.restrictsAt && !sub.restricted && (
            <div>
              <dt className="text-xs text-ink-subtle">Changes pause on</dt>
              <dd className="tabular-nums text-ink">{date(sub.restrictsAt)}</dd>
            </div>
          )}
        </dl>
        {sub.restricted && (
          <p role="alert" className="mt-3 text-sm text-danger">
            Changes are paused for everyone in the organization until this is resolved. Viewing and exporting still work.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {sub.status === 'ACTIVE' && !sub.cancelAtPeriodEnd && (
            <Button variant="outline" size="sm" loading={act.isPending && act.variables?.kind === 'cancel'} onClick={() => setConfirmingCancel(true)}>
              Cancel at period end
            </Button>
          )}
          {sub.provider === 'fake' && sub.status === 'ACTIVE' && (
            <Button variant="ghost" size="sm" onClick={() => act.mutate({ kind: 'fakeFail' })}>
              Simulate a failed payment
            </Button>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => {
          const current = sub.plan?.id === plan.id && sub.status === 'ACTIVE';
          const monthly = plan.pricePerSeat * Math.max(1, sub.activeUsers);
          return (
            <section key={plan.id} className={`flex flex-col px-6 py-5 ${CARD}`} aria-labelledby={`plan-${plan.code}`}>
              <h3 id={`plan-${plan.code}`} className="text-sm font-semibold tracking-tight text-ink">
                {plan.name}
              </h3>
              {plan.description && <p className="mt-1 text-sm text-ink-muted">{plan.description}</p>}
              <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">
                {plan.pricePerSeat.toLocaleString(undefined, { style: 'currency', currency: plan.currency })}
                <span className="text-sm font-normal text-ink-subtle"> / seat / {plan.interval.toLowerCase()}</span>
              </p>
              <p className="text-xs text-ink-subtle">
                {monthly.toLocaleString(undefined, { style: 'currency', currency: plan.currency })} for your{' '}
                {Math.max(1, sub.activeUsers)} current {sub.activeUsers === 1 ? 'user' : 'users'}; seats follow active users.
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-muted">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-5"
                variant={plan.id === featuredPlanId ? 'primary' : 'outline'}
                disabled={current || !plan.purchasable}
                loading={act.isPending && act.variables?.kind === 'checkout' && act.variables.planCode === plan.code}
                onClick={() => act.mutate({ kind: 'checkout', planCode: plan.code })}
                title={plan.purchasable ? undefined : 'Not available for purchase yet'}
              >
                {current ? 'Current plan' : sub.status === 'ACTIVE' ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
              </Button>
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        onConfirm={() => act.mutateAsync({ kind: 'cancel' })}
        title={`Cancel ${sub.plan?.name ?? 'your plan'} at the end of this period?`}
        description={
          sub.currentPeriodEnd
            ? `It stays as it is until ${date(sub.currentPeriodEnd)}, then it doesn't renew and nothing more is charged.`
            : "It stays as it is until the period ends, then it doesn't renew and nothing more is charged."
        }
        confirmLabel="Cancel at period end"
        tone="danger"
      />
    </>
  );
}
