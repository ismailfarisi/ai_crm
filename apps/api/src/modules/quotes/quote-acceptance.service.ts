import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  ACCEPTANCE_LINK_DEFAULT_DAYS,
  acceptanceRefusalMessage,
  allocateStageAmounts,
  DEFAULT_BILLING_SCHEDULE,
  formatOrganizationAddress,
  invoicePosition,
  type AcceptanceRefusal,
  type PublicDepositDto,
  type PublicQuoteDto,
} from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { DocumentLocalizationService } from '../document-templates/document-localization.service';
import { Organization } from '../organizations/entities/organization.entity';
import { AuditService } from '../audit/audit.service';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { MailService } from '../mail/mail.service';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import {
  BillingScheduleLine,
  SalesOrder,
} from '../orders/entities/sales-order.entity';
import { PaymentSettings } from '../payments/entities/payments.entity';
import { paymentsReady } from '../payments/payment-readiness';
import { ChannelCryptoService } from '../channels/services/channel-crypto.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { Quote, QuoteStatus } from './entities/quote.entity';
import { QuoteProofsService } from './quote-proofs.service';
import { QuotesService } from './quotes.service';

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** The logo URL the DTO carries, resolved against the API's public origin. */
function absoluteLogoUrl(
  apiOrigin: string,
  path: string | null,
): string | null {
  return path ? `${apiOrigin}${path}` : null;
}

/** Customer names and free-typed notes go into an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tokens are 32 random bytes as base64url: 43 characters, nothing else. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A customer accepting a quote from a link, without an account.
 *
 * A quote reaches a customer only once it is approved: approval is where the
 * margin floors are enforced against the approver's own permissions, so the
 * price on the link has already been signed off. The customer's acceptance is
 * then what turns it into a sales order — recorded from the link, or by hand
 * when they said yes some other way. `quote.accepted` is emitted either way.
 */
@Injectable()
export class QuoteAcceptanceService {
  private readonly logger = new Logger(QuoteAcceptanceService.name);

  constructor(
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: AutomationEventBridgeService,
    private readonly mail: MailService,
    @Optional() private readonly tenantContext?: TenantContextService,
    @Optional() private readonly quotesService?: QuotesService,
    @Optional() private readonly proofs?: QuoteProofsService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly crypto?: ChannelCryptoService,
    @Optional()
    private readonly documentLocalization?: DocumentLocalizationService,
  ) {}

  /**
   * The deposit invoice raised when the quote behind this link was accepted,
   * for the payments module to take the customer to checkout. Runs the
   * callback as the quote's tenant.
   */
  async withDepositInvoice<T>(
    token: string,
    fn: (invoice: Invoice, quote: Quote) => Promise<T>,
  ): Promise<T> {
    return this.withQuoteFor(token, async (quote) => {
      if (!quote || !quote.acceptedAt) this.refuse('NOT_FOUND');
      const invoice = await this.depositInvoice(quote);
      if (!invoice) {
        throw new BadRequestException(
          'There is no deposit to pay on this quote.',
        );
      }
      return fn(invoice, quote);
    });
  }

  private async depositInvoice(quote: Quote): Promise<Invoice | null> {
    const manager = this.quotes.manager;
    const order = await manager
      .getRepository(SalesOrder)
      .findOne({ where: { quoteId: quote.id, tenantId: quote.tenantId } });
    if (!order) return null;
    const stage = await manager.getRepository(BillingScheduleLine).findOne({
      where: { salesOrderId: order.id, kind: 'DEPOSIT' },
      order: { sequence: 'ASC' },
    });
    if (!stage?.invoiceId) return null;
    const invoice = await manager
      .getRepository(Invoice)
      .findOne({ where: { id: stage.invoiceId, tenantId: quote.tenantId } });
    return invoice && invoice.status !== InvoiceStatus.CANCELLED
      ? invoice
      : null;
  }

