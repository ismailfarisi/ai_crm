import { z } from 'zod';

const status = z.enum(['OPEN', 'IN_PRODUCTION', 'FULFILLED', 'CLOSED', 'CANCELLED']);

export const salesOrderQuerySchema = z.object({
  status: status.nullish().transform((v) => v ?? undefined),
});

export const setSalesOrderStatusSchema = z.object({
  status: status.exclude(['CANCELLED']),
});

export const cancelSalesOrderSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});

export const billingStageSchema = z.object({
  kind: z.enum(['DEPOSIT', 'MILESTONE', 'FINAL']),
  label: z.string().trim().min(1, 'Name each stage').max(120),
  percent: z.coerce.number().gt(0, 'Each stage must bill more than 0%').max(100),
  trigger: z.enum(['ON_APPROVAL', 'MANUAL']),
});

export const acceptQuoteSchema = z.object({
  name: z.string().trim().min(2, 'Type your full name to accept').max(255),
});

export type SalesOrderQueryPayload = z.output<typeof salesOrderQuerySchema>;
export type SetSalesOrderStatusPayload = z.output<typeof setSalesOrderStatusSchema>;
export type CancelSalesOrderPayload = z.output<typeof cancelSalesOrderSchema>;
export type AcceptQuotePayload = z.output<typeof acceptQuoteSchema>;
