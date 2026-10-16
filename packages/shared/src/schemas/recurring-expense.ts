import { z } from 'zod';
import { RECURRING_INTERVALS, type RecurringInterval } from '../finance/recurring';
import { normaliseExpenseCategory } from '../finance/expense-categories';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const nullableUuid = z.string().uuid().nullish().transform((v) => v ?? null);

const fields = {
  /** Null keeps the row in the forecast without generating bills. */
  supplierId: nullableUuid,
  vendorName: z.string().trim().min(1, 'Name the vendor').max(255),
  category: z.string().trim().min(1).max(100).transform(normaliseExpenseCategory),
  amount: z.coerce.number().positive('Amount must be above zero'),
  billingInterval: z.enum(RECURRING_INTERVALS as [string, ...string[]]).transform((v) => v as RecurringInterval),
  startDate: isoDay,
  endDate: isoDay.nullish().transform((v) => v ?? null),
  taxCodeId: nullableUuid,
  autoApprove: z.boolean().default(false),
  spreadOverPeriod: z.boolean().optional(),
};

export const createRecurringExpenseSchema = z
  .object(fields)
  .refine((v) => !v.endDate || v.endDate > v.startDate, { message: 'The end date must be after the start', path: ['endDate'] })
  .transform((v) => ({
    ...v,
    spreadOverPeriod: v.billingInterval === 'MONTHLY' ? false : (v.spreadOverPeriod ?? true),
  }));

export const updateRecurringExpenseSchema = z
  .object({
    supplierId: fields.supplierId.optional(),
    vendorName: fields.vendorName.optional(),
    category: fields.category.optional(),
    amount: fields.amount.optional(),
    billingInterval: fields.billingInterval.optional(),
    startDate: isoDay.optional(),
    endDate: fields.endDate.optional(),
    taxCodeId: fields.taxCodeId.optional(),
    autoApprove: z.boolean().optional(),
    spreadOverPeriod: z.boolean().optional(),
  })
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as typeof v);

export type CreateRecurringExpensePayload = z.output<typeof createRecurringExpenseSchema>;
export type RecurringExpenseFormInput = z.input<typeof createRecurringExpenseSchema>;
export type UpdateRecurringExpensePayload = z.output<typeof updateRecurringExpenseSchema>;
