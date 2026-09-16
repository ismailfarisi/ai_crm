import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
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
  type AcceptanceRefusal,
  type PublicQuoteDto,
} from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { Organization } from '../organizations/entities/organization.entity';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { Quote, QuoteStatus } from './entities/quote.entity';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Tokens are 32 random bytes as base64url: 43 characters, nothing else. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A customer accepting a quote from a link, without an account.
 *
 * Acceptance is recorded, not acted on. Approval stays an internal decision,
 * because approval is where the margin floors are enforced against the
 * approver's own permissions — letting a customer's click create the order
 * would let anyone with the link walk a below-floor quote past them.
 * `quote.accepted` is emitted so a tenant who wants acceptance to approve
 * can build that as an automation, with a person in the loop.
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
  ) {}

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

    const token = randomBytes(32).toString('base64url');
    const fallback = new Date(
      Date.now() + ACCEPTANCE_LINK_DEFAULT_DAYS * 24 * 60 * 60 * 1000,
    );
    const expiresAt =
      quote.validUntil && quote.validUntil.getTime() > Date.now()
        ? quote.validUntil
        : fallback;

    await this.quotes.update(
      { id: quote.id, tenantId },
      { acceptanceTokenHash: hashToken(token), acceptanceExpiresAt: expiresAt },
    );

    const origin = this.config.get('webOrigin', { infer: true })[0];
    return { url: `${origin}/q/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async view(token: string): Promise<PublicQuoteDto> {
    const quote = await this.findByToken(token);
    const refusal = this.refusalFor(quote, { allowAccepted: true });
    if (refusal) this.refuse(refusal);
    return this.toPublic(quote!);
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

    const quote = await this.findByToken(token);
    const refusal = this.refusalFor(quote, { allowAccepted: false });
    if (refusal) this.refuse(refusal);

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
      .execute();
    if (!result.affected) this.refuse('ALREADY_ACCEPTED');

    quote!.acceptedAt = acceptedAt;
    quote!.acceptedByName = name;

    try {
      await this.events.handleCrmEvent({
        tenantId: quote!.tenantId,
        eventType: 'quote.accepted',
        entityId: quote!.id,
        data: {
          quoteId: quote!.id,
          quoteNumber: quote!.quoteNumber,
          customerId: quote!.customerId,
          customerEmail: quote!.customerEmail,
          acceptedByName: name,
          totalAmount: quote!.totalAmount,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to emit quote.accepted for ${quote!.id}: ${msg}`,
      );
    }

    return this.toPublic(quote!);
  }

  private async findByToken(token: string): Promise<Quote | null> {
    // Checked before touching the database, so garbage costs nothing.
    if (!TOKEN_SHAPE.test(token ?? '')) return null;
    return this.quotes.findOne({
      where: { acceptanceTokenHash: hashToken(token) },
    });
  }

  private refusalFor(
    quote: Quote | null,
    { allowAccepted }: { allowAccepted: boolean },
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
    return null;
  }

  private refuse(reason: AcceptanceRefusal): never {
    const body = { reason, message: acceptanceRefusalMessage(reason) };
    if (reason === 'NOT_FOUND') throw new NotFoundException(body);
    if (reason === 'ALREADY_ACCEPTED') throw new BadRequestException(body);
    throw new GoneException(body);
  }

  /** Whitelisted field by field. Never spread the entity: it carries cost and internal notes. */
  private async toPublic(quote: Quote): Promise<PublicQuoteDto> {
    const organization = await this.organizations.findOne({
      where: { id: quote.tenantId },
    });
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
      organizationName: organization?.name ?? '',
      seller: {
        legalName: organization?.legalName ?? null,
        taxId: organization?.taxId ?? null,
        registrationNumber: organization?.registrationNumber ?? null,
        email: organization?.email ?? null,
        phone: organization?.phone ?? null,
        website: organization?.website ?? null,
        addressLines: organization ? formatOrganizationAddress(organization) : [],
        documentFooter: organization?.documentFooter ?? null,
      },
      quoteNumber: quote.quoteNumber,
      title: quote.title,
      customerName: quote.customerName,
      currency: quote.currency,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      paymentTerms: quote.paymentTerms,
      termsAndConditions: quote.termsAndConditions,
      items: (quote.items ?? [])
        .filter((item) => (item.type ?? 'product') === 'product')
        .map((item) => ({
          description: item.description,
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
      acceptedAt: quote.acceptedAt ? quote.acceptedAt.toISOString() : null,
      acceptedByName: quote.acceptedByName,
    };
  }
}
