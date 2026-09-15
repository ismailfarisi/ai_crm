import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

export const billLineSchema = z.object({
  /** Set when the line bills goods from a purchase order; absent for a utility bill. */
  purchaseOrderLineId: z.string().uuid().nullish().transform((v) => v ?? null),
  description: z.string().trim().min(1, 'Each line needs a description').max(255),
  qty: z.coerce.number().positive('Quantity must be above zero'),
  unitCost: z.coerce.number().min(0, 'Unit cost cannot be negative'),
});

export const createBillSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullish().transform((v) => v ?? null),
  /** The supplier's own invoice number. Required: it is how their statement is reconciled. */
  supplierInvoiceNumber: z.string().trim().min(1, 'Enter the supplier’s invoice number').max(80),
  billDate: z.coerce.date(),
  /** Defaults from the supplier's payment terms when omitted. */
  dueDate: z.coerce.date().nullish().transform((v) => v ?? null),
  taxAmount: z.coerce.number().min(0).default(0),
  /** How the tax is reported. Defaults from the supplier's country via the purchase tax rules. */
  taxCodeId: z.string().uuid().nullish().transform((v) => v ?? null),
  notes: optionalText(2000),
  lines: z.array(billLineSchema).min(1, 'A bill needs at least one line'),
});

export const recordBillPaymentSchema = z.object({
  financeAccountId: z.string().uuid(),
  /** Defaults to the remaining balance. */
  amount: z.coerce.number().positive().optional(),
  paidAt: z.coerce.date().optional(),
  reference: optionalText(120),
});

export const billQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'DISPUTED', 'CANCELLED']).optional(),
  supplierId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
});

export const billReasonSchema = z.object({ reason: optionalText(500) });

export type CreateBillPayload = z.output<typeof createBillSchema>;
export type RecordBillPaymentPayload = z.output<typeof recordBillPaymentSchema>;
export type BillQueryPayload = z.output<typeof billQuerySchema>;
export type BillReasonPayload = z.output<typeof billReasonSchema>;