  private async publicDeposit(quote: Quote): Promise<PublicDepositDto | null> {
    if (!quote.acceptedAt) return null;
    const invoice = await this.depositInvoice(quote);
    if (!invoice) return null;
    const settings = await this.quotes.manager
      .getRepository(PaymentSettings)
      .findOne({ where: { tenantId: quote.tenantId } });
    const credentials =
      settings?.encryptedCredentials && this.crypto
        ? this.crypto.decrypt<{ secretKey?: string; webhookSecret?: string }>(
            settings.encryptedCredentials,
          )
        : null;
    const ready = paymentsReady(
      settings,
      credentials,
      Boolean(this.config.get('payments', { infer: true })?.fakeCheckout),
    );
    const balanceDue = Math.max(0, invoicePosition(invoice).balance);
    return {
      label: invoice.stageLabel ?? 'Deposit',
      invoiceNumber: invoice.invoiceNumber,
      amount: Number(invoice.amount),
      balanceDue,
      paid: balanceDue <= 0,
      canPayOnline: Boolean(ready && settings?.payDeposits && balanceDue > 0),
    };
  }

  /**
   * The quote a link names, and the rest of the request run as its tenant.
   *
   * A customer has no session, so no tenant, and row-level security would
   * show them nothing. The token is the authority: it is looked up outside
   * any tenant, and everything after — reading the seller, recording the
   * acceptance, raising `quote.accepted` — runs as the quote's own tenant,
   * exactly as it would for someone signed in to it.
   */
  async withQuoteFor<T>(
    token: string,
    fn: (quote: Quote | null) => Promise<T>,
  ): Promise<T> {
    const quote = await (this.tenantContext
      ? this.tenantContext.runAsSystem(() => this.findByToken(token))
      : this.findByToken(token));
    if (!quote || !this.tenantContext) return fn(quote);
    return this.tenantContext.runWithTenant(quote.tenantId, () => fn(quote));
  }

