import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

const creditLineSchema = z.object({
  description: z.string().trim().min(1, 'Describe what is being credited').max(500),
  qty: z.coerce.number().positive('Quantity must be above zero'),
  unitPrice: z.coerce.number().positive('Price must be above zero'),
  taxRate: z.coerce.number().min(0).max(100).nullish().transform((v) => v ?? null),
  taxCodeId: z.string().uuid().nullish().transform((v) => v ?? null),
});

/**
 * Either itemised lines, or a single amount (net of tax) spread across the
 * invoice's tax codes in proportion — the usual "£50 off for the damaged
 * box" case, where nobody wants to pick a line.
 */
export const createCreditNoteSchema = z
  .object({
    reason: z.string().trim().min(3, 'Say why the customer is being credited').max(1000),
    lines: z.array(creditLineSchema).max(100).nullish().transform((v) => v ?? null),
    netAmount: z.coerce.number().positive().nullish().transform((v) => v ?? null),
    /** Credit everything not yet credited. */
    full: z.boolean().nullish().transform((v) => v ?? false),
  })
  .refine((v) => [Boolean(v.lines?.length), v.netAmount != null, v.full].filter(Boolean).length === 1, {
    message: 'Give lines, an amount, or credit the full invoice — exactly one',
  });

export const refundCreditNoteSchema = z.object({
  financeAccountId: z.string().uuid(),
  /** Defaults to everything refundable. */
  amount: z.coerce.number().positive().nullish().transform((v) => v ?? null),
  reference: optionalText(120),
});

export const createDeliveryNoteSchema = z.object({
  lines: z
    .array(
      z.object({
        salesOrderLineId: z.string().uuid(),
        qty: z.coerce.number().positive('Quantity must be above zero'),
      }),
    )
    .min(1, 'A delivery needs at least one line'),
  shipTo: optionalText(1000),
  carrier: optionalText(120),
  trackingReference: optionalText(120),
  notes: optionalText(2000),
});

export const taxCodeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  rate: z.coerce.number().min(0).max(100),
  kind: z.enum(['SALES', 'PURCHASE']),
  isReverseCharge: z.boolean().default(false),
  ledgerAccountId: z.string().uuid().nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
});

export const taxRuleSchema = z.object({
  kind: z.enum(['SALES', 'PURCHASE']),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => /^[A-Z]{2}$/.test(v) || v === '*', 'Use a two-letter country code, EU, or *'),
  requiresTaxId: z.boolean().default(false),
  taxCodeId: z.string().uuid(),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
});

export const taxReportQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export type CreateCreditNotePayload = z.output<typeof createCreditNoteSchema>;
export type RefundCreditNotePayload = z.output<typeof refundCreditNoteSchema>;
export type CreateDeliveryNotePayload = z.output<typeof createDeliveryNoteSchema>;
export type TaxCodePayload = z.output<typeof taxCodeSchema>;
export type TaxRulePayload = z.output<typeof taxRuleSchema>;
export type TaxReportQueryPayload = z.output<typeof taxReportQuerySchema>;
