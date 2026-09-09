import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { PERMISSIONS } from '@saas/shared';
import { StaffChannelIdentity } from '../entities/staff-channel-identity.entity';
import { ChannelLinkCode } from '../entities/channel-link-code.entity';
import {
  PendingChannelCommand,
  PendingChannelCommandAction,
  PendingChannelCommandStatus,
} from '../entities/pending-channel-command.entity';
import { ChannelProviderType } from '../entities/channel-config.entity';
import { QuotesService } from '../../quotes/quotes.service';
import { InvoicesService } from '../../quotes/invoices.service';
import { Quote, QuoteStatus } from '../../quotes/entities/quote.entity';
import { AiService } from '../../ai/ai.service';
import { AiNotConfiguredException } from '../../ai/interfaces/ai-provider.interface';
import { RbacService } from '../../rbac/rbac.service';
import {
  quoteCommandIntentJsonSchema,
  quoteCommandIntentSchema,
} from '../dto/quote-command-intent.schema';

export interface ChannelCommandResult {
  handled: boolean;
  userId?: string;
  reply?: { body: string };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 8;
const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const PENDING_COMMAND_TTL_MS = 15 * 60 * 1000;

const AFFIRMATIVE_REPLIES = new Set([
  'yes',
  'y',
  'confirm',
  'approve',
  'ok',
  'okay',
  'go ahead',
  'do it',
  'sure',
]);
const NEGATIVE_REPLIES = new Set([
  'no',
  'n',
  'cancel',
  'stop',
  'nevermind',
  'never mind',
  "don't",
  'dont',
]);

const QUOTE_NUMBER_PATTERN = /QT-\d{4}-\d+/i;

/**
 * Lets internal staff approve a quote (and optionally send its invoice) by
 * texting the org's existing Telegram/WhatsApp/Email channel in plain
 * English. Only recognizes senders already linked via a one-time code — see
 * `ChannelsService.processInboundWebhook`, which calls `handleInboundMessage`
 * before falling through to the ordinary customer-contact path.
 */
@Injectable()
export class ChannelCommandService {
  private readonly logger = new Logger(ChannelCommandService.name);

  constructor(
    @InjectRepository(StaffChannelIdentity)
    private readonly identityRepository: Repository<StaffChannelIdentity>,
    @InjectRepository(ChannelLinkCode)
    private readonly linkCodeRepository: Repository<ChannelLinkCode>,
    @InjectRepository(PendingChannelCommand)
    private readonly pendingRepository: Repository<PendingChannelCommand>,
    private readonly quotesService: QuotesService,
    private readonly invoicesService: InvoicesService,
    private readonly aiService: AiService,
    private readonly rbacService: RbacService,
  ) {}

  // ---- Settings-facing API (linking codes + identity management) ----

  async createLinkCode(
    organizationId: string,
    userId: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.linkCodeRepository.save(
      this.linkCodeRepository.create({
        organizationId,
        userId,
        code,
        expiresAt,
      }),
    );
    return { code, expiresAt };
  }

  async listIdentities(
    organizationId: string,
    userId: string,
  ): Promise<StaffChannelIdentity[]> {
    return this.identityRepository.find({
      where: { organizationId, userId },
      order: { createdAt: 'DESC' },
    });
  }

  async revokeIdentity(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    await this.identityRepository.delete({ id, organizationId, userId });
  }

  private generateCode(): string {
    let code = '';
    const bytes = randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
  }

  // ---- Inbound message routing ----

