import { describe, expect, it } from 'vitest';
import { leaveRecordSchema, payrollSettingsSchema, postOpeningLeaveSchema, updateSettlementSchema, createPensionSchemeSchema, updatePensionSchemeSchema } from './payroll-compliance';

describe('payrollSettingsSchema', () => {
  it('needs the employer and routing code when WPS is on', () => {
    expect(payrollSettingsSchema.safeParse({ wpsEnabled: true }).success).toBe(false);
    expect(payrollSettingsSchema.parse({ wpsEnabled: true, employerIdType: 'MOHRE', employerId: '1234567890123', payerRoutingCode: '803320101' }).annualLeaveDays).toBe(30);
  });
  it('a MOHRE ID is 13 digits', () => {
    expect(payrollSettingsSchema.safeParse({ wpsEnabled: true, employerIdType: 'MOHRE', employerId: '12AB', payerRoutingCode: '803320101' }).success).toBe(false);
  });
  it('WPS off needs nothing', () => expect(payrollSettingsSchema.parse({ wpsEnabled: false }).employerId).toBeNull());
  it('annual leave days 30..60', () => expect(payrollSettingsSchema.safeParse({ wpsEnabled: false, annualLeaveDays: 22 }).success).toBe(false));
});

describe('leaveRecordSchema', () => {
  it('defaults days to the calendar span', () => expect(leaveRecordSchema.parse({ type: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-05' }).days).toBe(5));
  it('refuses end before start', () => expect(leaveRecordSchema.safeParse({ type: 'SICK', startDate: '2026-10-05', endDate: '2026-10-01' }).success).toBe(false));
  it('refuses more days than the span', () => expect(leaveRecordSchema.safeParse({ type: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', days: 3 }).success).toBe(false));
  it('allows half days', () => expect(leaveRecordSchema.parse({ type: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-01', days: 0.5 }).days).toBe(0.5));
});

describe('createPensionSchemeSchema', () => {
  it('min salary cannot exceed max', () => expect(createPensionSchemeSchema.safeParse({ name: 'X', employeePct: 5, employerPct: 15, base: 'GROSS', minSalary: 5000, maxSalary: 1000 }).success).toBe(false));
});

describe('updatePensionSchemeSchema', () => {
  it('applies no defaults and refines min <= max when both are sent', () => {
    expect(updatePensionSchemeSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updatePensionSchemeSchema.safeParse({ minSalary: 5000, maxSalary: 1000 }).success).toBe(false);
  });
});

describe('postOpeningLeaveSchema', () => {
  it('accepts a negative balance (leave taken in advance)', () => {
    expect(postOpeningLeaveSchema.parse({ cutoverDate: '2026-09-30', lines: [{ employeeId: '6f1c2c1e-0000-4000-8000-000000000001', balanceDays: -2 }] }).lines[0].balanceDays).toBe(-2);
  });
});

describe('updateSettlementSchema', () => {
  it('manual lines need a positive amount and a label', () => {
    expect(updateSettlementSchema.safeParse({ manualLines: [{ kind: 'ADDITION', label: '', amount: 10 }] }).success).toBe(false);
    expect(updateSettlementSchema.parse({ manualLines: [{ kind: 'DEDUCTION', label: 'Damages', amount: 250 }] }).manualLines?.[0].amount).toBe(250);
  });
});
