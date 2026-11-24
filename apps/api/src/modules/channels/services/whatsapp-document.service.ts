import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  formatDisplayDate,
  PERMISSIONS,
  type SendOnWhatsAppPayload,
  type WhatsAppSendResultDto,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { ContactsService } from '@/modules/contacts/contacts.service';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { InvoiceStatus } from '@/modules/quotes/entities/invoice.entity';
import { InvoicesService } from '@/modules/quotes/invoices.service';
import { QuoteAcceptanceService } from '@/modules/quotes/quote-acceptance.service';
import { QuoteProofsService } from '@/modules/quotes/quote-proofs.service';
import { ChannelsService } from '../channels.service';
import {
  ChannelConfig,
  ChannelProviderType,
} from '../entities/channel-config.entity';
import { ChannelMessage } from '../entities/channel-message.entity';
import { phoneOnRecord } from '../agents/sender-identity';
import {
  insideWhatsAppWindow,
  lastWhatsAppMessageFrom,
} from '../whatsapp-window';
import { ChannelCryptoService } from './channel-crypto.service';

interface Outgoing {
  customerId: string | null;
  customerName: string;
  /** What is being sent, for the template's first blank: "quote Q-0012". */
  label: string;
  text: string;
  url: string | null;
  kind: 'quote' | 'proof' | 'invoice';
  documentId: string;
}

const FALLBACK = 'so it opens WhatsApp on your own phone or computer instead.';

/**
 * Sends a customer the link to a quote, an artwork proof or an invoice on
 * WhatsApp. The business's connected number sends it when WhatsApp allows:
 * free text inside 24 hours of the customer's last message, an approved
 * template outside them. Otherwise staff get a click-to-chat link with the
 * message filled in, to send from their own WhatsApp.
 */
@Injectable()
export class WhatsAppDocumentService {
  private readonly logger = new Logger(WhatsAppDocumentService.name);

  constructor(
    @InjectRepository(ChannelConfig)
    private readonly configs: Repository<ChannelConfig>,
    @InjectRepository(ChannelMessage)
    private readonly messages: Repository<ChannelMessage>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
    private readonly channels: ChannelsService,
    private readonly crypto: ChannelCryptoService,
    private readonly contacts: ContactsService,
    private readonly acceptance: QuoteAcceptanceService,
    private readonly proofs: QuoteProofsService,
    private readonly invoices: InvoicesService,
  ) {}

  async sendQuote(
    user: AuthenticatedUser,
    quoteId: string,
    input: SendOnWhatsAppPayload = {},
  ): Promise<WhatsAppSendResultDto> {
    const tenantId = user.organizationId;
    const quote = await this.loadQuote(tenantId, quoteId);
    const to = await this.numberFor(tenantId, quote.customerId, input.to);
    const link = await this.acceptance.createLink(tenantId, quoteId);
    const sender = await this.senderName(tenantId);
    const reference = quote.quoteNumber ?? 'your quote';
    const result = await this.deliver(user, to, {
      customerId: quote.customerId,
      customerName: quote.customerName,
      label: quote.quoteNumber ? `quote ${quote.quoteNumber}` : 'your quote',
      url: link.url,
      kind: 'quote',
      documentId: quote.id,
      text: [
        `Hi ${quote.customerName},`,
        `Here is ${reference}${quote.title ? ` (${quote.title})` : ''} from ${sender}. You can view and accept it here: ${link.url}`,
      ].join('\n\n'),
    });
    if (result.method === 'CHANNEL') {
      await this.acceptance.recordSent(tenantId, quoteId, `WhatsApp +${to}`);
    }
    return result;
  }

  async sendProof(
    user: AuthenticatedUser,
    quoteId: string,
    input: SendOnWhatsAppPayload = {},
  ): Promise<WhatsAppSendResultDto> {
    const tenantId = user.organizationId;
    const quote = await this.loadQuote(tenantId, quoteId);
    const proof = await this.proofs.latestFor(tenantId, quoteId);
    if (!proof) {
      throw new BadRequestException(
        'There is no artwork proof on this quote yet. Upload one first.',
      );
    }
    const to = await this.numberFor(tenantId, quote.customerId, input.to);
    // The proof is shown and answered on the quote's own customer page.
    const link = await this.acceptance.createLink(tenantId, quoteId);
    const sender = await this.senderName(tenantId);
    const reference = quote.quoteNumber ?? 'your quote';
    return this.deliver(user, to, {
      customerId: quote.customerId,
      customerName: quote.customerName,
      label: `artwork proof ${proof.version} for ${reference}`,
      url: link.url,
      kind: 'proof',
      documentId: proof.id,
      text: [
        `Hi ${quote.customerName},`,
        `The artwork proof (version ${proof.version}) for ${reference} from ${sender} is ready. Please check it and approve it or ask for changes here: ${link.url}`,
      ].join('\n\n'),
    });
  }

