/**
 * Relay's own subscription billing, and in-app notifications.
 *
 * `org:manage_billing` has been in the permission catalog since the start and
 * implemented nowhere. A subscription is per organization, priced per seat,
 * with seats counted from active users rather than typed in — so nobody has
 * to remember to add a seat, and nobody can forget to remove one.
 */

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE';

export type BillingInterval = 'MONTH' | 'YEAR';

/** Days a failed payment is tolerated before the organization becomes read-only. */
export const DUNNING_GRACE_DAYS = 14;

export const TRIAL_DAYS = 14;

export interface PlanDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currency: string;
  /** Per seat, per interval. */
  pricePerSeat: number;
  interval: BillingInterval;
  trialDays: number;
  features: string[];
  /** False when the payment provider has no price configured for it. */
  purchasable: boolean;
}

export interface SubscriptionDto {
  status: SubscriptionStatus;
  plan: PlanDto | null;
  seats: number;
  /** Active users right now; differs from `seats` until the next sync. */
  activeUsers: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  /** When writes stop if nothing changes: end of trial, or end of the dunning grace. */
  restrictsAt: string | null;
  restricted: boolean;
  provider: 'fake' | 'stripe';
}

/**
 * Whether an organization may still change data.
 *
 * Reading is never blocked: a lapsed customer must still be able to see their
 * own records, export them, and reach the billing page. What stops is
 * writing, once a trial has run out with no subscription, or a failed payment
 * has gone unresolved past the grace period.
 */
export function billingRestriction(
  sub: { status: SubscriptionStatus; trialEndsAt: Date | null; pastDueSince: Date | null },
  now: Date = new Date(),
): { restricted: boolean; restrictsAt: Date | null; reason: string | null } {
  if (sub.status === 'ACTIVE') return { restricted: false, restrictsAt: null, reason: null };
  if (sub.status === 'TRIALING') {
    const at = sub.trialEndsAt;
    return at && at <= now
      ? { restricted: true, restrictsAt: at, reason: 'Your free trial has ended. Choose a plan to keep making changes.' }
      : { restricted: false, restrictsAt: at, reason: null };
  }
  if (sub.status === 'PAST_DUE') {
    const at = sub.pastDueSince ? new Date(sub.pastDueSince.getTime() + DUNNING_GRACE_DAYS * 86_400_000) : null;
    return at && at <= now
      ? { restricted: true, restrictsAt: at, reason: 'Your last payment failed and has not been resolved. Update your payment details to keep making changes.' }
      : { restricted: false, restrictsAt: at, reason: null };
  }
  return {
    restricted: true,
    restrictsAt: null,
    reason:
      sub.status === 'CANCELED'
        ? 'Your subscription has ended. Choose a plan to keep making changes.'
        : 'Your subscription has not been paid yet. Complete checkout to keep making changes.',
  };
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

export type NotificationType =
  | 'QUOTE_AWAITING_APPROVAL'
  | 'BILL_VARIANCE'
  | 'LOW_STOCK'
  | 'CREDIT_NOTE_AWAITING_APPROVAL'
  | 'PAYMENT_FAILED'
  | 'TRIAL_ENDING';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
