import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SubscriptionStatus } from '@saas/shared';

/**
 * What billing needs from a payment provider, and nothing more.
 *
 * Every provider event is normalised into `ProviderEvent` before the billing
 * service sees it, so subscription state changes in exactly one place however
 * the news arrived.
 */
export interface ProviderEvent {
  id: string;
  type:
    | 'checkout.completed'
    | 'subscription.updated'
    | 'subscription.deleted'
    | 'payment.failed'
    | 'payment.succeeded'
    | 'ignored';
  tenantId: string | null;
  checkoutId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  status?: SubscriptionStatus;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  seats?: number;
  raw: Record<string, unknown>;
}

export interface BillingProvider {
  readonly name: 'fake' | 'stripe';
  createCheckout(input: {
    tenantId: string;
    planCode: string;
    priceId: string | null;
    seats: number;
    customerEmail: string;
    customerId: string | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutId: string; url: string }>;
  updateSeats(subscriptionId: string, seats: number): Promise<void>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
  /** Verifies the payload came from the provider, then normalises it. */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent;
}

/**
 * A provider for development and staging: checkout is a page in this app,
 * and "paying" is pressing a button that emits the event Stripe would.
 */
export class FakeBillingProvider implements BillingProvider {
  readonly name = 'fake' as const;

  constructor(private readonly webOrigin: string) {}

  createCheckout(input: {
    tenantId: string;
    planCode: string;
    seats: number;
  }): Promise<{ checkoutId: string; url: string }> {
    const checkoutId = `fake_cs_${randomBytes(12).toString('hex')}`;
    return Promise.resolve({
      checkoutId,
      url: `${this.webOrigin}/settings/billing/checkout?session=${checkoutId}&plan=${encodeURIComponent(input.planCode)}&seats=${input.seats}`,
    });
  }

  async updateSeats(): Promise<void> {}
  async cancelAtPeriodEnd(): Promise<void> {}

  parseWebhook(): ProviderEvent {
    throw new BadRequestException('The fake billing provider has no webhook');
  }
}

/** The fields of Stripe's checkout session, subscription and invoice objects that billing reads. */
interface StripeObject {
  id?: string;
  client_reference_id?: string | null;
  customer?: string | null;
  subscription?: string | null;
  status?: string;
  metadata?: { tenantId?: string } | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  items?: { data?: { quantity?: number }[] };
}

const STRIPE_STATUS: Record<string, SubscriptionStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  canceled: 'CANCELED',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELED',
  paused: 'PAST_DUE',
};

/**
 * Stripe over its REST API. No SDK: four calls and a signature check do not
 * justify a dependency that pins an API version for the whole app.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  private readonly logger = new Logger(StripeBillingProvider.name);

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const body = (await response.json()) as T & {
      error?: { message?: string };
    };
    if (!response.ok) {
      this.logger.warn(
        `Stripe ${method} ${path} failed: ${body.error?.message ?? response.status}`,
      );
      throw new BadRequestException(
        body.error?.message ?? 'The payment provider refused the request',
      );
    }
    return body;
  }

  async createCheckout(
    input: Parameters<BillingProvider['createCheckout']>[0],
  ) {
    if (!input.priceId) {
      throw new BadRequestException(
        `The ${input.planCode} plan has no Stripe price configured`,
      );
    }
    const form: Record<string, string> = {
      mode: 'subscription',
      client_reference_id: input.tenantId,
      'metadata[tenantId]': input.tenantId,
      'subscription_data[metadata][tenantId]': input.tenantId,
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': String(input.seats),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    };
    if (input.customerId) form.customer = input.customerId;
    else form.customer_email = input.customerEmail;
    const session = await this.call<{ id: string; url: string }>(
      'POST',
      '/checkout/sessions',
      form,
    );
    return { checkoutId: session.id, url: session.url };
  }

  async updateSeats(subscriptionId: string, seats: number): Promise<void> {
    const sub = await this.call<{ items: { data: { id: string }[] } }>(
      'GET',
      `/subscriptions/${subscriptionId}`,
    );
    const item = sub.items.data[0];
    if (!item) return;
    await this.call('POST', `/subscription_items/${item.id}`, {
      quantity: String(seats),
      proration_behavior: 'create_prorations',
    });
  }

  async cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
    await this.call('POST', `/subscriptions/${subscriptionId}`, {
      cancel_at_period_end: 'true',
    });
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent {
    const header = headers['stripe-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) throw new UnauthorizedException('Missing signature');

    const parts = Object.fromEntries(
      signature.split(',').map((p) => {
        const [k, ...v] = p.split('=');
        return [k, v.join('=')];
      }),
    );
    const timestamp = Number(parts.t);
    // Five minutes, as Stripe's own libraries allow: a replayed event older
    // than that is refused even with a valid signature.
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) {
      throw new UnauthorizedException('Stale or missing signature timestamp');
    }
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    const candidates = signature
      .split(',')
      .filter((p) => p.startsWith('v1='))
      .map((p) => p.slice(3));
    const ok = candidates.some(
      (c) =>
        c.length === expected.length &&
        timingSafeEqual(Buffer.from(c), Buffer.from(expected)),
    );
    if (!ok) throw new UnauthorizedException('Invalid signature');

    const event = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      type: string;
      data: { object: StripeObject };
    };
    const obj = event.data.object;
    const base = {
      id: event.id,
      raw: event as unknown as Record<string, unknown>,
    };

    switch (event.type) {
      case 'checkout.session.completed':
        return {
          ...base,
          type: 'checkout.completed',
          tenantId: obj.client_reference_id ?? obj.metadata?.tenantId ?? null,
          checkoutId: obj.id ?? null,
          customerId: obj.customer ?? null,
          subscriptionId: obj.subscription ?? null,
          status: 'ACTIVE',
        };
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return {
          ...base,
          type: 'subscription.updated',
          tenantId: obj.metadata?.tenantId ?? null,
          customerId: obj.customer ?? null,
          subscriptionId: obj.id ?? null,
          status: STRIPE_STATUS[obj.status ?? ''] ?? 'INCOMPLETE',
          currentPeriodEnd: obj.current_period_end
            ? new Date(obj.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
          seats: obj.items?.data?.[0]?.quantity,
        };
      case 'customer.subscription.deleted':
        return {
          ...base,
          type: 'subscription.deleted',
          tenantId: obj.metadata?.tenantId ?? null,
          subscriptionId: obj.id ?? null,
          status: 'CANCELED',
        };
      case 'invoice.payment_failed':
        return {
          ...base,
          type: 'payment.failed',
          tenantId: null,
          subscriptionId: obj.subscription ?? null,
          customerId: obj.customer ?? null,
        };
      case 'invoice.paid':
        return {
          ...base,
          type: 'payment.succeeded',
          tenantId: null,
          subscriptionId: obj.subscription ?? null,
          customerId: obj.customer ?? null,
        };
      default:
        return { ...base, type: 'ignored', tenantId: null };
    }
  }
}
