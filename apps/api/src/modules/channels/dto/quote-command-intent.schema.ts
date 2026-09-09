import { z } from 'zod';

/**
 * Validates the AI model's structured parse of a staff chat message before
 * it's trusted — mirrors `scannedReceiptResultSchema`'s role as the safety
 * net for AI-extracted structured data.
 */
export const quoteCommandIntentSchema = z.object({
  isQuoteApprovalCommand: z.boolean(),
  action: z.enum(['APPROVE', 'APPROVE_AND_SEND']).optional(),
  quoteNumber: z.string().optional(),
  customerName: z.string().optional(),
});

export type QuoteCommandIntent = z.infer<typeof quoteCommandIntentSchema>;

/**
 * Hand-kept JSON-Schema mirror of `quoteCommandIntentSchema`, for Anthropic's
 * forced tool-choice structured output. Keep the two in sync by hand.
 */
export const quoteCommandIntentJsonSchema = {
  type: 'object',
  properties: {
    isQuoteApprovalCommand: {
      type: 'boolean',
      description:
        'True only if the message is asking to approve/convert a quote to an invoice. False for anything else (greetings, unrelated questions, etc).',
    },
    action: {
      type: 'string',
      enum: ['APPROVE', 'APPROVE_AND_SEND'],
      description:
        'APPROVE_AND_SEND if the message also asks to send/email the invoice to the customer, otherwise APPROVE.',
    },
    quoteNumber: {
      type: 'string',
      description: 'The quote number mentioned, e.g. "QT-2026-0004", if any.',
    },
    customerName: {
      type: 'string',
      description: 'The customer/company name mentioned, if any.',
    },
  },
  required: ['isQuoteApprovalCommand'],
  additionalProperties: false,
} as const;
