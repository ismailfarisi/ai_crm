import { z } from 'zod';

const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v == null || v === '' ? null : v));
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(0).transform((n) => Math.round(n * 100) / 100);

const employeeFields = {
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  jobTitle: optionalText(120),
  department: optionalText(120),
  userId: z.string().uuid().nullish().transform((v) => v ?? null),
  joiningDate: isoDay,
  leavingDate: isoDay.nullish().transform((v) => v ?? null),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'LEFT']).default('ACTIVE'),
  nationality: z.string().trim().length(2).toUpperCase().nullish().transform((v) => v ?? null),
  isNational: z.boolean().default(false),
  paymentMethod: z.enum(['BANK', 'CASH']),
  bankName: optionalText(120),
  iban: z.string().nullish().transform((v) => (v == null ? null : v.replace(/\s+/g, '').toUpperCase() || null)),
  email: z.string().trim().email().nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  phone: optionalText(40),
};

export const createEmployeeSchema = z
  .object(employeeFields)
  .refine((v) => !v.leavingDate || v.leavingDate >= v.joiningDate, { message: 'Leaving date cannot be before joining', path: ['leavingDate'] })
  .refine((v) => v.paymentMethod !== 'BANK' || !v.iban || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v.iban), { message: 'Enter a valid IBAN', path: ['iban'] })
  .transform((v) => ({ ...v, iban: v.paymentMethod === 'BANK' ? v.iban : null, bankName: v.paymentMethod === 'BANK' ? v.bankName : null }));

/** The IBAN/payment-method interplay is enforced in the service. */
export const updateEmployeeSchema = z
  .object(employeeFields)
  .partial()
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<CreateEmployeePayload>);

export const createSalaryPackageSchema = z.object({
  effectiveFrom: isoDay,
  basic: z.coerce.number().positive('Basic must be above zero').transform((n) => Math.round(n * 100) / 100),
  housing: money.default(0),
  transport: money.default(0),
  otherAllowances: z.array(z.object({ label: z.string().trim().min(1).max(60), amount: money })).max(10).default([]),
});

export const createPayrollRunSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  payDate: isoDay.nullish().transform((v) => v ?? null),
});

export const updatePayrollLineSchema = z
  .object({
    overtimeHours: z.coerce.number().min(0).max(300).optional(),
    overtimeHoursPremium: z.coerce.number().min(0).max(300).optional(),
    bonusAmount: money.optional(),
    bonusLabel: optionalText(80).optional(),
    unpaidLeaveDays: z.coerce.number().min(0).max(31).optional(),
    advanceRecovery: money.optional(),
    otherDeductionAmount: money.optional(),
    otherDeductionLabel: optionalText(80).optional(),
  })
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as typeof v);

export const payPayrollRunSchema = z.object({
  method: z.enum(['BANK', 'CASH']),
  financeAccountId: z.string().uuid(),
  paidAt: z.coerce.date().optional(),
});

export const recordAdvanceSchema = z.object({
  amount: z.coerce.number().positive().transform((n) => Math.round(n * 100) / 100),
  financeAccountId: z.string().uuid(),
  issuedAt: z.coerce.date().optional(),
  note: optionalText(200),
});

export const openingGratuityPreviewSchema = z.object({ cutoverDate: isoDay.optional() });

export const postOpeningGratuitySchema = z.object({
  cutoverDate: isoDay,
  lines: z.array(z.object({ employeeId: z.string().uuid(), amount: money })).min(1, 'Choose at least one employee'),
});

export const gratuityAdjustmentSchema = z.object({
  amount: z.coerce.number().refine((n) => n !== 0, 'Amount cannot be zero').transform((n) => Math.round(n * 100) / 100),
  note: z.string().trim().min(1, 'Say why').max(200),
});

export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;
export type CreateEmployeePayload = z.output<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.input<typeof updateEmployeeSchema>;
export type UpdateEmployeePayload = z.output<typeof updateEmployeeSchema>;
export type CreateSalaryPackageInput = z.input<typeof createSalaryPackageSchema>;
export type CreateSalaryPackagePayload = z.output<typeof createSalaryPackageSchema>;
export type CreatePayrollRunInput = z.input<typeof createPayrollRunSchema>;
export type CreatePayrollRunPayload = z.output<typeof createPayrollRunSchema>;
export type UpdatePayrollLineInput = z.input<typeof updatePayrollLineSchema>;
export type UpdatePayrollLinePayload = z.output<typeof updatePayrollLineSchema>;
export type PayPayrollRunInput = z.input<typeof payPayrollRunSchema>;
export type PayPayrollRunPayload = z.output<typeof payPayrollRunSchema>;
export type RecordAdvanceInput = z.input<typeof recordAdvanceSchema>;
export type RecordAdvancePayload = z.output<typeof recordAdvanceSchema>;
export type PostOpeningGratuityInput = z.input<typeof postOpeningGratuitySchema>;
export type PostOpeningGratuityPayload = z.output<typeof postOpeningGratuitySchema>;
export type GratuityAdjustmentInput = z.input<typeof gratuityAdjustmentSchema>;
export type GratuityAdjustmentPayload = z.output<typeof gratuityAdjustmentSchema>;
