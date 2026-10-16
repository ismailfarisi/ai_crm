import { describe, expect, it } from 'vitest';
import {
  allocateAbsorption,
  estimatedLabourRate,
  labourCost,
  labourRate,
  labourStatus,
  standardHours,
  unlinkedHours,
} from './labour';

describe('standardHours', () => {
  it('a full month is the tenant standard', () =>
    expect(standardHours({ daysEmployed: 31, daysInMonth: 31, monthlyStandardHours: 208, overtimeHours: 0, overtimeHoursPremium: 0 })).toBe(208));
  it('a joiner is prorated by calendar days', () =>
    expect(standardHours({ daysEmployed: 15, daysInMonth: 30, monthlyStandardHours: 208, overtimeHours: 0, overtimeHoursPremium: 0 })).toBe(104));
  it('paid overtime hours add to the hours the cost covers', () =>
    expect(standardHours({ daysEmployed: 30, daysInMonth: 30, monthlyStandardHours: 208, overtimeHours: 10, overtimeHoursPremium: 2 })).toBe(220));
});

describe('labourCost', () => {
  it('adds the employer on-costs to salary cost', () =>
    expect(labourCost({ salaryCost: 9000, pensionEmployer: 0, gratuityAccrual: 525, leaveProvisionChange: 500 })).toBe(10025));
  it('a negative true-up lowers it', () =>
    expect(labourCost({ salaryCost: 9000, pensionEmployer: 0, gratuityAccrual: -1200, leaveProvisionChange: 0 })).toBe(7800));
});

describe('labourRate', () => {
  it('cost over standard hours', () => expect(labourRate({ cost: 10400, standardHours: 208, loggedHours: 150 })).toBe(50));
  it('logged hours above standard', () => expect(labourRate({ cost: 10400, standardHours: 208, loggedHours: 260 })).toBe(40));
  it('nothing to absorb when cost is not positive', () => {
    expect(labourRate({ cost: 0, standardHours: 208, loggedHours: 10 })).toBe(0);
    expect(labourRate({ cost: -50, standardHours: 208, loggedHours: 10 })).toBe(0);
  });
  it('no hours, no rate', () => expect(labourRate({ cost: 100, standardHours: 0, loggedHours: 0 })).toBe(0));
  it('rounds to four places', () => expect(labourRate({ cost: 10000, standardHours: 208, loggedHours: 0 })).toBe(48.0769));
});

describe('estimatedLabourRate', () => {
  it('gross plus statutory on-costs over standard hours', () =>
    // 9000 + 0 + 6000×21/30/12 (350) + 6000×30/30/12 (500) = 9850 / 208
    expect(estimatedLabourRate({ gross: 9000, basic: 6000, pensionEmployer: 0, isNational: false, annualLeaveDays: 30, monthlyStandardHours: 208 })).toBe(47.3558));
  it('nationals have pension and no gratuity', () =>
    // 9000 + 1350 + 0 + 500 = 10850 / 208
    expect(estimatedLabourRate({ gross: 9000, basic: 6000, pensionEmployer: 1350, isNational: true, annualLeaveDays: 30, monthlyStandardHours: 208 })).toBe(52.1635));
});

describe('allocateAbsorption', () => {
  it('puts the rounding remainder on the largest entry', () => {
    const m = allocateAbsorption([{ id: 'a', hours: 1 }, { id: 'b', hours: 3 }, { id: 'c', hours: 1 }], 33.3333, Infinity);
    // Σ = round2(5 × 33.3333) = 166.67; each rounds to 33.33 / 100.00 / 33.33 = 166.66
    expect([...m.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(166.67, 2);
    expect(m.get('b')).toBe(100.01);
  });
  it('never absorbs more than the cap', () => {
    const m = allocateAbsorption([{ id: 'a', hours: 8 }, { id: 'b', hours: 2 }], 50, 400);
    expect(m.get('a')! + m.get('b')!).toBe(400);
  });
  it('logged hours above standard absorb no more than cost, within a cent', () => {
    const cost = 10400;
    const rate = labourRate({ cost, standardHours: 208, loggedHours: 260 });
    const m = allocateAbsorption([{ id: 'a', hours: 200 }, { id: 'b', hours: 60 }], rate, cost);
    const absorbed = [...m.values()].reduce((s, v) => s + v, 0);
    expect(absorbed).toBeLessThanOrEqual(cost);
    expect(absorbed).toBeGreaterThanOrEqual(cost - 0.01);
  });
  it('no entries, empty map', () => expect(allocateAbsorption([], 50, 100).size).toBe(0));
});

describe('unlinkedHours', () => {
  it('minutes not covered by entries', () => expect(unlinkedHours(150, 2)).toBe(0.5));
  it('never negative', () => expect(unlinkedHours(60, 2)).toBe(0));
});

describe('labourStatus', () => {
  it('derives the status', () => {
    expect(labourStatus({ actual: 0, provisional: 0, unlinked: 0 })).toBeNull();
    expect(labourStatus({ actual: 10, provisional: 0, unlinked: 0 })).toBe('ACTUAL');
    expect(labourStatus({ actual: 10, provisional: 5, unlinked: 0 })).toBe('PROVISIONAL');
    expect(labourStatus({ actual: 10, provisional: 0, unlinked: 5 })).toBe('MIXED');
    expect(labourStatus({ actual: 0, provisional: 0, unlinked: 5 })).toBe('STANDARD');
  });
});
