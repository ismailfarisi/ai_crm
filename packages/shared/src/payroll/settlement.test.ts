import { describe, expect, it } from 'vitest';
import { leaveEncashment, noticePay, settlementGratuity } from './settlement';

describe('settlement figures', () => {
  it('no gratuity under a year of service', () => expect(settlementGratuity({ serviceDays: 364, statutory: 5000, adjustments: 0 })).toBe(0));
  it('statutory plus adjustments from a year', () => expect(settlementGratuity({ serviceDays: 365, statutory: 5000, adjustments: 250 })).toBe(5250));
  it('adjustments still apply under a year', () => expect(settlementGratuity({ serviceDays: 200, statutory: 3000, adjustments: 100 })).toBe(100));
  it('encashes leave on basic ÷ 30', () => expect(leaveEncashment({ days: 12.5, basic: 6000 })).toBe(2500));
  it('a negative balance is a deduction', () => expect(leaveEncashment({ days: -3, basic: 6000 })).toBe(-600));
  it('notice pay on gross ÷ 30, paid or deducted', () => {
    expect(noticePay({ days: 30, gross: 9000, direction: 'PAY' })).toBe(9000);
    expect(noticePay({ days: 10, gross: 9000, direction: 'DEDUCT' })).toBe(-3000);
  });
});
