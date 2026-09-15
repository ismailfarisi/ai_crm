import { describe, expect, it } from 'vitest';
import { billingRestriction, DUNNING_GRACE_DAYS } from './subscriptions';

const now = new Date('2026-09-20T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe('billingRestriction', () => {
  it('never restricts an active subscription', () => {
    expect(
      billingRestriction({ status: 'ACTIVE', trialEndsAt: days(-100), pastDueSince: days(-100) }, now).restricted,
    ).toBe(false);
  });

  it('lets a trial run to its end, then restricts writes', () => {
    expect(billingRestriction({ status: 'TRIALING', trialEndsAt: days(1), pastDueSince: null }, now)).toEqual(
      expect.objectContaining({ restricted: false, restrictsAt: days(1) }),
    );
    expect(
      billingRestriction({ status: 'TRIALING', trialEndsAt: days(-1), pastDueSince: null }, now).restricted,
    ).toBe(true);
  });

  it('gives a failed payment the grace period before restricting', () => {
    const inside = billingRestriction(
      { status: 'PAST_DUE', trialEndsAt: null, pastDueSince: days(-(DUNNING_GRACE_DAYS - 1)) },
      now,
    );
    const past = billingRestriction(
      { status: 'PAST_DUE', trialEndsAt: null, pastDueSince: days(-(DUNNING_GRACE_DAYS + 1)) },
      now,
    );
    expect(inside.restricted).toBe(false);
    expect(past.restricted).toBe(true);
    expect(past.reason).toMatch(/payment failed/);
  });

  it('restricts a cancelled or never-paid subscription', () => {
    expect(billingRestriction({ status: 'CANCELED', trialEndsAt: null, pastDueSince: null }, now).restricted).toBe(true);
    expect(billingRestriction({ status: 'INCOMPLETE', trialEndsAt: null, pastDueSince: null }, now).restricted).toBe(true);
  });
});
