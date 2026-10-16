import { describe, expect, it } from 'vitest';
import { gratuityEntitlement } from './gratuity';

describe('gratuityEntitlement', () => {
  it('3 years at 6,000 → 63 days → 12,600', () => {
    const r = gratuityEntitlement({ joiningDate: '2023-10-01', asOf: '2026-09-30', basic: 6000, unpaidLeaveDays: 0, isNational: false });
    expect(r.serviceDays).toBe(1096); // includes a leap day
    expect(r.amount).toBeCloseTo(12611.51, 2); // 1096/365 years × 21 days × 200
  });

  it('exactly 365 × 3 service days at 6,000 → 12,600', () => {
    const r = gratuityEntitlement({ joiningDate: '2021-01-01', asOf: '2023-12-31', basic: 6000, unpaidLeaveDays: 0, isNational: false });
    expect(r.serviceDays).toBe(1095);
    expect(r.gratuityDays).toBe(63);
    expect(r.amount).toBe(12600);
  });

  it('7 years (2555 days) at 10,000 → 165 days → 55,000', () => {
    const r = gratuityEntitlement({ joiningDate: '2016-01-01', asOf: '2022-12-30', basic: 10000, unpaidLeaveDays: 0, isNational: false });
    // 2016-01-01..2022-12-30 inclusive = 2556 days incl. 2 leap days; subtract 1 unpaid day → 2555
    const r2 = gratuityEntitlement({ joiningDate: '2016-01-01', asOf: '2022-12-30', basic: 10000, unpaidLeaveDays: 1, isNational: false });
    expect(r2.serviceDays).toBe(2555);
    expect(r2.gratuityDays).toBe(165);
    expect(r2.amount).toBe(55000);
    expect(r.serviceDays).toBe(2556);
  });

  it('switches to 30 days a year after year five', () => {
    // 2020-01-01..2024-12-30 inclusive = 1826 days (incl. leap days); 1 unpaid day → 1825 = 5 years → 5 × 21
    const at5 = gratuityEntitlement({ joiningDate: '2020-01-01', asOf: '2024-12-30', basic: 3000, unpaidLeaveDays: 1, isNational: false });
    expect(at5.serviceDays).toBe(1825);
    expect(at5.gratuityDays).toBe(105);
  });

  it('caps at two years of basic', () => {
    const r = gratuityEntitlement({ joiningDate: '1990-01-01', asOf: '2026-01-01', basic: 10000, unpaidLeaveDays: 0, isNational: false });
    expect(r.amount).toBe(240000);
  });

  it('unpaid leave reduces service', () => {
    const a = gratuityEntitlement({ joiningDate: '2025-01-01', asOf: '2025-12-31', basic: 6000, unpaidLeaveDays: 0, isNational: false });
    const b = gratuityEntitlement({ joiningDate: '2025-01-01', asOf: '2025-12-31', basic: 6000, unpaidLeaveDays: 10, isNational: false });
    expect(b.serviceDays).toBe(a.serviceDays - 10);
    expect(b.amount).toBeLessThan(a.amount);
  });

  it('nationals accrue nothing', () => {
    expect(gratuityEntitlement({ joiningDate: '2020-01-01', asOf: '2026-01-01', basic: 10000, unpaidLeaveDays: 0, isNational: true }).amount).toBe(0);
  });

  it('asOf before joining → zero', () => {
    expect(gratuityEntitlement({ joiningDate: '2026-02-01', asOf: '2026-01-31', basic: 5000, unpaidLeaveDays: 0, isNational: false }).amount).toBe(0);
  });
});
