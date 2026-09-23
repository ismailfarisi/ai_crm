import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { QuotesService } from '../../quotes/quotes.service';
import { OrdersService } from '../../orders/orders.service';
import {
  Quote,
  QuoteCreatedBy,
  QuoteStatus,
} from '../../quotes/entities/quote.entity';
import type { ChannelSkill, SkillContext } from './skill.types';

const QUOTE_NUMBER_PATTERN = /QT-\d{4}-\d+/i;
const PO_NUMBER_PATTERN =
  /\b(?:P\.?O\.?|PURCHASE\s*ORDER)(?:[-\s#:]+|\s*#\s*|(?=\d))([A-Z0-9_-]+)/i;

const slotSchema = z.object({
  customerPoNumber: z.string().optional(),
  quoteNumber: z.string().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email('Invalid email address').optional(),
  description: z.string().optional(),
  totalAmount: z.number().positive().optional(),
});

export interface ResolvedSalesOrderFromDocument {
  mode: 'MATCHED_QUOTE' | 'NEW_QUOTE';
  quoteId: string;
  quoteNumber: string;
  customerPoNumber: string;
  customerName: string;
  totalAmount: number;
  currency: string;
  itemsCount: number;
}

const jsonSchema = {
  type: 'object',
  properties: {
    customerPoNumber: {
      type: 'string',
      description:
        'The customer purchase order reference, e.g. "PO-9912" or "PO#1234", if any.',
    },
    quoteNumber: {
      type: 'string',
      description:
        'The internal quote number referenced, e.g. "QT-2026-0004", if any.',
    },
    customerName: {
      type: 'string',
      description: 'The customer or company name placing the purchase order.',
    },
    customerEmail: {
      type: 'string',
      description: 'Customer email address if stated in the message',
    },
    description: {
      type: 'string',
      description:
        'Brief description of what was ordered if this is a new purchase order without a prior quote.',
    },
    totalAmount: {
      type: 'number',
      description: 'The total value stated in the purchase order, if any.',
    },
  },
  additionalProperties: false,
} as const;

export class SalesOrderFromDocumentSkill implements ChannelSkill<ResolvedSalesOrderFromDocument> {
  readonly name = CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT;
  readonly description =
    'Convert a customer purchase order document or message into a confirmed sales order, matching an existing open quote or provisioning a new order.';
  readonly examples = [
    'customer sent PO-9912 for quote QT-2026-0004',
    'create sales order from customer PO-4551 for Acme Corp: 500 units of custom boxes',
    'customer PO-1029 approving our quote QT-2026-0010',
    'turn customer PO-8831 into an order',
  ];
  readonly requiredPermissions = [PERMISSIONS.SALES_ORDER_UPDATE];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'so-from-doc/1';

  constructor(
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
  ) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedSalesOrderFromDocument>> {
    const parsed = slotSchema.safeParse(slots);
    if (!parsed.success) {
      return {
        kind: 'refused',
        reason: 'I could not make sense of the purchase order.',
      };
    }
    const data = parsed.data;

    const poMatch =
      PO_NUMBER_PATTERN.exec(ctx.message) ??
      (data.customerPoNumber
        ? PO_NUMBER_PATTERN.exec(data.customerPoNumber)
        : null);
    const customerPo = poMatch
      ? poMatch[0].trim()
      : data.customerPoNumber?.trim() || 'Customer-PO';

    const quoteMatch =
      QUOTE_NUMBER_PATTERN.exec(ctx.message) ??
      (data.quoteNumber ? QUOTE_NUMBER_PATTERN.exec(data.quoteNumber) : null);
    const rawQuoteNumber = quoteMatch
      ? quoteMatch[0].toUpperCase()
      : data.quoteNumber
        ? data.quoteNumber.trim().toUpperCase()
        : null;

    const allQuotes = await this.quotes.findAllQuotes(ctx.organizationId);

    if (rawQuoteNumber) {
      const quote = allQuotes.find(
        (q) => q.quoteNumber?.toUpperCase() === rawQuoteNumber,
      );
      if (!quote) {
        return {
          kind: 'refused',
          reason: `I couldn't find quote ${rawQuoteNumber}.`,
        };
      }
      return this.resolveExistingQuote(quote, customerPo, ctx);
    }

    if (data.customerName) {
      const customerNameLower = data.customerName.toLowerCase();
      const openQuotes = allQuotes.filter(
        (q) =>
          (q.status === QuoteStatus.DRAFT ||
            q.status === QuoteStatus.AWAITING_APPROVAL) &&
          q.customerName?.toLowerCase().includes(customerNameLower),
      );

      if (openQuotes.length === 1) {
        return this.resolveExistingQuote(openQuotes[0], customerPo, ctx);
      }
      if (openQuotes.length > 1) {
        return {
          kind: 'question',
          question: `Found multiple open quotes for "${data.customerName}": ${openQuotes
            .map((q) => `${q.quoteNumber} (${q.totalAmount} ${q.currency})`)
            .join(', ')}. Which quote does ${customerPo} approve?`,
          slots,
        };
      }
    }

    if (data.customerName || data.description) {
      if (
        !ctx.permissions.includes(PERMISSIONS.QUOTE_CREATE) ||
        !ctx.permissions.includes(PERMISSIONS.QUOTE_APPROVE)
      ) {
        return {
          kind: 'refused',
          reason:
            'Creating a new order requires permission to create and approve quotes.',
        };
      }

      const customerEmail =
        data.customerEmail ||
        (ctx.senderIdentifier.includes('@') ? ctx.senderIdentifier : undefined);

      const created = await this.quotes.createQuote(ctx.organizationId, {
        title: `PO ${customerPo}: ${data.description || 'Customer Order'}`,
        customerName: data.customerName || 'General Customer',
        customerEmail,
        prompt: `Customer PO: ${customerPo}\nOrder: ${data.description || 'Customer order from chat'}\nAmount: ${data.totalAmount || 0}`,
        notes: `Customer PO: ${customerPo}`,
        createdBy: QuoteCreatedBy.AI,
        totalAmount: data.totalAmount,
      });

      return {
        kind: 'resolved',
        value: {
          mode: 'NEW_QUOTE',
          quoteId: created.id,
          quoteNumber: created.quoteNumber || '(new)',
          customerPoNumber: customerPo,
          customerName: created.customerName || data.customerName || 'Customer',
          totalAmount: created.totalAmount || data.totalAmount || 0,
          currency: created.currency || 'USD',
          itemsCount: (created.items || []).length || 1,
        },
      };
    }

    return {
      kind: 'question',
      question:
        'Which quote or customer is this purchase order for? Send the quote number (e.g. "QT-2026-0004") or the customer name and PO reference.',
      slots,
    };
  }

  private async resolveExistingQuote(
    quote: Quote,
    customerPo: string,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedSalesOrderFromDocument>> {
    const existingOrder = await this.orders.findByQuote(
      ctx.organizationId,
      quote.id,
    );
    if (existingOrder && existingOrder.status !== 'CANCELLED') {
      return {
        kind: 'refused',
        reason: `Quote ${quote.quoteNumber} already has Sales Order ${existingOrder.orderNumber}.`,
      };
    }

    if (
      quote.status !== QuoteStatus.DRAFT &&
      quote.status !== QuoteStatus.AWAITING_APPROVAL
    ) {
      return {
        kind: 'refused',
        reason: `Quote ${quote.quoteNumber} is already ${String(quote.status).toLowerCase()} — nothing to approve.`,
      };
    }

    return {
      kind: 'resolved',
      value: {
        mode: 'MATCHED_QUOTE',
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber ?? '(unnumbered)',
        customerPoNumber: customerPo,
        customerName: quote.customerName,
        totalAmount: quote.totalAmount,
        currency: quote.currency,
        itemsCount: (quote.items || []).length,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(
    resolved: ResolvedSalesOrderFromDocument,
    _ctx: SkillContext,
  ): Promise<string> {
    const modeDesc =
      resolved.mode === 'MATCHED_QUOTE'
        ? `Create Sales Order for ${resolved.customerName} against ${resolved.customerPoNumber} by approving quote ${resolved.quoteNumber}?`
        : `Create and provision Sales Order for ${resolved.customerName} from customer ${resolved.customerPoNumber} (Quote ${resolved.quoteNumber})?`;

    return (
      `${modeDesc}\n\n` +
      `Total: ${resolved.totalAmount} ${resolved.currency} (${resolved.itemsCount} line items)\n` +
      `This will provision a sales order and issue any initial billing stage invoice.\n\n` +
      `Reply YES to confirm or NO to cancel.`
    );
  }

  async execute(
    resolved: ResolvedSalesOrderFromDocument,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    await this.quotes.sendSignal(
      ctx.organizationId,
      resolved.quoteId,
      'APPROVE',
    );
    const order = await this.orders.findByQuote(
      ctx.organizationId,
      resolved.quoteId,
    );

    const orderNum = order ? order.orderNumber : '(provisioned)';
    return {
      reply: `Created Sales Order ${orderNum} for ${resolved.customerName} from ${resolved.customerPoNumber} (Quote ${resolved.quoteNumber}).`,
      resultType: 'SALES_ORDER',
      resultId: order ? order.id : resolved.quoteId,
    };
  }
}
