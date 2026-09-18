import { z } from 'zod';

/**
 * The covering note and address on "send this quote to the customer".
 *
 * Both optional: the common case is pressing send and letting the address on
 * the quote and a plain covering line do the work. An override exists because
 * the person who signs is often not the address on file.
 */
export const sendQuoteSchema = z.object({
  /** Overrides the quote's own customer email. */
  to: z
    .string()
    .trim()
    .max(255)
    .nullish()
    .transform((v) => (v == null || v === '' ? undefined : v))
    .refine((v) => v === undefined || z.email().safeParse(v).success, {
      message: 'Enter a valid email address',
    }),
  /** A line or two above the link. Escaped before it reaches the email body. */
  message: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v == null || v === '' ? undefined : v)),
});

/** What a form or caller may supply — every field omissible. */
export type SendQuoteInput = z.input<typeof sendQuoteSchema>;

/** What the schema produces, and what the handler receives. */
export type SendQuotePayload = z.output<typeof sendQuoteSchema>;
