import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentEvent,
  TenantPaymentCredentials,
  TenantPaymentProvider,
} from './payment-provider';

/** Five minutes, as Stripe's own libraries allow. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

interface StripeCheckoutSession {
  id?: string;
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total?: number | null;
  currency?: string | null;
}

/**
 * Stripe Checkout with the tenant's own secret key, over the REST API. No
 * SDK, for the reason the subscription provider gives: two calls and a
 * signature check do not justify pinning an API version for the whole app.
 */
export class StripePaymentProvider implements TenantPaymentProvider {
  readonly name = 'STRIPE' as const;
  private readonly logger = new Logger(StripePaymentProvider.name);

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async createCheckout(
    credentials: TenantPaymentCredentials,
    request: CheckoutRequest,
  ): Promise<CheckoutSession> {
    if (!credentials.secretKey) {
      throw new BadRequestException('Online payment is not set up');
    }
    const form: Record<string, string> = {
      mode: 'payment',
      client_reference_id: request.reference,
      'metadata[kerf_checkout_id]': request.reference,
      'payment_intent_data[metadata][kerf_checkout_id]': request.reference,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': request.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(request.amountMinor),
      'line_items[0][price_data][product_data][name]':
        request.description.slice(0, 250),
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    };
    if (request.customerEmail) form.customer_email = request.customerEmail;

    const response = await this.fetchImpl(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form).toString(),
      },
    );
    const body = (await response.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!response.ok || !body.id || !body.url) {
      // Stripe's message can name the account; the customer sees a plain one.
      this.logger.warn(
        `Stripe checkout failed: ${body.error?.message ?? response.status}`,
      );
      throw new BadRequestException(
        'Online payment is not available right now. Please try again later.',
      );
    }
    return { sessionId: body.id, url: body.url };
  }

  parseWebhook(
    credentials: TenantPaymentCredentials,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): PaymentEvent {
    if (!credentials.webhookSecret) {
      throw new UnauthorizedException('No webhook secret is set');
    }
    verifyStripeSignature(
      rawBody,
      headers['stripe-signature'],
      credentials.webhookSecret,
    );

    const event = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      type: string;
      data?: { object?: StripeCheckoutSession };
    };
    const session = event.data?.object ?? {};
    const base = {
      eventId: event.id,
      type: event.type,
      sessionId: session.id ?? null,
      amountMinor: session.amount_total ?? null,
      currency: session.currency ? session.currency.toUpperCase() : null,
    };

    switch (event.type) {
      case 'checkout.session.completed':
        // Bank debits complete the session before the money arrives; those
        // are paid later by `async_payment_succeeded`.
        return {
          ...base,
          kind: session.payment_status === 'paid' ? 'PAID' : 'IGNORED',
        };
      case 'checkout.session.async_payment_succeeded':
        return { ...base, kind: 'PAID' };
      case 'checkout.session.async_payment_failed':
        return { ...base, kind: 'FAILED' };
      case 'checkout.session.expired':
        return { ...base, kind: 'EXPIRED' };
      default:
        return { ...base, kind: 'IGNORED' };
    }
  }
}

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | string[] | undefined,
  secret: string,
  nowSeconds = Date.now() / 1000,
): void {
  const signature = Array.isArray(header) ? header[0] : header;
  if (!signature) throw new UnauthorizedException('Missing signature');
  const parts = signature.split(',');
  const timestamp = Number(parts.find((p) => p.startsWith('t='))?.slice(2));
  if (
    !timestamp ||
    Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new UnauthorizedException('Stale or missing signature timestamp');
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const ok = parts
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3))
    .some(
      (c) =>
        c.length === expected.length &&
        timingSafeEqual(Buffer.from(c), Buffer.from(expected)),
    );
  if (!ok) throw new UnauthorizedException('Invalid signature');
}