  /**
   * Issues a fresh link. Any earlier link for the quote stops working: only
   * the most recently sent one is valid, so a link forwarded to the wrong
   * person can be killed by sending a new one.
   */
  async createLink(
    tenantId: string,
    quoteId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const quote = await this.quotes.findOne({
      where: { id: quoteId, tenantId },
    });
    if (!quote)
      throw new NotFoundException(`Quote with ID ${quoteId} not found`);
    if (quote.supersededAt) {
      throw new BadRequestException(
        'This quote has been replaced by a newer revision. Send the link for the latest version.',
      );
    }
    if (quote.status === QuoteStatus.REJECTED) {
      throw new BadRequestException(
        'A rejected quote cannot be sent for acceptance',
      );
    }
    if (quote.acceptedAt) {
      throw new BadRequestException(
        `The customer already accepted this quote on ${quote.acceptedAt.toISOString().slice(0, 10)}`,
      );
    }
    if (!(Number(quote.totalAmount) > 0)) {
      throw new BadRequestException(
        'Add priced lines before sending the quote',
      );
    }
    if (quote.status !== QuoteStatus.APPROVED) {
      throw new BadRequestException(
        `Approve ${quote.quoteNumber ?? 'the quote'} before sending it to the customer`,
      );
    }

    const token = randomBytes(32).toString('base64url');
    const fallback = new Date(
      Date.now() + ACCEPTANCE_LINK_DEFAULT_DAYS * 24 * 60 * 60 * 1000,
    );
    const expiresAt =
      quote.validUntil && quote.validUntil.getTime() > Date.now()
        ? quote.validUntil
        : fallback;

    // Sending settles the proof rule from the organisation's default, so a
    // later change to the default does not move the goalposts on a quote the
    // customer already has. A fresh link also clears their last response:
    // staff have answered it by sending again.
    const proofRequired =
      quote.proofRequired ?? (await this.proofs?.isRequired(quote)) ?? false;
    await this.quotes.update(
      { id: quote.id, tenantId },
      {
        acceptanceTokenHash: hashToken(token),
        acceptanceExpiresAt: expiresAt,
        proofRequired,
        customerResponse: null,
        customerResponseNote: null,
        customerRespondedAt: null,
        customerRespondedByName: null,
      },
    );

    const origin = this.config.get('publicWebUrl', { infer: true });
    return { url: `${origin}/q/${token}`, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Issues an acceptance link and emails it to the customer.
   *
   * Sending the quote is the most common action in the whole sales process,
   * and the only way to do it was *Get acceptance link*, which copied a URL to
   * the clipboard for the sender to paste into their own mail client — while
   * the product had a mail provider, a channels module and the customer's
   * address already on the quote.
   *
   * Built on `createLink`, so every refusal it makes — superseded, rejected,
   * already accepted, nothing priced — applies here too, and sending also
   * invalidates any earlier link exactly as issuing one by hand does.
   */
  async sendToCustomer(
    tenantId: string,
    quoteId: string,
    options: { to?: string; message?: string } = {},
  ): Promise<{ sentTo: string; url: string; expiresAt: string }> {
    const quote = await this.quotes.findOne({
      where: { id: quoteId, tenantId },
    });
    if (!quote) {
      throw new NotFoundException(`Quote with ID ${quoteId} not found`);
    }

    const to = (options.to ?? quote.customerEmail ?? '').trim();
    if (!to) {
      throw new BadRequestException(
        'This quote has no customer email address. Add one to the quote, or to the customer record, first.',
      );
    }

    // After the address check, so a quote is not invalidated by a send that
    // was never going to leave the building.
    const link = await this.createLink(tenantId, quoteId);

    const organization = await this.organizations.findOne({
      where: { id: tenantId },
    });
    const sender = organization?.legalName || organization?.name || 'Kerf';
    const reference = quote.quoteNumber ?? 'your quote';
    const note = (options.message ?? '').trim();

    await this.mail.sendMail({
      to,
      subject: `${reference} from ${sender}`,
      html: [
        `<p>Hi ${escapeHtml(quote.customerName)},</p>`,
        note ? `<p>${escapeHtml(note).replace(/\n/g, '<br>')}</p>` : '',
        `<p>Here is ${escapeHtml(reference)}${quote.title ? ` — ${escapeHtml(quote.title)}` : ''}.</p>`,
        `<p><a href="${escapeHtml(link.url)}">View and accept the quote</a></p>`,
        `<p>The link is valid until ${new Date(link.expiresAt).toDateString()}.</p>`,
        `<p>${escapeHtml(sender)}</p>`,
      ].join(''),
      text: [
        `Hi ${quote.customerName},`,
        note,
        `Here is ${reference}${quote.title ? ` — ${quote.title}` : ''}.`,
        `View and accept it: ${link.url}`,
        `The link is valid until ${new Date(link.expiresAt).toDateString()}.`,
        sender,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    this.logger.log(`Quote ${reference} sent to ${to}`);
    return { sentTo: to, ...link };
  }

  async view(token: string): Promise<PublicQuoteDto> {
    return this.withQuoteFor(token, async (quote) => {
      const refusal = this.refusalFor(quote, {
        allowAccepted: true,
        allowDeclined: true,
      });
      if (refusal) this.refuse(refusal);
      return this.toPublic(quote!);
    });
  }

  async accept(
    token: string,
    input: { name: string },
    ipAddress: string | undefined,
  ): Promise<PublicQuoteDto> {
    const name = String(input?.name ?? '')
      .trim()
      .slice(0, 255);
    if (name.length < 2) {
      throw new BadRequestException('Type your full name to accept');
    }

    return this.withQuoteFor(token, (quote) =>
      this.recordAcceptance(quote, token, name, ipAddress),
    );
  }

  private async recordAcceptance(
    quote: Quote | null,
    token: string,
    name: string,
    ipAddress: string | undefined,
  ): Promise<PublicQuoteDto> {
    const refusal = this.refusalFor(quote, { allowAccepted: false });
    if (refusal) this.refuse(refusal);
    if (await this.proofs?.blocksAcceptance(quote!)) {
      throw new BadRequestException({
        reason: 'PROOF_NOT_APPROVED',
        message:
          'Please approve the latest artwork proof first. The quote can be accepted once the proof is approved.',
      });
    }

    // Conditional, so two clicks (or two people with the link) cannot both
    // record an acceptance: the second update matches no row.
    const acceptedAt = new Date();
    const result = await this.quotes
      .createQueryBuilder()
      .update(Quote)
      .set({
        acceptedAt,
        acceptedByName: name,
        acceptedIp: ipAddress?.slice(0, 64) ?? null,
      })
      .where('id = :id', { id: quote!.id })
      .andWhere('accepted_at IS NULL')
      .andWhere('superseded_at IS NULL')
      .andWhere('acceptance_token_hash = :hash', { hash: hashToken(token) })
      .andWhere("customer_response IS DISTINCT FROM 'DECLINED'")
      .execute();
    if (!result.affected) this.refuse('ALREADY_ACCEPTED');

    quote!.acceptedAt = acceptedAt;
    quote!.acceptedByName = name;
    await this.audit?.record({
      tenantId: quote!.tenantId,
      action: 'quote.customer_accept',
      subjectType: 'QUOTE',
      subjectId: quote!.id,
      actorName: `${name} (customer)`,
      summary: quote!.quoteNumber ?? null,
      after: { acceptedAt: acceptedAt.toISOString(), acceptedByName: name },
      ip: ipAddress?.slice(0, 64) ?? null,
      channel: 'WEB',
    });

    await this.afterAcceptance(quote!, name);
    // The customer has said yes; a failure here must not tell them otherwise.
    // The order can still be raised from the quote, by re-approving it.
    try {
      await this.quotesService?.provisionAcceptedQuote(
        quote!.tenantId,
        quote!.id,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Quote ${quote!.id} was accepted but its order was not created: ${msg}`,
      );
    }

    return this.toPublic(quote!);
  }

  /**
   * Records an acceptance the customer gave some other way — a signed PDF, a
   * purchase order, a phone call — and raises the order, exactly as accepting
   * through the link does. Only an approved quote can be accepted.
   */
  async markAccepted(
    tenantId: string,
    quoteId: string,
    name: string,
  ): Promise<Quote> {
    const quote = await this.quotes.findOne({
      where: { id: quoteId, tenantId },
    });
    if (!quote) {
      throw new NotFoundException(`Quote with ID ${quoteId} not found`);
    }
    const label = quote.quoteNumber ?? 'This quote';
    if (quote.supersededAt) {
      throw new BadRequestException(
        `${label} has been replaced by a newer revision. Record the acceptance on the latest version.`,
      );
    }
    if (quote.status !== QuoteStatus.APPROVED) {
      throw new BadRequestException(
        `${label} must be approved before the customer can accept it`,
      );
    }
    if (await this.proofs?.blocksAcceptance(quote)) {
      throw new BadRequestException(
        `${label} needs an approved artwork proof before it can be accepted. Wait for the customer to approve the latest proof, or turn off the proof requirement.`,
      );
    }

    const acceptedAt = new Date();
    const result = await this.quotes
      .createQueryBuilder()
      .update(Quote)
      .set({ acceptedAt, acceptedByName: name, acceptedIp: null })
      .where('id = :id', { id: quote.id })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('accepted_at IS NULL')
      .andWhere('superseded_at IS NULL')
      .execute();
    if (!result.affected) {
      throw new BadRequestException(`${label} has already been accepted`);
    }
    quote.acceptedAt = acceptedAt;
    quote.acceptedByName = name;

    await this.afterAcceptance(quote, name);
    await this.quotesService?.provisionAcceptedQuote(tenantId, quote.id);
    return quote;
  }

  private async afterAcceptance(quote: Quote, name: string): Promise<void> {
    try {
      await this.events.handleCrmEvent({
        tenantId: quote.tenantId,
        eventType: 'quote.accepted',
        entityId: quote.id,
        data: {
          quoteId: quote.id,
          quoteNumber: quote.quoteNumber,
          customerId: quote.customerId,
          customerEmail: quote.customerEmail,
          acceptedByName: name,
          totalAmount: quote.totalAmount,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to emit quote.accepted for ${quote.id}: ${msg}`);
    }
  }

  private async findByToken(token: string): Promise<Quote | null> {
    // Checked before touching the database, so garbage costs nothing.
    if (!TOKEN_SHAPE.test(token ?? '')) return null;
    return this.quotes.findOne({
      where: { acceptanceTokenHash: hashToken(token) },
    });
  }

  /**
   * Why a link cannot be used, or null. Every public route checks this, so
   * a customer response is refused exactly where an acceptance would be.
   */
  refusalFor(
    quote: Quote | null,
    {
      allowAccepted,
      allowDeclined = false,
    }: { allowAccepted: boolean; allowDeclined?: boolean },
  ): AcceptanceRefusal | null {
    if (!quote) return 'NOT_FOUND';
    if (quote.acceptedAt) return allowAccepted ? null : 'ALREADY_ACCEPTED';
    if (quote.supersededAt || quote.status === QuoteStatus.REJECTED) {
      return 'NO_LONGER_AVAILABLE';
    }
    if (
      quote.acceptanceExpiresAt &&
      quote.acceptanceExpiresAt.getTime() < Date.now()
    ) {
      return 'EXPIRED';
    }
    if (quote.customerResponse === 'DECLINED' && !allowDeclined) {
      return 'DECLINED';
    }
    return null;
  }

  refuse(reason: AcceptanceRefusal): never {
    const body = { reason, message: acceptanceRefusalMessage(reason) };
    if (reason === 'NOT_FOUND') throw new NotFoundException(body);
    if (reason === 'ALREADY_ACCEPTED') throw new BadRequestException(body);
    throw new GoneException(body);
  }

  /** Whitelisted field by field. Never spread the entity: it carries cost and internal notes. */
  async toPublic(quote: Quote): Promise<PublicQuoteDto> {
    const [organization, localization] = await Promise.all([
      this.organizations.findOne({ where: { id: quote.tenantId } }),
      this.documentLocalization?.forCustomer(
        quote.tenantId,
        quote.customerId,
        'QUOTE',
      ),
    ]);
    const stages = quote.billingSchedule?.length
      ? quote.billingSchedule
      : DEFAULT_BILLING_SCHEDULE;
    const amounts = allocateStageAmounts(
      {
        subtotalAmount: Number(quote.subtotalAmount),
        discountAmount: Number(quote.discountAmount),
        taxAmount: Number(quote.taxAmount),
        totalAmount: Number(quote.totalAmount),
      },
      stages,
    );

    return {
      language: localization?.language ?? 'en',
      organizationName: organization?.name ?? '',
      seller: {
        legalName: organization?.legalName ?? null,
        taxId: organization?.taxId ?? null,
        registrationNumber: organization?.registrationNumber ?? null,
        email: organization?.email ?? null,
        phone: organization?.phone ?? null,
        website: organization?.website ?? null,
        addressLines: organization
          ? formatOrganizationAddress(organization)
          : [],
        legalNameAr: organization?.legalNameAr || null,
        addressAr: organization?.addressAr || null,
        documentFooter: organization?.documentFooter ?? null,
        // Absolute: the customer's browser is on the web app's origin, and the
        // logo is served by the API.
        logoUrl: organization
          ? absoluteLogoUrl(
              this.config.get('publicApiUrl', { infer: true }),
              OrganizationsService.logoUrl(organization),
            )
          : null,
      },
      quoteNumber: quote.quoteNumber,
      title: quote.title,
      customerName: quote.customerName,
      customerNameAr: localization?.customer?.companyNameAr || null,
      currency: quote.currency,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      paymentTerms: quote.paymentTerms,
      termsAndConditions: quote.termsAndConditions,
      items: (quote.items ?? [])
        .filter((item) => (item.type ?? 'product') === 'product')
        .map((item) => ({
          description: item.description,
          descriptionAr: item.descriptionAr || null,
          quantity: Number(item.quantity) || 0,
          uom: item.uom ?? null,
          unitPrice: Number(item.unitPrice) || 0,
          discount: Number(item.discount) || 0,
          taxRate: Number(item.taxRate) || 0,
          subtotal: Number(item.subtotal) || 0,
        })),
      subtotalAmount: Number(quote.subtotalAmount),
      discountAmount: Number(quote.discountAmount),
      taxAmount: Number(quote.taxAmount),
      totalAmount: Number(quote.totalAmount),
      billingSchedule: stages.map((stage, index) => ({
        label: stage.label,
        percent: stage.percent,
        totalAmount: amounts[index].totalAmount,
      })),
      deposit: await this.publicDeposit(quote),
      acceptedAt: quote.acceptedAt ? quote.acceptedAt.toISOString() : null,
      acceptedByName: quote.acceptedByName,
      customerResponse: quote.customerResponse
        ? {
            kind: quote.customerResponse,
            note: quote.customerResponseNote ?? null,
            name: quote.customerRespondedByName ?? null,
            at: quote.customerRespondedAt
              ? quote.customerRespondedAt.toISOString()
              : null,
          }
        : null,
      proofs: (await this.proofs?.forPublic(quote)) ?? [],
      proofRequired: (await this.proofs?.isRequired(quote)) ?? false,
      proofBlocksAcceptance:
        !quote.acceptedAt && ((await this.proofs?.blocksAcceptance(quote)) ?? false),
    };
  }
}
