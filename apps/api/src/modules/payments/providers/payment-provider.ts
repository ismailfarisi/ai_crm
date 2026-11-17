import type { PaymentProviderName } from '@saas/shared';

/**
 * How Kerf takes a tenant's customer to a hosted checkout and learns the
 * outcome. Shaped for card gateways generally, not for Stripe: a UAE gateway
 * such as Telr or N-Genius needs only these two calls too — create a hosted
 * payment page for an amount, and turn its callback into one of the events
 * below.
 *
 * Separate from `modules/billing/billing-provider.ts`, which is Kerf
 * charging its tenants with Kerf's own keys. These run with the tenant's.
 */
export interface TenantPaymentCredentials {
  secretKey?: string;
  webhookSecret?: string;
}

export interface CheckoutRequest {
  /** Our checkout row id, echoed back by the provider. */
  reference: string;
  /** In the currency's smallest unit (fils for AED). */
  amountMinor: number;
  currency: string;
  description: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

/**
 * What a provider event means for Kerf. Anything else a provider sends is
 * IGNORED: acknowledged, and nothing recorded.
 */
export type PaymentEventKind = 'PAID' | 'FAILED' | 'EXPIRED' | 'IGNORED';

export interface PaymentEvent {
  eventId: string;
  type: string;
  kind: PaymentEventKind;
  sessionId: string | null;
  /** What the provider says it collected, in minor units. */
  amountMinor: number | null;
  currency: string | null;
}

export interface TenantPaymentProvider {
  readonly name: Exclude<PaymentProviderName, 'NONE'>;
  createCheckout(
    credentials: TenantPaymentCredentials,
    request: CheckoutRequest,
  ): Promise<CheckoutSession>;
  /** Throws UnauthorizedException when the signature does not verify. */
  parseWebhook(
    credentials: TenantPaymentCredentials,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): PaymentEvent;
}
