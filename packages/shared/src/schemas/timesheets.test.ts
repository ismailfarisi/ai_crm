import { describe, expect, it } from 'vitest';
import { bulkTimesheetSchema, labourUtilisationQuerySchema, timesheetEntrySchema, timesheetQuerySchema, updateTimesheetEntrySchema } from './timesheets';

const E = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';

describe('timesheet schemas', () => {
  it('an entry on a job operation', () => {
    const v = timesheetEntrySchema.parse({ employeeId: E, workDate: '2026-09-03', hours: '7.5', operationId: O });
    expect(v).toEqual({ employeeId: E, workDate: '2026-09-03', hours: 7.5, operationId: O, indirectCategory: null, note: null });
  });
  it('an indirect entry', () => expect(timesheetEntrySchema.parse({ employeeId: E, workDate: '2026-09-03', hours: 1, indirectCategory: 'IDLE' }).indirectCategory).toBe('IDLE'));
  it('needs exactly one of operation or category', () => {
    expect(timesheetEntrySchema.safeParse({ employeeId: E, workDate: '2026-09-03', hours: 1 }).success).toBe(false);
    expect(timesheetEntrySchema.safeParse({ employeeId: E, workDate: '2026-09-03', hours: 1, operationId: O, indirectCategory: 'IDLE' }).success).toBe(false);
  });
  it('hours above 0, at most 24, two decimals', () => {
    for (const hours of [0, -1, 24.01, 1.234]) expect(timesheetEntrySchema.safeParse({ employeeId: E, workDate: '2026-09-03', hours, indirectCategory: 'IDLE' }).success).toBe(false);
  });
  it('patch takes hours and note only, blank note clears', () => expect(updateTimesheetEntrySchema.parse({ hours: 2, note: '' })).toEqual({ hours: 2, note: null }));
  it('patch leaves an omitted note out of the output', () => {
    const v = updateTimesheetEntrySchema.parse({ hours: 2 });
    expect(v).toEqual({ hours: 2 });
    expect('note' in v).toBe(false);
  });
  it('patch with explicit null note clears it', () => expect(updateTimesheetEntrySchema.parse({ note: null })).toEqual({ note: null }));
  it('an empty patch is accepted and changes nothing', () => expect(updateTimesheetEntrySchema.parse({})).toEqual({}));
  it('bulk upserts and deletes', () => {
    const v = bulkTimesheetSchema.parse({ upserts: [{ id: O, employeeId: E, workDate: '2026-09-03', hours: 3, indirectCategory: 'TRAINING' }], deletes: [] });
    expect(v.upserts[0].id).toBe(O);
    expect(bulkTimesheetSchema.safeParse({ upserts: [], deletes: [] }).success).toBe(false);
  });
  it('query ranges up to 62 days, from <= to', () => {
    expect(timesheetQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success).toBe(true);
    expect(timesheetQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(false);
    expect(timesheetQuerySchema.safeParse({ from: '2026-01-01', to: '2026-06-01' }).success).toBe(false);
  });
  it('utilisation period is YYYY-MM', () => expect(labourUtilisationQuerySchema.safeParse({ period: '2026-13' }).success).toBe(false));
});
