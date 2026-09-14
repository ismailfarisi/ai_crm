import { z } from 'zod';

export const receiveLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  qtyReceived: z.coerce.number().positive('Received quantity must be above zero'),
  qtyRejected: z.coerce.number().min(0).default(0),
});

export const receiveGoodsSchema = z.object({
  locationId: z.string().uuid().optional(),
  /** The supplier's own delivery note, for matching against their bill later. */
  supplierReference: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
  lines: z.array(receiveLineSchema).min(1, 'Nothing to receive'),
});

export const adjustStockSchema = z.object({
  materialId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  /** Signed. Negative writes stock off, positive corrects a count upward. */
  qtyDelta: z.coerce.number().refine((v) => v !== 0, 'An adjustment of zero changes nothing'),
  /** Required: an adjustment nobody can explain erodes trust in the whole figure. */
  note: z.string().trim().min(1, 'Give a reason for the adjustment').max(500),
});

/**
 * Reorder levels. Both nullable: clearing them switches the check off for
 * that material rather than setting it to zero, which would fire constantly.
 */
export const setReorderLevelsSchema = z.object({
  materialId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  reorderPoint: z.coerce
    .number()
    .min(0)
    .nullish()
    .transform((v) => (v == null || Number.isNaN(v) ? null : v)),
  reorderQty: z.coerce
    .number()
    .min(0)
    .nullish()
    .transform((v) => (v == null || Number.isNaN(v) ? null : v)),
});

export type SetReorderLevelsPayload = z.output<typeof setReorderLevelsSchema>;

export type ReceiveGoodsPayload = z.output<typeof receiveGoodsSchema>;
export type AdjustStockPayload = z.output<typeof adjustStockSchema>;
