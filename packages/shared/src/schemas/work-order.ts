import { z } from 'zod';

export const createWorkOrdersSchema = z.object({
  /** Omit to create one for every template-priced line on the order that has none yet. */
  salesOrderLineIds: z.array(z.string().uuid()).nullish().transform((v) => v ?? null),
  dueDate: z.coerce.date().nullish().transform((v) => v ?? null),
});

export const workOrderQuerySchema = z.object({
  status: z
    .enum(['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED'])
    .nullish()
    .transform((v) => v ?? undefined),
  workCenterId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  salesOrderId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  dueBefore: z.coerce.date().nullish().transform((v) => v ?? undefined),
});

export const logOperationTimeSchema = z.object({
  minutes: z.coerce
    .number()
    .positive('Log more than zero minutes')
    .max(24 * 60, 'That is more than a day on one operation'),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});

export const issueMaterialSchema = z.object({
  workOrderMaterialId: z.string().uuid(),
  /** Positive issues to the job; negative returns unused material to stock. */
  qty: z.coerce.number().refine((n) => n !== 0, 'Enter a quantity'),
  locationId: z.string().uuid().nullish().transform((v) => v ?? undefined),
});

export const completeWorkOrderSchema = z.object({
  /** Good pieces produced. Defaults to the ordered quantity. */
  qtyCompleted: z.coerce.number().min(0).nullish().transform((v) => v ?? null),
});

export const cancelWorkOrderSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});

export type CreateWorkOrdersPayload = z.output<typeof createWorkOrdersSchema>;
export type WorkOrderQueryPayload = z.output<typeof workOrderQuerySchema>;
export type LogOperationTimePayload = z.output<typeof logOperationTimeSchema>;
export type IssueMaterialPayload = z.output<typeof issueMaterialSchema>;
export type CompleteWorkOrderPayload = z.output<typeof completeWorkOrderSchema>;
export type CancelWorkOrderPayload = z.output<typeof cancelWorkOrderSchema>;
