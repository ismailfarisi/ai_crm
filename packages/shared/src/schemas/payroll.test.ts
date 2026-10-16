import { describe, expect, it } from 'vitest';
import {
  createEmployeeSchema, createPayrollRunSchema, createSalaryPackageSchema,
  payPayrollRunSchema, postOpeningGratuitySchema, updatePayrollLineSchema, gratuityAdjustmentSchema, updateEmployeeSchema,
} from './payroll';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('payroll schemas', () => {
  it('employee: normalises empties, requires a joining date, iban only for bank', () => {
    const out = createEmployeeSchema.parse({ firstName: 'Ada', lastName: 'Okafor', joiningDate: '2024-03-01', paymentMethod: 'BANK', iban: ' ae07 0331 2345 6789 0123 456 ', jobTitle: '' });
    expect(out).toMatchObject({ jobTitle: null, iban: 'AE070331234567890123456', isNational: false, status: 'ACTIVE' });
    expect(() => createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', paymentMethod: 'CASH' })).toThrow();
    expect(createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', joiningDate: '2024-01-01', paymentMethod: 'CASH', iban: 'AE07' }).iban).toBeNull();
  });

  it('employee: accepts nulls from a loaded record', () => {
    expect(() => createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', joiningDate: '2024-01-01', paymentMethod: 'CASH', userId: null, leavingDate: null, nationality: null, email: null, phone: null, bankName: null, department: null })).not.toThrow();
  });

  it('employee: leaving date must not precede joining', () => {
    expect(() => createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', joiningDate: '2024-05-01', leavingDate: '2024-04-30', paymentMethod: 'CASH' })).toThrow();
  });

  it('update: no defaults leak into partial edits', () => {
    expect(updateEmployeeSchema.parse({})).toEqual({});
    const out = updateEmployeeSchema.parse({ firstName: 'X' });
    expect(out).toEqual({ firstName: 'X' });
    expect('status' in out).toBe(false);
    expect('isNational' in out).toBe(false);
    expect(updateEmployeeSchema.parse({ leavingDate: null })).toEqual({ leavingDate: null });
    expect(updateEmployeeSchema.parse({ email: '' })).toEqual({ email: null });
    expect(updateEmployeeSchema.parse({ iban: ' ae07 12 ' })).toEqual({ iban: 'AE0712' });
  });

  it('nationality: empty becomes null, bad length rejected', () => {
    expect(updateEmployeeSchema.parse({ nationality: '' })).toEqual({ nationality: null });
    expect(updateEmployeeSchema.parse({ nationality: 'ae' })).toEqual({ nationality: 'AE' });
    expect(() => updateEmployeeSchema.parse({ nationality: 'UAE' })).toThrow();
  });

  it('salary package coerces and defaults', () => {
    expect(createSalaryPackageSchema.parse({ effectiveFrom: '2026-01-01', basic: '6000', housing: '2000' }))
      .toEqual({ effectiveFrom: '2026-01-01', basic: 6000, housing: 2000, transport: 0, otherAllowances: [] });
    expect(() => createSalaryPackageSchema.parse({ effectiveFrom: '2026-01-01', basic: 0 })).toThrow();
  });

  it('run period format', () => {
    expect(createPayrollRunSchema.parse({ period: '2026-10' })).toEqual({ period: '2026-10', payDate: null });
    expect(() => createPayrollRunSchema.parse({ period: '2026-13' })).toThrow();
  });

  it('line extras are non-negative numbers; labels trimmed', () => {
    expect(updatePayrollLineSchema.parse({ overtimeHours: '10', bonusLabel: ' Q3 ' })).toEqual({ overtimeHours: 10, bonusLabel: 'Q3' });
    expect(() => updatePayrollLineSchema.parse({ unpaidLeaveDays: -1 })).toThrow();
  });

  it('pay and opening gratuity', () => {
    expect(payPayrollRunSchema.parse({ method: 'BANK', financeAccountId: uuid }).method).toBe('BANK');
    expect(() => postOpeningGratuitySchema.parse({ cutoverDate: '2026-09-30', lines: [] })).toThrow();
    expect(() => gratuityAdjustmentSchema.parse({ amount: 0, note: 'x' })).toThrow();
  });
});

describe('employee compliance fields', () => {
  const base = { firstName: 'A', lastName: 'B', joiningDate: '2024-01-01', paymentMethod: 'CASH' as const };
  it('validates WPS person ID and routing code', () => {
    expect(createEmployeeSchema.safeParse({ ...base, wpsPersonId: '123' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, bankRoutingCode: '12345' }).success).toBe(false);
    const ok = createEmployeeSchema.parse({ ...base, wpsPersonId: '10000000000001', bankRoutingCode: '803320101', probationEndDate: '2024-06-30' });
    expect(ok.wpsPersonId).toBe('10000000000001');
    expect(ok.pensionSchemeId).toBeNull();
    expect(ok.annualLeaveDaysOverride).toBeNull();
  });
  it('the update schema still applies no defaults', () => {
    expect(updateEmployeeSchema.parse({ wpsPersonId: '10000000000001' })).toEqual({ wpsPersonId: '10000000000001' });
  });
});

describe('updatePayrollLineSchema leave fields', () => {
  it('accepts half pay days and a reset to automatic', () => {
    expect(updatePayrollLineSchema.parse({ halfPayDays: 2 })).toEqual({ halfPayDays: 2 });
    expect(updatePayrollLineSchema.parse({ leaveOverridden: false })).toEqual({ leaveOverridden: false });
    expect(updatePayrollLineSchema.safeParse({ leaveOverridden: true }).success).toBe(false);
  });
});
