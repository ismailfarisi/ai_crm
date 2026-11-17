import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import {
  fromMinorUnits,
  invoicePosition,
  PAY_LINK_DAYS,
  PERMISSIONS,
  toMinorUnits,
  type CheckoutRedirectDto,
  type InvoiceOnlinePaymentDto,
  type OnlinePaymentPurpose,
  type PayLinkDto,
  type PaymentProviderName,
  type PublicInvoiceDto,
  type QuoteDepositStatusDto,
} from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Organization } from '../organizations/entities/organization.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';
import type { InvoicePayLinkIssuer } from '../quotes/invoice-pay-link-issuer';
import { InvoicesService } from '../quotes/invoices.service';
import { QuoteAcceptanceService } from '../quotes/quote-acceptance.service';
import {
  BillingScheduleLine,
  SalesOrder,
} from '../orders/entities/sales-order.entity';
import {
  InvoicePayLink,
  PaymentCheckout,
  PaymentSettings,
  PaymentWebhookEvent,
} from './entities/payments.entity';
import { PaymentSettingsService } from './payment-settings.service';
import { FakePaymentProvider } from './providers/fake-payment.provider';
import type {
  PaymentEvent,
  TenantPaymentProvider,
} from './providers/payment-provider';
import { StripePaymentProvider } from './providers/stripe-payment.provider';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROVIDER_LABEL: Record<PaymentProviderName, string> = {
  NONE: 'Online payment',
  FAKE: 'Test checkout',
  STRIPE: 'Stripe',
};

/**
 * Customers paying a tenant online: the deposit on an accepted quote, and an
 * invoice from its pay link.
 *
 * A checkout records nothing. Money is recorded only when the provider says
 * it was paid, through the same `InvoicesService.recordPayment` a person
 * uses, into the account chosen in payment settings — so it posts and
 * reconciles like any other payment.
 */
@Injectable()
export class OnlinePaymentsService implements InvoicePayLinkIssuer {
  private readonly logger = new Logger(OnlinePaymentsService.name);
  private readonly providers: Record<'FAKE' | 'STRIPE', TenantPaymentProvider>;

  constructor(
    @InjectRepository(PaymentCheckout)
    private readonly checkouts: Repository<PaymentCheckout>,
    @InjectRepository(InvoicePayLink)
    private readonly payLinks: Repository<InvoicePayLink>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly settingsService: PaymentSettingsService,
    private readonly invoicesService: InvoicesService,
    private readonly acceptance: QuoteAcceptanceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tenantContext: TenantContextService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.providers = {
      FAKE: new FakePaymentProvider(this.webUrl),
      STRIPE: new StripePaymentProvider(),
    };
  }

  private get webUrl(): string {
    return this.config.get('publicWebUrl', { infer: true });
  }

  /* ------------------------------------------------------------------ *
   * Pay links
   * ------------------------------------------------------------------ */

