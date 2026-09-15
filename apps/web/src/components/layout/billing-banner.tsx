'use client';

import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import { useSubscription } from '@/hooks/use-platform';

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

/**
 * Says so before writes stop, and says why once they have. Shown to everyone,
 * because everyone's saves start failing; only the billing page offers the fix.
 */
export function BillingBanner() {
  const { data: sub } = useSubscription();
  if (!sub) return null;

  if (sub.restricted) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger-soft/50 px-4 py-2 text-sm text-ink lg:px-6">
        <AlertTriangle className="size-4 text-danger" />
        <span>
          {sub.status === 'TRIALING'
            ? 'Your free trial has ended.'
            : sub.status === 'PAST_DUE'
              ? 'Your last payment failed.'
              : 'Your subscription is not active.'}{' '}
          You can still view everything, but changes are paused.
        </span>
        <Link href="/settings/billing" className="font-medium text-accent hover:underline">
          Fix billing
        </Link>
      </div>
    );
  }

  const warnAt = sub.status === 'TRIALING' || sub.status === 'PAST_DUE' ? sub.restrictsAt : null;
  if (warnAt && daysUntil(warnAt) <= 7) {
    const d = Math.max(0, daysUntil(warnAt));
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning-soft/40 px-4 py-2 text-sm text-ink lg:px-6">
        <Clock className="size-4 text-warning" />
        <span>
          {sub.status === 'TRIALING' ? 'Your trial ends' : 'Changes pause'} {d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}.
        </span>
        <Link href="/settings/billing" className="font-medium text-accent hover:underline">
          {sub.status === 'TRIALING' ? 'Choose a plan' : 'Update payment'}
        </Link>
      </div>
    );
  }
  return null;
}
