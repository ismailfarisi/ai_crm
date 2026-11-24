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

/**
 * What an adjustment is, said by the caller rather than guessed from which
 * fields it filled in.
 *
 * - `CORRECTION`: a recount or a write-off. Stock that was always there (or
 *   never was). Its value moves through cost of sales.
 * - `OPENING`: stock the business already owned on the day it started here.
 *   It comes in at a stated cost and is credited to opening balance equity,
 *   because stock already owned is not income.
 */
export const STOCK_ADJUSTMENT_KINDS = ['CORRECTION', 'OPENING'] as const;
export type StockAdjustmentKind = (typeof STOCK_ADJUSTMENT_KINDS)[number];

export const adjustStockSchema = z
  .object({
    materialId: z.string().uuid(),
    locationId: z.string().uuid().optional(),
    kind: z.enum(STOCK_ADJUSTMENT_KINDS).default('CORRECTION'),
    /** Signed. Negative writes stock off, positive corrects a count upward. */
    qtyDelta: z.coerce.number().refine((v) => v !== 0, 'An adjustment of zero changes nothing'),
    /** Required: an adjustment nobody can explain erodes trust in the whole figure. */
    note: z.string().trim().min(1, 'Give a reason for the adjustment').max(500),
    /**
     * What the stock being added is worth, per unit. Opening counts only.
     *
     * A correction never states a price: putting back a miscounted box does
     * not change what the stock cost, so it is valued at the average the stock
     * already stands at. An opening count has to state one, or every job the
     * stock is consumed on reports a cost of zero.
     */
    unitCost: z.coerce
      .number()
      .min(0)
      .nullish()
      .transform((v) => (v == null || Number.isNaN(v) ? null : v)),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'OPENING') {
      if (!(value.qtyDelta > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['qtyDelta'],
          message: 'An opening count adds stock. Use a correction to write stock off.',
        });
      }
      if (value.unitCost == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['unitCost'],
          message: 'Say what a unit of this stock cost',
        });
      }
    } else if (value.unitCost != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitCost'],
        message:
          'A unit cost is only given for an opening count. A correction is valued at the average cost the stock already has.',
      });
    }
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
