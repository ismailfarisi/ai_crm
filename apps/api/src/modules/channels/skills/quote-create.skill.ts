import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { QuotesService } from '../../quotes/quotes.service';
import { ContactsService } from '../../contacts/contacts.service';
import type { ChannelSkill, SkillContext } from './skill.types';

const slotSchema = z.object({
  customerQuery: z.string().optional(),
  title: z.string().optional(),
  currency: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemQuery: z.string().optional(),
        qty: z.number().positive().optional(),
        unitPrice: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
});

export interface ResolvedQuoteCreate {
  customerName: string;
  customerId?: string;
  customerEmail?: string;
  title: string;
  currency: string;
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
  totalAmount: number;
}

const jsonSchema = {
  type: 'object',
  properties: {
    customerQuery: {
      type: 'string',
      description:
        'The customer or company name being quoted FOR, e.g. "Acme Corp" or "John Doe". Omit if not mentioned in the message.',
    },
    title: {
      type: 'string',
      description: 'Short title or summary for the quote, e.g. "IT Equipment".',
    },
    currency: {
      type: 'string',
      description:
        '3-letter currency code if mentioned, e.g. "USD", "EUR". Defaults to USD.',
    },
    lines: {
      type: 'array',
      description: 'One entry per distinct item or service being quoted.',
      items: {
        type: 'object',
        properties: {
          itemQuery: {
            type: 'string',
            description:
              'The item or service description, e.g. "Laptop" or "Consulting". Copy the words used.',
          },
          qty: {
            type: 'number',
            description: 'Quantity as a number.',
          },
          unitPrice: {
            type: 'number',
            description: 'Unit price as a number, if stated.',
          },
        },
      },
    },
  },
  additionalProperties: false,
} as const;

export class QuoteCreateSkill implements ChannelSkill<ResolvedQuoteCreate> {
  readonly name = CHANNEL_SKILLS.QUOTE_CREATE;
  readonly description =
    'Draft a new sales quote for a customer with line items and quantities. Use for messages asking to quote, prepare a quote, price or draft a proposal for a customer.';
  readonly examples = [
    'create a quote for Acme Corp: 5 Laptops at 1200 each and 10 Mice at 25',
    'quote for Brightline: 100 boxes of paper',
    'draft a quote for John Doe for 3 hours consulting at 150/hr',
    'new quote for Wayne Enterprises: 2 custom servers',
  ];
  readonly requiredPermissions = [PERMISSIONS.QUOTE_CREATE];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'quote-create/1';

  constructor(
    private readonly quotes: QuotesService,
    private readonly contacts: ContactsService,
  ) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedQuoteCreate>> {
    const working = { ...slots } as Record<string, unknown>;
    const parsed = slotSchema.safeParse(working);
    if (!parsed.success) {
      return {
        kind: 'refused',
        reason: 'I could not make sense of the quote details.',
      };
    }

    const customerQuery = (
      parsed.data.customerQuery ||
      (working.customerQuery as string) ||
      ''
    ).trim();
    if (!customerQuery) {
      return {
        kind: 'question',
        question:
          'Who is this quote for? Please provide the customer or company name.',
        slots: working,
      };
    }

    const rawLines = (parsed.data.lines ?? []).filter(
      (l) => l.itemQuery && l.itemQuery.trim().length > 0,
    );
    if (rawLines.length === 0) {
      return {
        kind: 'question',
        question: `What items or services and quantities should be included in the quote for ${customerQuery}?`,
        slots: working,
      };
    }

    const resolvedLines = rawLines.map((l) => {
      const quantity = l.qty && l.qty > 0 ? l.qty : 1;
      const unitPrice =
        l.unitPrice != null && l.unitPrice >= 0 ? l.unitPrice : 0;
      return {
        description: l.itemQuery!.trim(),
        quantity,
        unitPrice,
        subtotal: quantity * unitPrice,
      };
    });

    const totalAmount = resolvedLines.reduce(
      (sum, line) => sum + line.subtotal,
      0,
    );
    const currency = (parsed.data.currency || 'USD').toUpperCase();
    const title = parsed.data.title || `Quote for ${customerQuery}`;

    return {
      kind: 'resolved',
      value: {
        customerName: customerQuery,
        title,
        currency,
        lines: resolvedLines,
        totalAmount,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedQuoteCreate): Promise<string> {
    const linesText = resolved.lines
      .map(
        (l) =>
          `• ${l.quantity} × ${l.description} @ ${l.unitPrice.toFixed(2)} → ${l.subtotal.toFixed(2)}`,
      )
      .join('\n');

    return (
      `Draft Quote for ${resolved.customerName} (${resolved.lines.length} item${resolved.lines.length === 1 ? '' : 's'})\n\n` +
      `${linesText}\n\n` +
      `Total: ${resolved.totalAmount.toFixed(2)} ${resolved.currency}\n` +
      `Status: DRAFT (awaiting approval)\n\n` +
      `Reply YES to create this quote in the CRM, or NO to cancel.`
    );
  }

  async execute(
    resolved: ResolvedQuoteCreate,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    const quote = await this.quotes.createQuote(ctx.organizationId, {
      title: resolved.title,
      customerName: resolved.customerName,
      currency: resolved.currency,
      items: resolved.lines.map((l, i) => ({
        id: `line-${i + 1}`,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.subtotal,
        type: 'product',
      })),
      createdBy: 'HUMAN',
    });

    return {
      reply:
        `Created quote ${quote.quoteNumber} for ${quote.customerName} (${Number(quote.totalAmount).toFixed(2)} ${quote.currency}).\n\n` +
        `It is saved in DRAFT. You can view it in the CRM or reply "approve ${quote.quoteNumber}" to approve and generate an invoice.`,
      resultType: 'QUOTE',
      resultId: quote.id,
    };
  }
}
