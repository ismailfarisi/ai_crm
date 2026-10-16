import { z } from 'zod';
import { TIMESHEET_INDIRECT_CATEGORIES } from '../timesheets/types';
import { isoDay, optionalText } from './payroll';

const hours = z.coerce
  .number()
  .gt(0, 'Log more than zero hours')
  .max(24, 'A day has 24 hours')
  .refine((h) => Math.abs(Math.round(h * 100) - h * 100) < 1e-6, 'Use at most two decimals');
const note = optionalText(500);
const oneTarget = (v: { operationId: string | null; indirectCategory: string | null }) =>
  (v.operationId == null) !== (v.indirectCategory == null);
const oneTargetMessage = { message: 'Choose a job operation or an indirect category', path: ['operationId'] };

const entryBase = z.object({
  employeeId: z.string().uuid(),
  workDate: isoDay,
  hours,
  operationId: z.string().uuid().nullish().transform((v) => v ?? null),
  indirectCategory: z.enum(TIMESHEET_INDIRECT_CATEGORIES).nullish().transform((v) => v ?? null),
  note,
});

export const timesheetEntrySchema = entryBase.refine(oneTarget, oneTargetMessage);
export const updateTimesheetEntrySchema = z.object({ hours, note });
export const bulkTimesheetSchema = z
  .object({
    upserts: z.array(entryBase.extend({ id: z.string().uuid().optional() }).refine(oneTarget, oneTargetMessage)).max(500),
    deletes: z.array(z.string().uuid()).max(500),
  })
  .refine((v) => v.upserts.length + v.deletes.length > 0, { message: 'Nothing to save' });

const DAY = 86_400_000;
export const timesheetQuerySchema = z
  .object({ employeeId: z.string().uuid().optional(), from: isoDay, to: isoDay })
  .refine((v) => v.from <= v.to, { message: '"from" must be on or before "to"', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / DAY <= 62, { message: 'Ask for at most 62 days', path: ['to'] });
export const crewQuerySchema = z.object({ workDate: isoDay, workOrderId: z.string().uuid() });
export const labourUtilisationQuerySchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });

export type TimesheetEntryInput = z.input<typeof timesheetEntrySchema>;
export type TimesheetEntryPayload = z.output<typeof timesheetEntrySchema>;
export type UpdateTimesheetEntryInput = z.input<typeof updateTimesheetEntrySchema>;
export type UpdateTimesheetEntryPayload = z.output<typeof updateTimesheetEntrySchema>;
export type BulkTimesheetInput = z.input<typeof bulkTimesheetSchema>;
export type BulkTimesheetPayload = z.output<typeof bulkTimesheetSchema>;
export type TimesheetQueryPayload = z.output<typeof timesheetQuerySchema>;
export type CrewQueryPayload = z.output<typeof crewQuerySchema>;
export type LabourUtilisationQueryPayload = z.output<typeof labourUtilisationQuerySchema>;
