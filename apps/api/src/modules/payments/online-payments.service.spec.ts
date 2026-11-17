import { ServiceUnavailableException } from '@nestjs/common';
import { OnlinePaymentsService } from './online-payments.service';
import { FakePaymentProvider } from './providers/fake-payment.provider';
import type { PaymentEvent } from './providers/payment-provider';
import { PaymentCheckout, PaymentSettings } from './entities/payments.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';

const tenantId = 'org-1';

const settings = (over: Partial<PaymentSettings> = {}) =>
  ({
    tenantId,
    provider: 'STRIPE',
    financeAccountId: 'acct-bank',
    payDeposits: true,
    payInvoices: true,
    webhookKey: 'k'.repeat(32),
    encryptedCredentials: 'x',
    ...over,
  }) as PaymentSettings;

const paidEvent = (over: Partial<PaymentEvent> = {}): PaymentEvent => ({
  eventId: 'evt_test_1',
  type: 'checkout.session.completed',
  kind: 'PAID',
  sessionId: 'cs_test_a1',
  amountMinor: 105000,
  currency: 'AED',
  ...over,
});

/**
 * A database that remembers claimed event ids and the checkout row, with
 * just enough of TypeORM's shape for `applyEvent`.
 */
function setup(opts: { invoice?: Partial<Invoice>; checkout?: Partial<PaymentCheckout> | null } = {}) {
  const claimed = new Set<string>();
  const checkout =
    opts.checkout === null
      ? null
      : ({
          id: 'checkout-1',
          tenantId,
          invoiceId: 'inv-1',
          purpose: 'DEPOSIT',
          provider: 'STRIPE',
          providerSessionId: 'cs_test_a1',
          amount: 1050,
          currency: 'AED',
          status: 'OPEN',
          invoicePaymentId: null,
          completedAt: null,
          ...opts.checkout,
        } as PaymentCheckout);
  const invoice = {
    id: 'inv-1',
    tenantId,
    invoiceNumber: 'INV-0001',
    customerName: 'Gulf Packaging',
    currency: 'AED',
    amount: 1050,
    paidAmount: 0,
    creditedAmount: 0,
    refundedAmount: 0,
    status: InvoiceStatus.ISSUED,
    ...opts.invoice,
  } as Invoice;

  const manager = {
    createQueryBuilder: jest.fn(() => {
      let values: { eventId: string; provider: string };
      const qb = {
        insert: () => qb,
        into: () => qb,
        values: (v: typeof values) => ((values = v), qb),
        orIgnore: () => qb,
        returning: () => qb,
        execute: () => {
          const key = `${values.provider}:${values.eventId}`;
          if (claimed.has(key)) return Promise.resolve({ raw: [] });
          claimed.add(key);
          return Promise.resolve({ raw: [{ id: key }] });
        },
      };
      return qb;
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === PaymentCheckout) {
        const qb = {
          setLock: () => qb,
          where: () => qb,
          getOne: () => Promise.resolve(checkout),
        };
        return { createQueryBuilder: () => qb };
      }
      if (entity === Invoice) return { findOneOrFail: () => Promise.resolve(invoice) };
      if (entity === InvoicePayment) return { findOne: () => Promise.resolve({ id: 'pay-1' }) };
      throw new Error('unexpected repository');
    }),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
  };

  const invoicesService = {
    recordPayment: jest.fn(() => {
      invoice.paidAmount = Number(invoice.paidAmount) + 1050;
      return Promise.resolve(invoice);
    }),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const notifications = { notifyHolders: jest.fn(() => Promise.resolve(1)) };
  const dataSource = { transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)) };
  const config = { get: jest.fn(() => 'https://app.test') };

  const service = new OnlinePaymentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { fakeAllowed: true } as never,
    invoicesService as never,
    {} as never,
    audit as never,
    notifications as never,
    {} as never,
    dataSource as never,
    config as never,
  );
  return { service, invoicesService, audit, notifications, manager, checkout, invoice };
}