  /** A fresh link; any earlier link for the invoice stops working. */
  async issuePayLink(tenantId: string, invoiceId: string): Promise<PayLinkDto> {
    const invoice = await this.invoices.findOne({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Nothing is owed on this invoice');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PAY_LINK_DAYS * DAY_MS);
    await this.payLinks.upsert(
      { tenantId, invoiceId, tokenHash: hashToken(token), expiresAt },
      { conflictPaths: ['invoiceId'] },
    );
    return { url: `${this.webUrl}/pay/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async linkForEmail(tenantId: string, invoiceId: string): Promise<string | null> {
    const settings = await this.settingsService.find(tenantId);
    if (!settings?.payInvoices || !this.settingsService.isReady(settings)) return null;
    return (await this.issuePayLink(tenantId, invoiceId)).url;
  }

  /** The invoice a pay link names, and the rest of the request as its tenant. */
  private async withPayLink<T>(
    token: string,
    fn: (invoice: Invoice, settings: PaymentSettings | null) => Promise<T>,
  ): Promise<T> {
    const link = TOKEN_SHAPE.test(token ?? '')
      ? await this.tenantContext.runAsSystem(() =>
          this.payLinks.findOne({ where: { tokenHash: hashToken(token) } }),
        )
      : null;
    if (!link) {
      throw new NotFoundException('This link is not valid. Please check it, or contact the sender.');
    }
    if (link.expiresAt.getTime() < Date.now()) {
      throw new GoneException('This link has expired. Please ask for a new one.');
    }
    return this.tenantContext.runWithTenant(link.tenantId, async () => {
      const invoice = await this.invoices.findOne({
        where: { id: link.invoiceId, tenantId: link.tenantId },
      });
      if (!invoice || invoice.status === InvoiceStatus.CANCELLED) {
        throw new GoneException('This invoice is no longer payable. Please contact the sender.');
      }
      return fn(invoice, await this.settingsService.find(link.tenantId));
    });
  }

  async viewInvoice(token: string): Promise<PublicInvoiceDto> {
    return this.withPayLink(token, (invoice, settings) => this.toPublic(invoice, settings));
  }

  async startInvoiceCheckout(token: string): Promise<CheckoutRedirectDto> {
    return this.withPayLink(token, (invoice, settings) => {
      if (!settings?.payInvoices) {
        throw new BadRequestException('Online payment is not available for this invoice.');
      }
      const back = `${this.webUrl}/pay/${token}`;
      return this.startCheckout(invoice, settings, 'INVOICE', `${back}?paid=1`, back);
    });
  }

  async startDepositCheckout(quoteToken: string): Promise<CheckoutRedirectDto> {
    return this.acceptance.withDepositInvoice(quoteToken, async (invoice) => {
      const settings = await this.settingsService.find(invoice.tenantId);
      if (!settings?.payDeposits) {
        throw new BadRequestException('Online payment is not available for this deposit.');
      }
      const back = `${this.webUrl}/q/${quoteToken}`;
      return this.startCheckout(invoice, settings, 'DEPOSIT', `${back}?paid=1`, back);
    });
  }

  private async startCheckout(
    invoice: Invoice,
    settings: PaymentSettings,
    purpose: OnlinePaymentPurpose,
    successUrl: string,
    cancelUrl: string,
  ): Promise<CheckoutRedirectDto> {
    if (!this.settingsService.isReady(settings) || settings.provider === 'NONE') {
      throw new BadRequestException('Online payment is not available right now.');
    }
    const balance = Math.max(0, invoicePosition(invoice).balance);
    if (balance <= 0) throw new BadRequestException('This has already been paid. Thank you.');

    const provider = this.providers[settings.provider];
    const reference = randomUUID();
    const session = await provider.createCheckout(this.settingsService.credentials(settings), {
      reference,
      amountMinor: toMinorUnits(balance, invoice.currency),
      currency: invoice.currency,
      description: `${invoice.stageLabel ?? 'Invoice'} ${invoice.invoiceNumber}`,
      customerEmail: invoice.customerEmail,
      successUrl,
      cancelUrl,
    });
    await this.checkouts.save(
      this.checkouts.create({
        id: reference,
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        purpose,
        provider: provider.name,
        providerSessionId: session.sessionId,
        amount: balance,
        currency: invoice.currency,
        status: 'OPEN',
        invoicePaymentId: null,
        completedAt: null,
      }),
    );
    return { url: session.url };
  }

  /* ------------------------------------------------------------------ *
   * Provider events
   * ------------------------------------------------------------------ */

  async handleStripeWebhook(
    webhookKey: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: true; duplicate?: boolean }> {
    const settings = await this.tenantContext.runAsSystem(() =>
      this.settingsService.findByWebhookKey(webhookKey),
    );
    if (!settings || settings.provider !== 'STRIPE') throw new NotFoundException();
    return this.tenantContext.runWithTenant(settings.tenantId, async () => {
      const event = this.providers.STRIPE.parseWebhook(
        this.settingsService.credentials(settings),
        rawBody,
        headers,
      );
      return this.applyEvent(settings, 'STRIPE', event);
    });
  }

  /** The test checkout page's Pay and Cancel buttons. Refused where the fake provider is off. */
  async completeFake(
    sessionId: string,
    outcome: 'PAID' | 'EXPIRED',
  ): Promise<{ status: 'PAID' | 'EXPIRED' | 'FAILED' | 'OPEN' }> {
    if (!this.settingsService.fakeAllowed) throw new NotFoundException();
    const checkout = /^fake_cs_[a-f0-9]{32}$/.test(sessionId ?? '')
      ? await this.tenantContext.runAsSystem(() =>
          this.checkouts.findOne({ where: { provider: 'FAKE', providerSessionId: sessionId } }),
        )
      : null;
    if (!checkout) throw new NotFoundException('This checkout is not valid.');
    return this.tenantContext.runWithTenant(checkout.tenantId, async () => {
      const settings = await this.settingsService.find(checkout.tenantId);
      if (!settings) throw new NotFoundException();
      await this.applyEvent(settings, 'FAKE', FakePaymentProvider.event(sessionId, outcome));
      const after = await this.checkouts.findOneOrFail({ where: { id: checkout.id } });
      return { status: after.status };
    });
  }

  /**
   * One provider event, at most once. The event id is claimed first, in the
   * same transaction as the payment, so a redelivery — or two deliveries at
   * once — finds it taken and records nothing.
   */
  async applyEvent(
    settings: PaymentSettings,
    provider: Exclude<PaymentProviderName, 'NONE'>,
    event: PaymentEvent,
  ): Promise<{ received: true; duplicate?: boolean }> {
    const tenantId = settings.tenantId;
    if (event.kind === 'IGNORED' || !event.sessionId) return { received: true };
    if (event.kind === 'PAID' && !settings.financeAccountId) {
      // Refused, so the provider retries once an account has been chosen.
      throw new ServiceUnavailableException('No account is set for online payments');
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      const claimed: unknown[] = await manager
        .createQueryBuilder()
        .insert()
        .into(PaymentWebhookEvent)
        .values({ tenantId, provider, eventId: event.eventId, type: event.type.slice(0, 100) })
        .orIgnore()
        .returning('id')
        .execute()
        .then((r) => r.raw as unknown[]);
      if (!claimed.length) return { duplicate: true as const };

      const checkout = await manager
        .getRepository(PaymentCheckout)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.provider = :provider AND c.provider_session_id = :session AND c.tenant_id = :tenantId', {
          provider,
          session: event.sessionId,
          tenantId,
        })
        .getOne();
      if (!checkout || checkout.status === 'PAID') return { duplicate: false as const };

      if (event.kind !== 'PAID') {
        // A failed or abandoned checkout records nothing; the customer can start again.
        checkout.status = event.kind === 'FAILED' ? 'FAILED' : 'EXPIRED';
        checkout.completedAt = new Date();
        await manager.save(checkout);
        return { duplicate: false as const };
      }

      const paid =
        event.amountMinor != null
          ? fromMinorUnits(event.amountMinor, event.currency ?? checkout.currency)
          : Number(checkout.amount);
      const invoice = await manager
        .getRepository(Invoice)
        .findOneOrFail({ where: { id: checkout.invoiceId, tenantId } });
      const owed =
        invoice.status === InvoiceStatus.CANCELLED ? 0 : Math.max(0, invoicePosition(invoice).balance);
      const amount = Math.min(paid, owed);

      checkout.status = 'PAID';
      checkout.completedAt = new Date();
      let paymentId: string | null = null;
      if (amount > 0) {
        await this.invoicesService.recordPayment(
          tenantId,
          invoice.id,
          {
            accountId: settings.financeAccountId!,
            amount,
            notes: `Paid online (${PROVIDER_LABEL[provider]} ${event.sessionId})`,
          },
          null,
          manager,
        );
        const payment = await manager.getRepository(InvoicePayment).findOne({
          where: { invoiceId: invoice.id, tenantId },
          order: { createdAt: 'DESC' },
        });
        paymentId = payment?.id ?? null;
      }
      checkout.invoicePaymentId = paymentId;
      await manager.save(checkout);

      const what = checkout.purpose === 'DEPOSIT' ? 'Deposit' : 'Payment';
      const extra = paid - amount;
      await this.notifications.notifyHolders(
        tenantId,
        PERMISSIONS.INVOICE_MANAGE,
        {
          type: 'PAYMENT_RECEIVED',
          title: `${what} received on ${invoice.invoiceNumber}`,
          body:
            extra > 0.004
              ? `${paid.toFixed(2)} ${invoice.currency} paid online, ${extra.toFixed(2)} more than was owed. Refund or credit the difference.`
              : `${paid.toFixed(2)} ${invoice.currency} paid online by ${invoice.customerName}.`,
          link: '/invoices',
          entityType: 'INVOICE',
          entityId: invoice.id,
        },
        { manager },
      );
      return { duplicate: false as const, invoice, checkout, paid, amount, paymentId };
    });

    if (outcome.duplicate) return { received: true, duplicate: true };
    if ('invoice' in outcome && outcome.invoice) {
      await this.audit.record({
        tenantId,
        action: 'invoice.paid_online',
        subjectType: 'INVOICE',
        subjectId: outcome.invoice.id,
        actorId: null,
        actorName: PROVIDER_LABEL[provider],
        summary: `${outcome.checkout.purpose === 'DEPOSIT' ? 'Deposit' : 'Payment'} of ${outcome.paid.toFixed(2)} ${outcome.invoice.currency} paid online on ${outcome.invoice.invoiceNumber}`,
        after: {
          checkoutId: outcome.checkout.id,
          providerSessionId: event.sessionId,
          providerEventId: event.eventId,
          paidOnline: outcome.paid,
          recorded: outcome.amount,
          invoicePaymentId: outcome.paymentId,
        },
        channel: 'SYSTEM',
      });
    }
    return { received: true };
  }

  /* ------------------------------------------------------------------ *
   * Staff screens
   * ------------------------------------------------------------------ */

  async invoiceStatuses(tenantId: string): Promise<InvoiceOnlinePaymentDto[]> {
    const [checkouts, links] = await Promise.all([
      this.checkouts.find({ where: { tenantId }, order: { createdAt: 'ASC' } }),
      this.payLinks.find({ where: { tenantId } }),
    ]);
    const byInvoice = new Map<string, InvoiceOnlinePaymentDto>();
    const entry = (invoiceId: string) => {
      let row = byInvoice.get(invoiceId);
      if (!row) {
        row = { invoiceId, payLinkExpiresAt: null, lastCheckoutStatus: null, lastCheckoutAt: null, paidOnline: 0 };
        byInvoice.set(invoiceId, row);
      }
      return row;
    };
    for (const c of checkouts) {
      const row = entry(c.invoiceId);
      row.lastCheckoutStatus = c.status;
      row.lastCheckoutAt = (c.completedAt ?? c.createdAt).toISOString();
      if (c.status === 'PAID') row.paidOnline = Math.round((row.paidOnline + Number(c.amount)) * 100) / 100;
    }
    for (const link of links) {
      if (link.expiresAt.getTime() > Date.now()) {
        entry(link.invoiceId).payLinkExpiresAt = link.expiresAt.toISOString();
      }
    }
    return [...byInvoice.values()];
  }

  async quoteDeposit(tenantId: string, quoteId: string): Promise<QuoteDepositStatusDto | null> {
    const order = await this.dataSource
      .getRepository(SalesOrder)
      .findOne({ where: { quoteId, tenantId } });
    if (!order) return null;
    const stage = await this.dataSource.getRepository(BillingScheduleLine).findOne({
      where: { salesOrderId: order.id, kind: 'DEPOSIT' },
      order: { sequence: 'ASC' },
    });
    if (!stage?.invoiceId) return null;
    const invoice = await this.invoices.findOne({ where: { id: stage.invoiceId, tenantId } });
    if (!invoice) return null;
    const checkouts = await this.checkouts.find({
      where: { tenantId, invoiceId: In([invoice.id]) },
      order: { createdAt: 'ASC' },
    });
    const last = checkouts[checkouts.length - 1] ?? null;
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      label: invoice.stageLabel ?? stage.label,
      amount: Number(invoice.amount),
      paidAmount: Number(invoice.paidAmount ?? 0),
      balanceDue: Math.max(0, invoicePosition(invoice).balance),
      invoiceStatus: invoice.status as QuoteDepositStatusDto['invoiceStatus'],
      lastCheckoutStatus: last?.status ?? null,
      paidOnline: checkouts
        .filter((c) => c.status === 'PAID')
        .reduce((sum, c) => Math.round((sum + Number(c.amount)) * 100) / 100, 0),
    };
  }

  private async toPublic(invoice: Invoice, settings: PaymentSettings | null): Promise<PublicInvoiceDto> {
    const organization = await this.organizations.findOne({ where: { id: invoice.tenantId } });
    const balanceDue = Math.max(0, invoicePosition(invoice).balance);
    return {
      organizationName: organization?.name ?? '',
      sellerTaxId: organization?.taxId ?? null,
      sellerEmail: organization?.email ?? null,
      invoiceNumber: invoice.invoiceNumber,
      stageLabel: invoice.stageLabel,
      customerName: invoice.customerName,
      currency: invoice.currency,
      issuedAt: invoice.issuedAt.toISOString(),
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString() : null,
      items: (invoice.items ?? [])
        .filter((item) => (item.type ?? 'product') === 'product')
        .map((item) => ({
          description: item.description,
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unitPrice) || 0,
          subtotal: Number(item.subtotal) || 0,
        })),
      subtotalAmount: Number(invoice.subtotalAmount),
      discountAmount: Number(invoice.discountAmount),
      taxAmount: Number(invoice.taxAmount),
      totalAmount: Number(invoice.amount),
      paidAmount: Number(invoice.paidAmount ?? 0),
      creditedAmount: Number(invoice.creditedAmount ?? 0),
      balanceDue,
      status: invoice.status as PublicInvoiceDto['status'],
      canPayOnline: Boolean(
        settings?.payInvoices && this.settingsService.isReady(settings) && balanceDue > 0,
      ),
    };
  }
}
