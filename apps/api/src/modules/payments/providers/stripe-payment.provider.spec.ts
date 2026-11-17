import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { StripePaymentProvider } from './stripe-payment.provider';

const credentials = { secretKey: 'sk_test_tenant', webhookSecret: 'whsec_test_tenant' };

const sign = (body: string, t = Math.floor(Date.now() / 1000), key = credentials.webhookSecret) =>
  `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;

/** Stripe test-mode event shapes, trimmed to what the provider reads. */
const event = (type: string, object: Record<string, unknown>, id = 'evt_test_1') =>
  JSON.stringify({ id, object: 'event', livemode: false, type, data: { object } });

const session = (over: Record<string, unknown> = {}) => ({
  id: 'cs_test_a1',
  object: 'checkout.session',
  mode: 'payment',
  payment_status: 'paid',
  amount_total: 105000,
  currency: 'aed',
  client_reference_id: 'checkout-1',
  ...over,
});

describe('StripePaymentProvider', () => {
  const provider = new StripePaymentProvider(jest.fn());

  describe('parseWebhook', () => {
    const parse = (body: string, header = sign(body), creds = credentials) =>
      provider.parseWebhook(creds, Buffer.from(body), { 'stripe-signature': header });

    it('reads a paid checkout completion with the amount Stripe collected', () => {
      expect(parse(event('checkout.session.completed', session()))).toEqual({
        eventId: 'evt_test_1',
        type: 'checkout.session.completed',
        kind: 'PAID',
        sessionId: 'cs_test_a1',
        amountMinor: 105000,
        currency: 'AED',
      });
    });

    it('waits for the money on a bank debit that completed unpaid', () => {
      const body = event('checkout.session.completed', session({ payment_status: 'unpaid' }));
      expect(parse(body).kind).toBe('IGNORED');
      expect(parse(event('checkout.session.async_payment_succeeded', session())).kind).toBe('PAID');
    });

    it('treats failed and expired sessions as nothing paid', () => {
      expect(parse(event('checkout.session.async_payment_failed', session())).kind).toBe('FAILED');
      expect(parse(event('checkout.session.expired', session({ payment_status: 'unpaid' }))).kind).toBe(
        'EXPIRED',
      );
    });

    it('ignores event types it does not use', () => {
      expect(parse(event('charge.refunded', { id: 'ch_1' })).kind).toBe('IGNORED');
    });

    it('rejects a body altered after signing', () => {
      const body = event('checkout.session.completed', session());
      expect(() => parse(body.replace('105000', '1'), sign(body))).toThrow(UnauthorizedException);
    });

    it("rejects a signature made with another tenant's secret", () => {
      const body = event('checkout.session.completed', session());
      expect(() => parse(body, sign(body, undefined, 'whsec_other'))).toThrow(UnauthorizedException);
    });

    it('rejects a replay older than five minutes', () => {
      const body = event('checkout.session.completed', session());
      expect(() => parse(body, sign(body, Math.floor(Date.now() / 1000) - 600))).toThrow(/Stale/);
    });

    it('rejects everything when no webhook secret is saved', () => {
      const body = event('checkout.session.completed', session());
      expect(() => parse(body, sign(body), { secretKey: 'sk_test_tenant', webhookSecret: '' })).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('createCheckout', () => {
    const request = {
      reference: 'checkout-1',
      amountMinor: 105000,
      currency: 'AED',
      description: 'Deposit INV-0001',
      customerEmail: 'buyer@example.test',
      successUrl: 'https://app.test/q/tok?paid=1',
      cancelUrl: 'https://app.test/q/tok',
    };

    it("opens a one-off session with the tenant's key", async () => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'cs_test_a1', url: 'https://checkout.stripe.com/c/pay/cs_test_a1' }),
      });
      const stripe = new StripePaymentProvider(fetchImpl as unknown as typeof fetch);
      await expect(stripe.createCheckout(credentials, request)).resolves.toEqual({
        sessionId: 'cs_test_a1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_a1',
      });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect(init.headers.Authorization).toBe('Bearer sk_test_tenant');
      const form = new URLSearchParams(init.body);
      expect(form.get('mode')).toBe('payment');
      expect(form.get('line_items[0][price_data][currency]')).toBe('aed');
      expect(form.get('line_items[0][price_data][unit_amount]')).toBe('105000');
      expect(form.get('client_reference_id')).toBe('checkout-1');
      expect(form.get('customer_email')).toBe('buyer@example.test');
    });

    it("shows the customer a plain error, not Stripe's", async () => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid API Key provided: sk_test_***' } }),
      });
      const stripe = new StripePaymentProvider(fetchImpl as unknown as typeof fetch);
      await expect(stripe.createCheckout(credentials, request)).rejects.toThrow(
        'Online payment is not available right now. Please try again later.',
      );
    });

    it('refuses without a key', async () => {
      await expect(provider.createCheckout({}, request)).rejects.toThrow(BadRequestException);
    });
  });
});
