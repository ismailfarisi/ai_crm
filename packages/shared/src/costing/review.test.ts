import { describe, expect, it } from 'vitest';
import { reviewCosting, type ReviewInput, type ReviewMaterialUse, type ReviewOperation } from './review';

const board = { id: 'm1', name: 'Kraft board 300gsm', uom: 'SHEET', costPerUom: 2.4, wastePct: 0.05 };
const ink = { id: 'm2', name: 'Black ink', uom: 'KG', costPerUom: 20, wastePct: 0 };
const laser = { id: 'w1', name: 'Laser cutter', scrapPct: 0.05, machineCostPerHour: 120, laborCostPerHour: 40 };

const use = (wo: string, over: Partial<ReviewMaterialUse> = {}): ReviewMaterialUse => ({
  workOrderId: wo,
  woNumber: `WO-${wo}`,
  materialId: 'm1',
  qtyPlanned: 105,
  qtyNet: 105,
  valueIssued: 252,
  plannedWastePct: 0.05,
  ...over,
});

const op = (wo: string, over: Partial<ReviewOperation> = {}): ReviewOperation => ({
  workOrderId: wo,
  woNumber: `WO-${wo}`,
  workCenterId: 'w1',
  estimatedSetupMinutes: 15,
  estimatedRunMinutes: 105,
  estimatedChargedMinutes: 120,
  actualMinutes: 120,
  plannedScrapPct: 0.05,
  machineCostPerHour: 120,
  laborCostPerHour: 40,
  ...over,
});

const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  jobs: [],
  materialUses: [],
  operations: [],
  catalog: { materials: [board, ink], workCenters: [laser] },
  ...over,
});

describe('reviewCosting', () => {
  it('proposes nothing when jobs went as estimated', () => {
    const r = reviewCosting(input({ materialUses: ['a', 'b', 'c'].map((w) => use(w)), operations: ['a', 'b', 'c'].map((w) => op(w)) }));
    expect(r.proposals).toEqual([]);
  });

  it('proposes the price materials were actually issued at, once enough jobs agree', () => {
    const uses = ['a', 'b', 'c'].map((w) => use(w, { valueIssued: 105 * 2.76 }));
    const r = reviewCosting(input({ materialUses: uses }));
    const p = r.proposals.find((x) => x.kind === 'MATERIAL_PRICE');
    expect(p).toMatchObject({ target: { type: 'MATERIAL', id: 'm1' }, field: 'costPerUom', current: 2.4, proposed: 2.76, jobs: 3 });
    expect(p!.impact).toBeCloseTo(3 * 105 * 0.36, 2);
    expect(p!.reason).toMatch(/15\.0%/);
  });

  it('waits for enough jobs before proposing anything', () => {
    const uses = ['a', 'b'].map((w) => use(w, { valueIssued: 105 * 3 }));
    expect(reviewCosting(input({ materialUses: uses })).proposals).toEqual([]);
  });

  it('measures waste against what each job was planned with, so applying it does not propose again', () => {
    // Planned 100 net + 5% = 105; each job used 112, i.e. 12% over the net.
    const uses = ['a', 'b', 'c'].map((w) => use(w, { qtyNet: 112, valueIssued: 112 * 2.4 }));
    const before = reviewCosting(input({ materialUses: uses }));
    const waste = before.proposals.find((x) => x.kind === 'MATERIAL_WASTE')!;
    expect(waste).toMatchObject({ field: 'wastePct', current: 0.05, proposed: 0.12 });

    // After applying, the catalog says 12% — the same jobs no longer disagree.
    const after = reviewCosting(
      input({ materialUses: uses, catalog: { materials: [{ ...board, wastePct: 0.12 }, ink], workCenters: [laser] } }),
    );
    expect(after.proposals.find((x) => x.kind === 'MATERIAL_WASTE')).toBeUndefined();
  });

  it('leaves out jobs planned before the baseline was recorded', () => {
    const uses = ['a', 'b', 'c'].map((w) => use(w, { qtyNet: 130, valueIssued: 130 * 2.4, plannedWastePct: null }));
    expect(reviewCosting(input({ materialUses: uses })).proposals.map((p) => p.kind)).toEqual([]);
  });

  it('proposes a larger time allowance when runs take longer than planned', () => {
    // Raw run 100 min (+5% = 105); actual run 135 → 35% allowance.
    const ops = ['a', 'b', 'c'].map((w) => op(w, { actualMinutes: 150 }));
    const r = reviewCosting(input({ operations: ops }));
    const p = r.proposals.find((x) => x.kind === 'WORK_CENTER_TIME')!;
    expect(p).toMatchObject({ target: { type: 'WORK_CENTER', id: 'w1' }, field: 'scrapPct', current: 0.05, proposed: 0.35 });
    // 30 extra minutes on each of three jobs at 160/h.
    expect(p.impact).toBeCloseTo(3 * 30 * (160 / 60), 2);
  });

  it('ignores operations nobody timed', () => {
    const ops = ['a', 'b', 'c'].map((w) => op(w, { actualMinutes: 0 }));
    expect(reviewCosting(input({ operations: ops })).proposals).toEqual([]);
  });

  it('caps a proposal at what the catalog allows, and says so', () => {
    const ops = ['a', 'b', 'c'].map((w) => op(w, { actualMinutes: 400 }));
    const p = reviewCosting(input({ operations: ops })).proposals[0];
    expect(p.proposed).toBe(1);
    expect(p.capped).toBe(true);
  });

  it('notes a work centre that runs faster than its templates when its allowance is already zero', () => {
    const ops = ['a', 'b', 'c'].map((w) => op(w, { plannedScrapPct: 0, estimatedRunMinutes: 100, actualMinutes: 70 }));
    const r = reviewCosting(
      input({ operations: ops, catalog: { materials: [board], workCenters: [{ ...laser, scrapPct: 0 }] } }),
    );
    expect(r.proposals).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/Laser cutter/);
  });

  it('reports overall accuracy and orders proposals by money at stake', () => {
    const r = reviewCosting(
      input({
        jobs: [
          {
            workOrderId: 'a',
            woNumber: 'WO-a',
            estimated: { material: 100, machine: 50, labor: 30, tooling: 0, overhead: 18, total: 198, unit: 1.98 },
            actual: { material: 120, machine: 60, labor: 30, tooling: 0, overhead: 21, total: 231, unit: 2.31 },
          },
        ],
        materialUses: ['a', 'b', 'c'].map((w) => use(w, { valueIssued: 105 * 2.6 })),
        operations: ['a', 'b', 'c'].map((w) => op(w, { actualMinutes: 200 })),
      }),
    );
    expect(r.jobs).toBe(1);
    expect(r.variancePct).toBeCloseTo(16.67, 1);
    expect(r.byComponent.find((c) => c.component === 'material')).toEqual({ component: 'material', estimated: 100, actual: 120 });
    const impacts = r.proposals.map((p) => Math.abs(p.impact));
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
  });
});
