import { z } from 'zod';

/**
 * Validates the AI model's structured classification of an inbound customer
 * message before it's trusted — mirrors `quoteCommandIntentSchema`'s role as
 * the safety net for AI-extracted structured data.
 */
export const channelIntentSchema = z.object({
  intent: z.enum([
    'GENERAL_QUESTION',
    'QUOTATION_REQUEST',
    'ORDER_STATUS',
    'PRICING_QUESTION',
    'COMPLAINT',
    'SUPPORT_REQUEST',
    'SCHEDULING',
    'SPAM',
    'OTHER',
  ]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  suggestedReply: z.string(),
  options: z
    .array(z.object({ label: z.string(), body: z.string() }))
    .min(2)
    .max(4),
});

export type ChannelIntent = z.infer<typeof channelIntentSchema>;

/**
 * Hand-kept JSON-Schema mirror of `channelIntentSchema`, for the AI provider's
 * forced tool-choice structured output. Keep the two in sync by hand.
 */
export const channelIntentJsonSchema = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'GENERAL_QUESTION',
        'QUOTATION_REQUEST',
        'ORDER_STATUS',
        'PRICING_QUESTION',
        'COMPLAINT',
        'SUPPORT_REQUEST',
        'SCHEDULING',
        'SPAM',
        'OTHER',
      ],
      description:
        'What the sender wants. QUOTATION_REQUEST is specifically asking for a price quote/proposal, distinct from a general PRICING_QUESTION.',
    },
    confidence: {
      type: 'number',
      description: 'How confident you are in this classification, from 0 to 1.',
    },
    summary: {
      type: 'string',
      description: "One sentence summarizing what the sender wants.",
    },
    suggestedReply: {
      type: 'string',
      description:
        'A full draft reply a staff member could review and send as-is or edit. Never mention that you are an AI.',
    },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short label for this reply option, e.g. "Confirm availability".' },
          body: { type: 'string', description: 'The full text of this reply option.' },
        },
        required: ['label', 'body'],
      },
      description: '2-4 short alternative quick-reply options for staff to choose from.',
    },
  },
  required: ['intent', 'confidence', 'summary', 'suggestedReply', 'options'],
  additionalProperties: false,
} as const;