describe('OnlinePaymentsService.applyEvent', () => {
  it('records a paid checkout through the invoice payment path, into the chosen account', async () => {
    const { service, invoicesService, checkout } = setup();
    await expect(service.applyEvent(settings(), 'STRIPE', paidEvent())).resolves.toEqual({
      received: true,
    });
    expect(invoicesService.recordPayment).toHaveBeenCalledWith(
      tenantId,
      'inv-1',
      expect.objectContaining({ accountId: 'acct-bank', amount: 1050 }),
      null,
      expect.anything(),
    );
    expect(checkout).toEqual(
      expect.objectContaining({ status: 'PAID', invoicePaymentId: 'pay-1' }),
    );
  });

  it('records one payment when the same event arrives twice', async () => {
    const { service, invoicesService, audit } = setup();
    await service.applyEvent(settings(), 'STRIPE', paidEvent());
    await expect(service.applyEvent(settings(), 'STRIPE', paidEvent())).resolves.toEqual({
      received: true,
      duplicate: true,
    });
    expect(invoicesService.recordPayment).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('records nothing again when a second paid event names a checkout already paid', async () => {
    const { service, invoicesService } = setup({ checkout: { status: 'PAID' } });
    await service.applyEvent(settings(), 'STRIPE', paidEvent({ eventId: 'evt_test_2' }));
    expect(invoicesService.recordPayment).not.toHaveBeenCalled();
  });

  it('audits and notifies the people who handle payments', async () => {
    const { service, audit, notifications } = setup();
    await service.applyEvent(settings(), 'STRIPE', paidEvent());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        action: 'invoice.paid_online',
        subjectType: 'INVOICE',
        subjectId: 'inv-1',
        actorId: null,
        actorName: 'Stripe',
      }),
    );
    expect(notifications.notifyHolders).toHaveBeenCalledWith(
      tenantId,
      'invoice:manage',
      expect.objectContaining({
        type: 'PAYMENT_RECEIVED',
        title: 'Deposit received on INV-0001',
        entityId: 'inv-1',
      }),
      expect.anything(),
    );
  });

  it.each(['FAILED', 'EXPIRED'] as const)('records nothing for a %s checkout', async (kind) => {
    const { service, invoicesService, audit, notifications, checkout } = setup();
    await service.applyEvent(settings(), 'STRIPE', paidEvent({ kind }));
    expect(invoicesService.recordPayment).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notifyHolders).not.toHaveBeenCalled();
    expect(checkout?.status).toBe(kind);
  });

  it('ignores events it does not use without touching the database', async () => {
    const { service, manager } = setup();
    await service.applyEvent(settings(), 'STRIPE', paidEvent({ kind: 'IGNORED' }));
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('ignores a session Kerf did not start', async () => {
    const { service, invoicesService } = setup({ checkout: null });
    await service.applyEvent(settings(), 'STRIPE', paidEvent());
    expect(invoicesService.recordPayment).not.toHaveBeenCalled();
  });

  it('records no more than is owed, and says so', async () => {
    const { service, invoicesService, notifications } = setup({ invoice: { paidAmount: 50 } });
    await service.applyEvent(settings(), 'STRIPE', paidEvent());
    expect(invoicesService.recordPayment).toHaveBeenCalledWith(
      tenantId,
      'inv-1',
      expect.objectContaining({ amount: 1000 }),
      null,
      expect.anything(),
    );
    const [, , note] = notifications.notifyHolders.mock.calls[0] as unknown as [
      string,
      string,
      { body: string },
    ];
    expect(note.body).toMatch(/50\.00 more than was owed/);
  });

  it('records nothing on a cancelled invoice', async () => {
    const { service, invoicesService, checkout } = setup({
      invoice: { status: InvoiceStatus.CANCELLED },
    });
    await service.applyEvent(settings(), 'STRIPE', paidEvent());
    expect(invoicesService.recordPayment).not.toHaveBeenCalled();
    expect(checkout?.status).toBe('PAID');
  });

  it('asks the provider to retry when no account is chosen yet', async () => {
    const { service } = setup();
    await expect(
      service.applyEvent(settings({ financeAccountId: null }), 'STRIPE', paidEvent()),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('handles the test checkout the same way', async () => {
    const { service, invoicesService } = setup({
      checkout: { provider: 'FAKE', providerSessionId: 'fake_cs_1' },
    });
    await service.applyEvent(
      settings({ provider: 'FAKE' }),
      'FAKE',
      FakePaymentProvider.event('fake_cs_1', 'PAID'),
    );
    expect(invoicesService.recordPayment).toHaveBeenCalledWith(
      tenantId,
      'inv-1',
      expect.objectContaining({ amount: 1050 }),
      null,
      expect.anything(),
    );
  });
});
