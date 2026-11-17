import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentEvent,
  TenantPaymentProvider,
} from './payment-provider';

/**
 * Development and staging: the "hosted checkout" is a page in the web app,
 * and paying is pressing a button there. The outcome goes through the same
 * event handling a real provider's webhook does.
 */
export class FakePaymentProvider implements TenantPaymentProvider {
  readonly name = 'FAKE' as const;

  constructor(private readonly webOrigin: string) {}

  createCheckout(_credentials: unknown, request: CheckoutRequest): Promise<CheckoutSession> {
    const sessionId = `fake_cs_${randomBytes(16).toString('hex')}`;
    const params = new URLSearchParams({
      session: sessionId,
      amount: String(request.amountMinor),
      currency: request.currency,
      description: request.description,
      success: request.successUrl,
      cancel: request.cancelUrl,
    });
    return Promise.resolve({
      sessionId,
      url: `${this.webOrigin}/pay/checkout?${params.toString()}`,
    });
  }

  parseWebhook(): PaymentEvent {
    throw new BadRequestException('The test checkout has no webhook');
  }

  /** The event the fake checkout page produces. */
  static event(sessionId: string, outcome: 'PAID' | 'EXPIRED'): PaymentEvent {
    return {
      eventId: `fake_evt_${sessionId}_${outcome}`,
      type: outcome === 'PAID' ? 'fake.checkout.paid' : 'fake.checkout.cancelled',
      kind: outcome,
      sessionId,
      amountMinor: null,
      currency: null,
    };
  }
}
