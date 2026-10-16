import { z } from 'zod';
import { daysBetweenInclusive } from '../payroll/calc';
import { LEAVE_TYPES } from '../payroll/leave';
import { isoDay, money, optionalText, routingCode, stripUndefined } from './payroll';

const optionalMoney = money.nullish().transform((v) => v ?? null);

export const payrollSettingsSchema = z
  .object({
    wpsEnabled: z.boolean(),
    employerIdType: z.enum(['MOHRE', 'FREE_ZONE']).nullish().transform((v) => v ?? null),
    employerId: optionalText(20),
    payerRoutingCode: routingCode,
    annualLeaveDays: z.coerce.number().int().min(30).max(60).default(30),
  })
  .refine((v) => !v.wpsEnabled || (v.employerIdType && v.employerId && v.payerRoutingCode), { message: 'WPS needs the employer ID type, employer ID and payer routing code', path: ['employerId'] })
  .refine((v) => v.employerIdType !== 'MOHRE' || !v.employerId || /^\d{13}$/.test(v.employerId), { message: 'A MOHRE employer ID is 13 digits', path: ['employerId'] });

const pct = z.coerce.number().min(0).max(100);
const schemeFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  employeePct: pct,
  employerPct: pct,
  base: z.enum(['BASIC', 'BASIC_HOUSING', 'GROSS']),
  minSalary: optionalMoney,
  maxSalary: optionalMoney,
};
const minBelowMax = (v: { minSalary?: number | null; maxSalary?: number | null }) => v.minSalary == null || v.maxSalary == null || v.minSalary <= v.maxSalary;

export const createPensionSchemeSchema = z.object(schemeFields).refine(minBelowMax, { message: 'Minimum salary cannot exceed the maximum', path: ['minSalary'] });
export const updatePensionSchemeSchema = z
  .object({ ...schemeFields, isActive: z.boolean() })
  .partial()
  .refine(minBelowMax, { message: 'Minimum salary cannot exceed the maximum', path: ['minSalary'] })
  .transform(stripUndefined);

export const leaveRecordSchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    startDate: isoDay,
    endDate: isoDay,
    days: z.coerce.number().positive().multipleOf(0.5).nullish(),
    note: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date cannot be before the start', path: ['endDate'] })
  .refine((v) => v.days == null || v.days <= daysBetweenInclusive(v.startDate, v.endDate), { message: 'More days than the dates cover', path: ['days'] })
  .transform((v) => ({ ...v, days: v.days ?? daysBetweenInclusive(v.startDate, v.endDate) }));

export const leaveAdjustmentSchema = z.object({
  days: z.coerce.number().refine((n) => n !== 0, 'Days cannot be zero').transform((n) => Math.round(n * 100) / 100),
  note: z.string().trim().min(1, 'Say why').max(200),
});

export const openingLeavePreviewSchema = z.object({ cutoverDate: isoDay.optional() });
export const postOpeningLeaveSchema = z.object({
  cutoverDate: isoDay,
  lines: z
    .array(z.object({ employeeId: z.string().uuid(), balanceDays: z.coerce.number().min(-60).max(400).transform((n) => Math.round(n * 100) / 100) }))
    .min(1, 'Choose at least one employee'),
});

export const remitPensionSchema = z.object({ financeAccountId: z.string().uuid(), paidAt: z.coerce.date().optional() });

export const SETTLEMENT_REASONS = ['RESIGNATION', 'TERMINATION', 'END_OF_CONTRACT', 'DEATH', 'OTHER'] as const;
export const createSettlementSchema = z.object({ employeeId: z.string().uuid(), reason: z.enum(SETTLEMENT_REASONS) });
export const updateSettlementSchema = z
  .object({
    reason: z.enum(SETTLEMENT_REASONS).optional(),
    leaveEncashmentDays: z.coerce.number().min(0).max(400).optional(),
    noticeDays: z.coerce.number().min(0).max(180).optional(),
    noticeDirection: z.enum(['PAY', 'DEDUCT']).optional(),
    advanceRecovery: money.optional(),
    manualLines: z
      .array(z.object({ kind: z.enum(['ADDITION', 'DEDUCTION']), label: z.string().trim().min(1, 'Describe the line').max(160), amount: money.refine((n) => n > 0, 'Amount must be above zero') }))
      .max(20)
      .optional(),
  })
  .transform(stripUndefined);
export const paySettlementSchema = z.object({ financeAccountId: z.string().uuid(), paidAt: z.coerce.date().optional() });

export type PayrollSettingsInput = z.input<typeof payrollSettingsSchema>;
export type PayrollSettingsPayload = z.output<typeof payrollSettingsSchema>;
export type CreatePensionSchemeInput = z.input<typeof createPensionSchemeSchema>;
export type CreatePensionSchemePayload = z.output<typeof createPensionSchemeSchema>;
export type UpdatePensionSchemeInput = z.input<typeof updatePensionSchemeSchema>;
export type UpdatePensionSchemePayload = z.output<typeof updatePensionSchemeSchema>;
export type LeaveRecordFormInput = z.input<typeof leaveRecordSchema>;
export type LeaveRecordPayload = z.output<typeof leaveRecordSchema>;
export type LeaveAdjustmentInput = z.input<typeof leaveAdjustmentSchema>;
export type LeaveAdjustmentPayload = z.output<typeof leaveAdjustmentSchema>;
export type PostOpeningLeaveInput = z.input<typeof postOpeningLeaveSchema>;
export type PostOpeningLeavePayload = z.output<typeof postOpeningLeaveSchema>;
export type RemitPensionInput = z.input<typeof remitPensionSchema>;
export type RemitPensionPayload = z.output<typeof remitPensionSchema>;
export type SettlementReason = (typeof SETTLEMENT_REASONS)[number];
export type CreateSettlementInput = z.input<typeof createSettlementSchema>;
export type CreateSettlementPayload = z.output<typeof createSettlementSchema>;
export type UpdateSettlementInput = z.input<typeof updateSettlementSchema>;
export type UpdateSettlementPayload = z.output<typeof updateSettlementSchema>;
export type PaySettlementInput = z.input<typeof paySettlementSchema>;
export type PaySettlementPayload = z.output<typeof paySettlementSchema>;
