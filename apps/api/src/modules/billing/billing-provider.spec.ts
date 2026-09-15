import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { StripeBillingProvider } from './billing-provider';

const secret = 'whsec_test';
const provider = new StripeBillingProvider('sk_test', secret);

const sign = (body: string, t = Math.floor(Date.now() / 1000), key = secret) =>
  `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;

const event = (type: string, object: Record<string, unknown>) =>
  JSON.stringify({ id: 'evt_1', type, data: { object } });

describe('StripeBillingProvider.parseWebhook', () => {
  it('accepts a correctly signed checkout completion and normalises it', () => {
    const body = event('checkout.session.completed', {
      id: 'cs_1',
      client_reference_id: 'org-1',
      customer: 'cus_1',
      subscription: 'sub_1',
    });
    const parsed = provider.parseWebhook(Buffer.from(body), {
      'stripe-signature': sign(body),
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        type: 'checkout.completed',
        tenantId: 'org-1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        status: 'ACTIVE',
      }),
    );
  });

  it('rejects a body altered after signing', () => {
    const body = event('invoice.paid', { subscription: 'sub_1' });
    const header = sign(body);
    expect(() =>
      provider.parseWebhook(Buffer.from(body.replace('sub_1', 'sub_2')), {
        'stripe-signature': header,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a signature made with another secret', () => {
    const body = event('invoice.paid', {});
    expect(() =>
      provider.parseWebhook(Buffer.from(body), {
        'stripe-signature': sign(body, undefined, 'whsec_other'),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a replay older than five minutes, even correctly signed', () => {
    const body = event('invoice.paid', {});
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(() =>
      provider.parseWebhook(Buffer.from(body), {
        'stripe-signature': sign(body, old),
      }),
    ).toThrow(/Stale/);
  });

  it('rejects an unsigned request', () => {
    expect(() => provider.parseWebhook(Buffer.from('{}'), {})).toThrow(
      UnauthorizedException,
    );
  });

  it('maps subscription statuses, including unpaid as past due', () => {
    const body = event('customer.subscription.updated', {
      id: 'sub_1',
      status: 'unpaid',
      metadata: { tenantId: 'org-1' },
      current_period_end: 1893456000,
      cancel_at_period_end: true,
      items: { data: [{ quantity: 7 }] },
    });
    const parsed = provider.parseWebhook(Buffer.from(body), {
      'stripe-signature': sign(body),
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'PAST_DUE',
        seats: 7,
        cancelAtPeriodEnd: true,
        tenantId: 'org-1',
      }),
    );
  });
});