  async handleInboundMessage(
    organizationId: string,
    provider: ChannelProviderType,
    senderIdentifier: string,
    body: string,
  ): Promise<ChannelCommandResult> {
    const trimmed = (body || '').trim();

    const linked = await this.tryConsumeLinkCode(
      organizationId,
      provider,
      senderIdentifier,
      trimmed,
    );
    if (linked) return linked;

    const identity = await this.identityRepository.findOne({
      where: { organizationId, provider, identifier: senderIdentifier },
    });
    if (!identity) {
      return { handled: false };
    }
    const userId = identity.userId;

    const pending = await this.pendingRepository.findOne({
      where: {
        organizationId,
        provider,
        senderIdentifier,
        status: PendingChannelCommandStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });
    if (pending && pending.expiresAt.getTime() > Date.now()) {
      return this.handlePendingReply(pending, userId, trimmed);
    }

    return this.handleFreshCommand(
      organizationId,
      provider,
      senderIdentifier,
      userId,
      trimmed,
    );
  }

  private async tryConsumeLinkCode(
    organizationId: string,
    provider: ChannelProviderType,
    senderIdentifier: string,
    trimmedBody: string,
  ): Promise<ChannelCommandResult | null> {
    if (!trimmedBody || trimmedBody.includes(' ')) return null;

    const candidate = await this.linkCodeRepository.findOne({
      where: {
        organizationId,
        code: trimmedBody.toUpperCase(),
        consumedAt: IsNull(),
      },
    });
    if (!candidate || candidate.expiresAt.getTime() < Date.now()) {
      return null;
    }

    candidate.consumedAt = new Date();
    await this.linkCodeRepository.save(candidate);

    const existing = await this.identityRepository.findOne({
      where: { organizationId, provider, identifier: senderIdentifier },
    });
    if (!existing) {
      await this.identityRepository.save(
        this.identityRepository.create({
          organizationId,
          provider,
          identifier: senderIdentifier,
          userId: candidate.userId,
        }),
      );
    }

    return {
      handled: true,
      userId: candidate.userId,
      reply: {
        body: 'This channel is now linked to your Relay account. You can send quote-approval commands here, e.g. "approve QT-2026-0004".',
      },
    };
  }

  private async handlePendingReply(
    pending: PendingChannelCommand,
    userId: string,
    trimmedBody: string,
  ): Promise<ChannelCommandResult> {
    const normalized = trimmedBody.toLowerCase();

    if (AFFIRMATIVE_REPLIES.has(normalized)) {
      return this.executePending(pending, userId);
    }

    if (NEGATIVE_REPLIES.has(normalized)) {
      pending.status = PendingChannelCommandStatus.CANCELLED;
      pending.resolvedAt = new Date();
      await this.pendingRepository.save(pending);
      return {
        handled: true,
        userId,
        reply: { body: 'Cancelled — no changes made.' },
      };
    }

    return {
      handled: true,
      userId,
      reply: {
        body: `Still waiting on your confirmation for ${await this.describePending(pending)}. Please reply YES to confirm or NO to cancel.`,
      },
    };
  }

  private async describePending(
    pending: PendingChannelCommand,
  ): Promise<string> {
    const quote = await this.quotesService.findQuoteById(
      pending.organizationId,
      pending.quoteId,
    );
    return `quote ${quote.quoteNumber}`;
  }

  private async executePending(
    pending: PendingChannelCommand,
    userId: string,
  ): Promise<ChannelCommandResult> {
    try {
      const quote = await this.quotesService.sendSignal(
        pending.organizationId,
        pending.quoteId,
        'APPROVE',
      );

      const invoice = await this.invoicesService.findByQuoteId(
        pending.organizationId,
        pending.quoteId,
      );
      let sendNote = '';

      if (
        pending.action === PendingChannelCommandAction.APPROVE_AND_SEND &&
        invoice
      ) {
        try {
          await this.invoicesService.sendToCustomer(
            pending.organizationId,
            invoice.id,
          );
          sendNote = ' and emailed to the customer';
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          pending.status = PendingChannelCommandStatus.CONFIRMED;
          pending.resolvedAt = new Date();
          await this.pendingRepository.save(pending);
          return {
            handled: true,
            userId,
            reply: {
              body: `Quote ${quote.quoteNumber} approved and invoice ${invoice.invoiceNumber} created, but sending it failed: ${msg}`,
            },
          };
        }
      }

      pending.status = PendingChannelCommandStatus.CONFIRMED;
      pending.resolvedAt = new Date();
      await this.pendingRepository.save(pending);

      return {
        handled: true,
        userId,
        reply: {
          body: invoice
            ? `Approved quote ${quote.quoteNumber}. Invoice ${invoice.invoiceNumber} for ${invoice.amount} ${invoice.currency} created${sendNote}.`
            : `Approved quote ${quote.quoteNumber}.`,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to execute pending channel command ${pending.id}: ${msg}`,
      );
      return {
        handled: true,
        userId,
        reply: { body: `Could not complete that: ${msg}` },
      };
    }
  }

  private async handleFreshCommand(
    organizationId: string,
    provider: ChannelProviderType,
    senderIdentifier: string,
    userId: string,
    message: string,
  ): Promise<ChannelCommandResult> {
    if (!message) {
      return { handled: true, userId, reply: { body: this.helpMessage() } };
    }

    let intent: ReturnType<typeof quoteCommandIntentSchema.parse> | null = null;
    try {
      const result = await this.aiService.generateStructured<unknown>(
        'channels.parse_quote_command',
        {
          messages: [{ role: 'user', content: message }],
          jsonSchema: quoteCommandIntentJsonSchema,
          schemaName: 'quote_command_intent',
        },
        { organizationId, userId },
      );
      const parsed = quoteCommandIntentSchema.safeParse(result.data);
      if (parsed.success) intent = parsed.data;
    } catch (err: unknown) {
      if (err instanceof AiNotConfiguredException) {
        this.logger.warn(
          'Channel command parsing skipped: AI provider not configured',
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Channel command parsing failed, degrading: ${msg}`);
      }
      return {
        handled: true,
        userId,
        reply: {
          body: 'AI parsing isn\'t available right now — please send the exact quote number, e.g. "approve QT-2026-0004", optionally followed by "and send it".',
        },
      };
    }

    if (!intent || !intent.isQuoteApprovalCommand) {
      return { handled: true, userId, reply: { body: this.helpMessage() } };
    }

    const action =
      intent.action === 'APPROVE_AND_SEND'
        ? PendingChannelCommandAction.APPROVE_AND_SEND
        : PendingChannelCommandAction.APPROVE;

    const quote = await this.resolveQuote(organizationId, message, intent);
    if (!quote) {
      return {
        handled: true,
        userId,
        reply: { body: this.notFoundMessage(message, intent) },
      };
    }
    if (typeof quote === 'string') {
      return { handled: true, userId, reply: { body: quote } };
    }

    const access = await this.rbacService.resolveAccess(userId, organizationId);
    if (!access.permissions.includes(PERMISSIONS.QUOTE_APPROVE)) {
      return {
        handled: true,
        userId,
        reply: { body: "You don't have permission to approve quotes." },
      };
    }
    if (
      action === PendingChannelCommandAction.APPROVE_AND_SEND &&
      !access.permissions.includes(PERMISSIONS.INVOICE_MANAGE)
    ) {
      return {
        handled: true,
        userId,
        reply: { body: "You don't have permission to send invoices." },
      };
    }

    await this.pendingRepository.save(
      this.pendingRepository.create({
        organizationId,
        userId,
        provider,
        senderIdentifier,
        action,
        quoteId: quote.id,
        status: PendingChannelCommandStatus.PENDING,
        expiresAt: new Date(Date.now() + PENDING_COMMAND_TTL_MS),
      }),
    );

    const sendClause =
      action === PendingChannelCommandAction.APPROVE_AND_SEND
        ? ' and email the invoice to the customer'
        : '';

    return {
      handled: true,
      userId,
      reply: {
        body: `Approve quote ${quote.quoteNumber} for ${quote.customerName} (${quote.totalAmount} ${quote.currency})? This will generate an invoice${sendClause}. Reply YES to confirm or NO to cancel.`,
      },
    };
  }

  /** Returns a Quote on a clean single match, a string reply for zero/ambiguous matches, or null for "ask for the number." */
  private async resolveQuote(
    tenantId: string,
    message: string,
    intent: { quoteNumber?: string; customerName?: string },
  ): Promise<Quote | string | null> {
    const numberMatch =
      QUOTE_NUMBER_PATTERN.exec(message) ??
      (intent.quoteNumber
        ? QUOTE_NUMBER_PATTERN.exec(intent.quoteNumber)
        : null);
    const allQuotes = await this.quotesService.findAllQuotes(tenantId);

    if (numberMatch) {
      const found = allQuotes.find(
        (q) => q.quoteNumber?.toUpperCase() === numberMatch[0].toUpperCase(),
      );
      if (!found) return null;
      if (
        found.status !== QuoteStatus.DRAFT &&
        found.status !== QuoteStatus.AWAITING_APPROVAL
      ) {
        return `Quote ${found.quoteNumber} is already ${found.status.toLowerCase()} — nothing to approve.`;
      }
      return found;
    }

    const customerName = intent.customerName?.toLowerCase();
    if (!customerName) return null;

    const candidates = allQuotes.filter(
      (q) =>
        (q.status === QuoteStatus.DRAFT ||
          q.status === QuoteStatus.AWAITING_APPROVAL) &&
        q.customerName?.toLowerCase().includes(customerName),
    );

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const list = candidates
      .map((q) => `${q.quoteNumber} (${q.customerName})`)
      .join(', ');
    return `Found multiple matching quotes: ${list}. Please reply with the specific quote number.`;
  }

  private notFoundMessage(
    message: string,
    intent: { quoteNumber?: string; customerName?: string },
  ): string {
    if (intent.quoteNumber || QUOTE_NUMBER_PATTERN.test(message)) {
      return "I couldn't find a quote with that number.";
    }
    return 'I couldn\'t find a matching quote — try including the exact quote number, e.g. "approve QT-2026-0004".';
  }

  private helpMessage(): string {
    return 'I can approve quotes and generate their invoices — try "approve QT-2026-0004" or "approve the Acme quote and send it".';
  }
}
