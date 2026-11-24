import { z } from 'zod';

/**
 * Validates the AI model's structured receipt extraction before it's trusted —
 * the model can return malformed data, this is the safety net.
 */
export const expenseItemResultSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number(),
  amount: z.number(),
});

export const scannedReceiptResultSchema = z.object({
  merchantName: z.string(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  expenseDate: z.string(),
  category: z.string(),
  taxAmount: z
    .number()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? undefined),
  supplierTaxId: z
    .string()
    .nullish()
    .transform((v) => v?.trim() || undefined),
  confidence: z.number().min(0).max(1),
  items: z.array(expenseItemResultSchema).default([]),
});

export type ScannedReceiptResultParsed = z.infer<
  typeof scannedReceiptResultSchema
>;

/**
 * Hand-kept JSON-Schema mirror of `scannedReceiptResultSchema`, for Anthropic's
 * forced tool-choice structured output. Not derived from the zod schema (no
 * zod-to-json-schema dependency added for this) — keep the two in sync by hand.
 */
export const scannedReceiptJsonSchema = {
  type: 'object',
  properties: {
    merchantName: { type: 'string' },
    amount: { type: 'number' },
    currency: {
      type: 'string',
      description: '3-letter ISO currency code, e.g. USD',
    },
    expenseDate: { type: 'string', description: 'ISO 8601 date, YYYY-MM-DD' },
    category: {
      type: 'string',
      description:
        'One of: Meals & Entertainment, Travel, Software & Subscriptions, Office Supplies, General Expense',
    },
    taxAmount: {
      type: 'number',
      description:
        'The VAT (tax) amount printed on the receipt, included in the total. Leave out when the receipt shows no VAT.',
    },
    supplierTaxId: {
      type: 'string',
      description:
        "The seller's tax registration number exactly as printed, often labelled TRN, VAT No or Tax Reg No (15 digits in the UAE). Leave out when the receipt shows none; never guess one.",
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          amount: { type: 'number' },
        },
        required: ['description', 'quantity', 'unitPrice', 'amount'],
      },
    },
  },
  required: [
    'merchantName',
    'amount',
    'currency',
    'expenseDate',
    'category',
    'confidence',
    'items',
  ],
  additionalProperties: false,
} as const;
