import { describe, expect, it } from 'vitest';
import { summariseJobCost } from './job-cost';

const base = { material: 0, labour: 0, machineAndOverhead: 0, boughtIn: 0, alertPct: 0.1 };

describe('summariseJobCost', () => {
  it('leaves the quoted margin when nothing has been spent yet', () => {
    const s = summariseJobCost({ ...base, price: 10000, quotedCost: 6000 });
    expect(s.quotedMargin).toBe(4000);
    expect(s.actual.total).toBe(0);
    expect(s.marginLeft).toBe(10000);
    expect(s.overBudget).toBe(false);
  });

  it('adds material, labour, machine and bought-in into the actual cost', () => {
    const s = summariseJobCost({
      ...base,
      price: 10000,
      quotedCost: 6000,
      material: 2500,
      labour: 1200.5,
      machineAndOverhead: 300,
      boughtIn: 1800,
    });
    expect(s.actual.total).toBe(5800.5);
    expect(s.marginLeft).toBe(4199.5);
    expect(s.marginLeftPct).toBeCloseTo(0.42, 3);
  });

  it('warns only past the threshold, not at it', () => {
    expect(summariseJobCost({ ...base, price: 10000, quotedCost: 6000, boughtIn: 6600 }).overBudget).toBe(false);
    const over = summariseJobCost({ ...base, price: 10000, quotedCost: 6000, boughtIn: 6601 });
    expect(over.overBudget).toBe(true);
    expect(over.overByPct).toBe(0.1002);
  });

  it('cannot be over budget without a quoted cost', () => {
    const s = summariseJobCost({ ...base, price: 5000, quotedCost: null, boughtIn: 9000 });
    expect(s.overByPct).toBeNull();
    expect(s.overBudget).toBe(false);
    expect(s.marginLeft).toBe(-4000);
  });
});