  async sendInvoice(
    user: AuthenticatedUser,
    invoiceId: string,
    input: SendOnWhatsAppPayload = {},
  ): Promise<WhatsAppSendResultDto> {
    const tenantId = user.organizationId;
    const { invoice, payUrl } = await this.invoices.payLinkFor(
      tenantId,
      invoiceId,
    );
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        'This invoice is cancelled, so it cannot be sent.',
      );
    }
    const to = await this.numberFor(tenantId, invoice.customerId, input.to);
    const sender = await this.senderName(tenantId);
    const amount = `${invoice.currency} ${Number(invoice.amount).toFixed(2)}`;
    const due = invoice.dueDate
      ? `, due ${formatDisplayDate(invoice.dueDate)}`
      : '';
    const result = await this.deliver(user, to, {
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      label: `invoice ${invoice.invoiceNumber}`,
      url: payUrl,
      kind: 'invoice',
      documentId: invoice.id,
      text: [
        `Hi ${invoice.customerName},`,
        `Here is invoice ${invoice.invoiceNumber} from ${sender} for ${amount}${due}.` +
          (payUrl ? ` You can view and pay it here: ${payUrl}` : ''),
      ].join('\n\n'),
    });
    if (result.method === 'CHANNEL') {
      await this.invoices.markSent(tenantId, invoiceId);
    }
    return result;
  }

  private async loadQuote(tenantId: string, quoteId: string): Promise<Quote> {
    const quote = await this.quotes.findOne({
      where: { id: quoteId, tenantId },
    });
    if (!quote)
      throw new NotFoundException(`Quote with ID ${quoteId} not found`);
    return quote;
  }

  private async senderName(tenantId: string): Promise<string> {
    const org = await this.organizations.findOne({ where: { id: tenantId } });
    return org?.legalName || org?.name || 'us';
  }

  /** The customer's number in international form, digits only. */
  private async numberFor(
    tenantId: string,
    customerId: string | null,
    typed: string | null | undefined,
  ): Promise<string> {
    const customer = customerId
      ? await this.customers.findOne({ where: { id: customerId, tenantId } })
      : null;
    const org = await this.organizations.findOne({ where: { id: tenantId } });
    const country = customer?.country || org?.country || null;
    if (typed?.trim()) {
      const number = phoneOnRecord(typed, country);
      if (!number) {
        throw new BadRequestException(
          'That is not a number WhatsApp can use. Write it with the country code, for example +971 50 123 4567.',
        );
      }
      return number;
    }
    const number = phoneOnRecord(customer?.phone, country);
    if (!number) {
      throw new BadRequestException(
        customer?.phone
          ? `The phone number on this customer (${customer.phone}) is not one WhatsApp can use. Type the mobile number with the country code, for example +971 50 123 4567.`
          : 'This customer has no phone number. Type their mobile number, or add it to the customer.',
      );
    }
    return number;
  }

  private async deliver(
    user: AuthenticatedUser,
    to: string,
    out: Outgoing,
  ): Promise<WhatsAppSendResultDto> {
    const tenantId = user.organizationId;
    const clickToChat = (reason: string): WhatsAppSendResultDto => ({
      method: 'CLICK_TO_CHAT',
      to,
      text: out.text,
      url: out.url,
      chatUrl: `https://wa.me/${to}?text=${encodeURIComponent(out.text)}`,
      reason,
      usedTemplate: false,
    });

    const config = await this.configs.findOne({
      where: {
        organizationId: tenantId,
        provider: ChannelProviderType.WHATSAPP_META,
      },
    });
    if (!config?.isEnabled || !config.encryptedCredentials) {
      return clickToChat(
        `Your business WhatsApp number is not connected, ${FALLBACK}`,
      );
    }
    if (!user.permissions.includes(PERMISSIONS.CHANNEL_SEND)) {
      return clickToChat(
        `You are not allowed to send from the business WhatsApp number, ${FALLBACK}`,
      );
    }

    const last = await lastWhatsAppMessageFrom(this.messages, tenantId, to);
    let template:
      { name: string; language: string; parameters: string[] } | undefined;
    if (!insideWhatsAppWindow(last)) {
      const credentials = this.crypto.decrypt(config.encryptedCredentials);
      const name = String(credentials?.documentTemplateName ?? '').trim();
      if (!name) {
        return clickToChat(
          `${out.customerName} has not written to your business WhatsApp in the last 24 hours. WhatsApp then only allows an approved message template, and none is set up, ${FALLBACK}`,
        );
      }
      template = {
        name,
        language:
          String(credentials?.documentTemplateLanguage ?? '').trim() || 'en',
        // A template blank cannot hold a line break.
        parameters: [out.label, out.url ?? out.text.replace(/\s+/g, ' ')],
      };
    }

    // The conversation the customer already has in the inbox, or a new one.
    const contactId =
      last?.contactId ??
      (
        await this.contacts.findOrCreateForChannel(
          tenantId,
          to,
          ChannelProviderType.WHATSAPP_META,
        )
      ).id;

    try {
      await this.channels.sendMessage(tenantId, user.id, {
        provider: ChannelProviderType.WHATSAPP_META,
        recipient: to,
        body: out.text,
        contactId,
        ...(template ? { template } : {}),
        metadata: { document: { kind: out.kind, id: out.documentId } },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `WhatsApp send of ${out.kind} ${out.documentId} failed: ${msg}`,
      );
      return clickToChat(
        // Meta's own error text can echo credentials; it stays in the server log.
        `WhatsApp did not accept the message from your business number, ${FALLBACK}`,
      );
    }
    return {
      method: 'CHANNEL',
      to,
      text: out.text,
      url: out.url,
      chatUrl: null,
      reason: null,
      usedTemplate: !!template,
    };
  }
}
