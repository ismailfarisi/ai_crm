import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { QuotesService } from '../../quotes/quotes.service';
import { InvoicesService } from '../../quotes/invoices.service';
import { QuoteStatus } from '../../quotes/entities/quote.entity';
import type { ChannelSkill, SkillContext } from './skill.types';

const QUOTE_NUMBER_PATTERN = /QT-\d{4}-\d+/i;

const slotSchema = z.object({
  action: z.enum(['APPROVE', 'APPROVE_AND_SEND']).optional(),
  quoteNumber: z.string().optional(),
  customerName: z.string().optional(),
});

export interface ResolvedQuoteApproval {
  quoteId: string;
  quoteNumber: string;
  customerName: string;
  totalAmount: number;
  currency: string;
  alsoSend: boolean;
}

const jsonSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['APPROVE', 'APPROVE_AND_SEND'],
      description:
        'APPROVE_AND_SEND if the message also asks to send or email the invoice to the customer, otherwise APPROVE.',
    },
    quoteNumber: {
      type: 'string',
      description: 'The quote number mentioned, e.g. "QT-2026-0004", if any.',
    },
    customerName: {
      type: 'string',
      description: 'The customer or company name mentioned, if any.',
    },
  },
  additionalProperties: false,
} as const;

/**
 * Approve an existing quote, optionally emailing the resulting invoice.
 *
 * This is the behaviour `ChannelCommandService` used to implement directly.
 * Moving it onto the registry unchanged is what demonstrates the abstraction
 * fits both shapes a skill can take — a lookup against existing records, and
 * the multi-turn construction that `purchase_order.create` needs.
 */
export class QuoteApproveSkill implements ChannelSkill<ResolvedQuoteApproval> {
  readonly name = CHANNEL_SKILLS.QUOTE_APPROVE;
  readonly description =
    'Approve a quote that is already in the system, turning it into an invoice, and optionally email that invoice to the customer. Use for messages approving, signing off or accepting an existing quote.';
  readonly examples = [
    'approve QT-2026-0004',
    'approve the Acme quote and send it',
    'sign off the quote for Brightline',
    'yes approve QT-2026-0011 and email the invoice',
  ];
  readonly requiredPermissions = [PERMISSIONS.QUOTE_APPROVE];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'quote-approve/1';

  constructor(
    private readonly quotes: QuotesService,
    private readonly invoices: InvoicesService,
  ) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedQuoteApproval>> {
    const parsed = slotSchema.safeParse(slots);
    if (!parsed.success) {
      return { kind: 'refused', reason: 'I could not make sense of that.' };
    }
    const intent = parsed.data;
    const alsoSend = intent.action === 'APPROVE_AND_SEND';

    // Sending an invoice is a second, separately-permissioned act. Checked
    // here rather than at execution so the user is told before being asked
    // to confirm something that would then fail.
    if (alsoSend && !ctx.permissions.includes(PERMISSIONS.INVOICE_MANAGE)) {
      return {
        kind: 'refused',
        reason: "You don't have permission to send invoices.",
      };
    }

    const all = await this.quotes.findAllQuotes(ctx.organizationId);
    const approvable = (status: QuoteStatus) =>
      status === QuoteStatus.DRAFT || status === QuoteStatus.AWAITING_APPROVAL;

    const numberMatch =
      QUOTE_NUMBER_PATTERN.exec(ctx.message) ??
      (intent.quoteNumber
        ? QUOTE_NUMBER_PATTERN.exec(intent.quoteNumber)
        : null);

    if (numberMatch) {
      const found = all.find(
        (q) => q.quoteNumber?.toUpperCase() === numberMatch[0].toUpperCase(),
      );
      if (!found) {
        return {
          kind: 'refused',
          reason: "I couldn't find a quote with that number.",
        };
      }
      if (!approvable(found.status)) {
        return {
          kind: 'refused',
          reason: `Quote ${found.quoteNumber} is already ${found.status.toLowerCase()} — nothing to approve.`,
        };
      }
      return { kind: 'resolved', value: this.toResolved(found, alsoSend) };
    }

    const customerName = intent.customerName?.toLowerCase();
    if (!customerName) {
      return {
        kind: 'question',
        question:
          'Which quote? Send the number, e.g. "QT-2026-0004", or the customer name.',
        slots,
      };
    }

    const candidates = all.filter(
      (q) =>
        approvable(q.status) &&
        q.customerName?.toLowerCase().includes(customerName),
    );
    if (candidates.length === 0) {
      return {
        kind: 'refused',
        reason: `I couldn't find an open quote for "${intent.customerName}".`,
      };
    }
    if (candidates.length > 1) {
      return {
        kind: 'question',
        question: `Found several open quotes: ${candidates
          .map((q) => `${q.quoteNumber} (${q.customerName})`)
          .join(', ')}. Which one?`,
        slots,
      };
    }
    return {
      kind: 'resolved',
      value: this.toResolved(candidates[0], alsoSend),
    };
  }

  private toResolved(
    quote: {
      id: string;
      quoteNumber: string | null;
      customerName: string;
      totalAmount: number;
      currency: string;
    },
    alsoSend: boolean,
  ): ResolvedQuoteApproval {
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber ?? '(unnumbered)',
      customerName: quote.customerName,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      alsoSend,
    };
  }

  // The interface is async because other skills need to look things up to
  // build a preview; this one already has everything resolved.
  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedQuoteApproval): Promise<string> {
    const sendClause = resolved.alsoSend
      ? ' and email the invoice to the customer'
      : '';
    return (
      `Approve quote ${resolved.quoteNumber} for ${resolved.customerName} ` +
      `(${resolved.totalAmount} ${resolved.currency})? ` +
      `This will generate an invoice${sendClause}.\n\nReply YES to confirm or NO to cancel.`
    );
  }

  async execute(
    resolved: ResolvedQuoteApproval,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    const quote = await this.quotes.sendSignal(
      ctx.organizationId,
      resolved.quoteId,
      'APPROVE',
    );
    const invoice = await this.invoices.findByQuoteId(
      ctx.organizationId,
      resolved.quoteId,
    );

    if (!invoice) {
      return {
        reply: `Approved quote ${quote.quoteNumber}.`,
        resultType: 'QUOTE',
        resultId: quote.id,
      };
    }

    let sendNote = '';
    if (resolved.alsoSend) {
      try {
        await this.invoices.sendToCustomer(ctx.organizationId, invoice.id);
        sendNote = ' and emailed to the customer';
      } catch (err: unknown) {
        // The approval already happened and must not be reported as failed —
        // say precisely which half worked.
        const msg = err instanceof Error ? err.message : String(err);
        return {
          reply: `Quote ${quote.quoteNumber} approved and invoice ${invoice.invoiceNumber} created, but sending it failed: ${msg}`,
          resultType: 'INVOICE',
          resultId: invoice.id,
        };
      }
    }

    return {
      reply: `Approved quote ${quote.quoteNumber}. Invoice ${invoice.invoiceNumber} for ${invoice.amount} ${invoice.currency} created${sendNote}.`,
      resultType: 'INVOICE',
      resultId: invoice.id,
    };
  }
}
