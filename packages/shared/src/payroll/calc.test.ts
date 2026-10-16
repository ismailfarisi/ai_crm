import { describe, expect, it } from 'vitest';
import { computeLine, daysEmployed, packageGross, periodBounds } from './calc';

describe('periodBounds', () => {
  it('gives first, last and length', () => {
    expect(periodBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28', daysInMonth: 28 });
    expect(periodBounds('2028-02').daysInMonth).toBe(29);
  });
});

describe('daysEmployed', () => {
  it('full month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2020-01-01', leavingDate: null })).toBe(31));
  it('joined on the last day', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2026-10-31', leavingDate: null })).toBe(1));
  it('left on the first day', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2020-01-01', leavingDate: '2026-10-01' })).toBe(1));
  it('joined mid-month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2026-10-15', leavingDate: null })).toBe(17));
  it('joined after the month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2026-11-01', leavingDate: null })).toBe(0));
  it('left before the month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2020-01-01', leavingDate: '2026-09-30' })).toBe(0));
});

describe('computeLine', () => {
  const base = { gross: 9000, basic: 6000, daysEmployed: 31, daysInMonth: 31, overtimeHours: 0, overtimeHoursPremium: 0, bonusAmount: 0, unpaidLeaveDays: 0, advanceRecovery: 0, otherDeductionAmount: 0 };

  it('full month, no extras', () => {
    expect(computeLine(base)).toEqual({ proratedGross: 9000, overtimeAmount: 0, unpaidLeaveAmount: 0, netPay: 9000, salaryCost: 9000 });
  });

  it('prorates by calendar days', () => {
    expect(computeLine({ ...base, daysEmployed: 17 }).proratedGross).toBe(4935.48);
  });

  it('overtime on basic ÷ 30 ÷ 8 at 1.25 and 1.5', () => {
    // hourly = 25; 10 × 1.25 × 25 = 312.5; 4 × 1.5 × 25 = 150
    expect(computeLine({ ...base, overtimeHours: 10, overtimeHoursPremium: 4 }).overtimeAmount).toBe(462.5);
  });

  it('unpaid leave on gross ÷ 30', () => {
    const r = computeLine({ ...base, unpaidLeaveDays: 2 });
    expect(r.unpaidLeaveAmount).toBe(600);
    expect(r.salaryCost).toBe(8400);
  });

  it('net pay subtracts recoveries and deductions; salary cost does not', () => {
    const r = computeLine({ ...base, bonusAmount: 500, advanceRecovery: 1000, otherDeductionAmount: 200 });
    expect(r.netPay).toBe(8300);
    expect(r.salaryCost).toBe(9500);
  });
});

describe('packageGross', () => {
  it('sums the package', () => {
    expect(packageGross({ basic: 6000, housing: 2000, transport: 800, otherAllowances: [{ label: 'Phone', amount: 200 }] })).toBe(9000);
  });
});
