import { z } from 'zod';
import type { MaterialUom } from '../costing/types';

/**
 * Mirrors `MaterialUom` rather than re-listing it: a schema that drifts from
 * the type it validates is worse than no schema, because it type-checks.
 */
export const MATERIAL_UOMS = ['SHEET', 'METRE', 'KG', 'EACH'] as const satisfies readonly MaterialUom[];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

export const createPurchaseOrderLineSchema = z.object({
  materialId: z.string().uuid().nullish().transform((v) => v ?? null),
  description: z.string().trim().min(1, 'Each line needs a description').max(255),
  qtyOrdered: z.coerce.number().positive('Quantity must be above zero'),
  uom: z.enum(MATERIAL_UOMS),
  unitCost: z.coerce.number().min(0, 'Unit cost cannot be negative'),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  expectedDate: z.coerce.date().nullish().transform((v) => v ?? null),
  notes: optionalText(5000),
  /** At least one: an order with nothing on it cannot be sent to anybody. */
  lines: z.array(createPurchaseOrderLineSchema).min(1, 'Add at least one line'),
  sourceQuoteId: z.string().uuid().nullish().transform((v) => v ?? null),
});

export const purchaseOrderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z
    .enum([
      'DRAFT',
      'AWAITING_APPROVAL',
      'APPROVED',
      'SENT',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED',
    ])
    .optional(),
  supplierId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'orderDate', 'expectedDate', 'totalAmount']).default('createdAt'),
  sortOrder: z.enum(['ASC', 'DESC']).default('DESC'),
});

export const suggestPurchaseOrderSchema = z.object({
  quoteId: z.string().uuid(),
});

export const cancelPurchaseOrderSchema = z.object({
  reason: optionalText(500),
});

/**
 * No defaults: a PATCH that filled them in would silently reset limits the
 * caller never mentioned - the same reason `updateCustomerSchema` has none.
 */
export const updatePurchasePolicySchema = z.object({
  approvalThreshold: z.coerce.number().min(0).optional(),
  requirePreferredSupplier: z.boolean().optional(),
  varianceTolerancePct: z.coerce.number().min(0).max(1).optional(),
  enforce: z.boolean().optional(),
});

export type CreatePurchaseOrderInputRaw = z.input<typeof createPurchaseOrderSchema>;
export type CreatePurchaseOrderPayload = z.output<typeof createPurchaseOrderSchema>;
export type PurchaseOrderQueryPayload = z.output<typeof purchaseOrderQuerySchema>;
export type SuggestPurchaseOrderPayload = z.output<typeof suggestPurchaseOrderSchema>;
export type CancelPurchaseOrderPayload = z.output<typeof cancelPurchaseOrderSchema>;
export type UpdatePurchasePolicyPayload = z.output<typeof updatePurchasePolicySchema>;
