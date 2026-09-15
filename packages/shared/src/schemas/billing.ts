import { z } from 'zod';

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, e.g. EUR');

export const baseCurrencySchema = z.object({ baseCurrency: currency });

export const fxRateSchema = z.object({
  currency,
  rateDate: z.coerce.date(),
  /** Base currency per one unit of `currency`. */
  rate: z.coerce.number().positive('A rate must be above zero').max(1_000_000),
});

export const revaluationSchema = z.object({
  /** Any date in the month to revalue; the entry is dated the last day of it. */
  period: z.coerce.date(),
});

export const statementQuerySchema = z.object({
  from: z.coerce.date().nullish().transform((v) => v ?? undefined),
  to: z.coerce.date().nullish().transform((v) => v ?? undefined),
  asOf: z.coerce.date().nullish().transform((v) => v ?? undefined),
  by: z.enum(['customer', 'template']).nullish().transform((v) => v ?? 'customer'),
  format: z.enum(['json', 'csv']).nullish().transform((v) => v ?? 'json'),
});

export const checkoutSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
});

export type BaseCurrencyPayload = z.output<typeof baseCurrencySchema>;
export type FxRatePayload = z.output<typeof fxRateSchema>;
export type RevaluationPayload = z.output<typeof revaluationSchema>;
export type StatementQueryPayload = z.output<typeof statementQuerySchema>;
export type CheckoutPayload = z.output<typeof checkoutSchema>;
