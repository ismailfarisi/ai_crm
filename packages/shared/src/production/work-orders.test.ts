import { describe, expect, it } from 'vitest';
import {
  actualCost,
  canTransitionWorkOrder,
  elapsedMinutes,
  rankVariance,
  type OperationCostInput,
  type VarianceSample,
} from './work-orders';

const op = (over: Partial<OperationCostInput> = {}): OperationCostInput => ({
  workCenterId: 'press',
  workCenterName: 'Press',
  status: 'DONE',
  estimatedSetupMinutes: 15,
  estimatedRunMinutes: 45,
  estimatedChargedMinutes: 60,
  actualMinutes: 60,
  machineCostPerHour: 40,
  laborCostPerHour: 20,
  ...over,
});

describe('elapsedMinutes', () => {
  it('counts to a tenth of a minute', () => {
    expect(elapsedMinutes('2026-09-15T08:00:00Z', '2026-09-15T08:45:30Z')).toBe(45.5);
  });

  it('never goes negative when a clock is wrong', () => {
    expect(elapsedMinutes('2026-09-15T09:00:00Z', '2026-09-15T08:00:00Z')).toBe(0);
    expect(elapsedMinutes('nonsense', '2026-09-15T08:00:00Z')).toBe(0);
  });
});

describe('actualCost', () => {
  it('prices actual minutes at the snapshotted rates and applies overhead symmetrically', () => {
    const cost = actualCost({
      operations: [op({ actualMinutes: 90 })],
      materialValue: 100,
      toolingCost: 20,
      overheadPct: 0.1,
      qtyCompleted: 50,
    });
    // 1.5h × 40 machine, 1.5h × 20 labour
    expect(cost.machine).toBe(60);
    expect(cost.labor).toBe(30);
    // direct 100 + 60 + 30 + 20 = 210, overhead 21
    expect(cost.overhead).toBe(21);
    expect(cost.total).toBe(231);
    expect(cost.unit).toBe(4.62);
  });

  it('ignores skipped operations', () => {
    const cost = actualCost({
      operations: [op(), op({ status: 'SKIPPED', actualMinutes: 600 })],
      materialValue: 0,
      toolingCost: 0,
      overheadPct: 0,
      qtyCompleted: 1,
    });
    expect(cost.total).toBe(60);
  });

  it('makes scrap visible as a dearer unit rather than hiding it', () => {
    const inputs = { operations: [op()], materialValue: 40, toolingCost: 0, overheadPct: 0 };
    const allGood = actualCost({ ...inputs, qtyCompleted: 100 });
    const tenScrapped = actualCost({ ...inputs, qtyCompleted: 90 });
    expect(tenScrapped.total).toBe(allGood.total);
    expect(tenScrapped.unit).toBeGreaterThan(allGood.unit);
  });

  it('has no unit cost when nothing good was produced', () => {
    expect(
      actualCost({ operations: [op()], materialValue: 10, toolingCost: 0, overheadPct: 0, qtyCompleted: 0 }).unit,
    ).toBe(0);
  });
});

describe('rankVariance', () => {
  const sample = (over: Partial<VarianceSample>): VarianceSample => ({
    templateKey: 'rigid-box',
    templateName: 'Rigid box',
    templateVersion: 3,
    workCenterId: 'press',
    workCenterName: 'Press',
    estimatedMinutes: 100,
    actualMinutes: 100,
    laborCostPerHour: 20,
    machineCostPerHour: 40,
    ...over,
  });

  it('ranks by what the error cost, not by percentage', () => {
    const rows = rankVariance([
      // 60% over, but a two-minute step on a cheap bench
      sample({ workCenterId: 'glue', workCenterName: 'Glue', estimatedMinutes: 5, actualMinutes: 8, laborCostPerHour: 12, machineCostPerHour: 0 }),
      // 10% over on a four-hour press run
      sample({ estimatedMinutes: 240, actualMinutes: 264 }),
    ]);
    expect(rows.map((r) => r.workCenterName)).toEqual(['Press', 'Glue']);
    expect(rows[0].varianceCost).toBe(24);
    expect(rows[1].variancePct).toBe(0.6);
  });

  it('groups by template version and work centre, and lets long and short jobs partly cancel', () => {
    const rows = rankVariance([
      sample({ actualMinutes: 130 }),
      sample({ actualMinutes: 90 }),
      sample({ templateVersion: 4, actualMinutes: 100 }),
    ]);
    const v3 = rows.find((r) => r.templateVersion === 3)!;
    expect(v3.samples).toBe(2);
    expect(v3.varianceMinutes).toBe(20);
    expect(v3.suggestedFactor).toBe(1.1);
    expect(rows).toHaveLength(2);
  });

  it('does not divide by a zero estimate', () => {
    const [row] = rankVariance([sample({ estimatedMinutes: 0, actualMinutes: 30 })]);
    expect(row.variancePct).toBeNull();
    expect(row.suggestedFactor).toBeNull();
  });
});

describe('canTransitionWorkOrder', () => {
  it('never reopens a completed job', () => {
    expect(canTransitionWorkOrder('COMPLETE', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionWorkOrder('PLANNED', 'COMPLETE')).toBe(false);
    expect(canTransitionWorkOrder('IN_PROGRESS', 'COMPLETE')).toBe(true);
  });
});
