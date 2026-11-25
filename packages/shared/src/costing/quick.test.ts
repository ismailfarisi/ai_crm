import { describe, expect, it } from 'vitest';
import { costQuickLine, priceForMargin, QuickCostError } from './quick';
import type { CostingCatalog } from './types';

const catalog: Pick<CostingCatalog, 'materials' | 'workCenters'> = {
  materials: {
    acrylic: { id: 'acrylic', name: 'Acrylic 5mm', uom: 'SHEET', costPerUom: 180, wastePct: 0.1 },
    vinyl: { id: 'vinyl', name: 'Vinyl', uom: 'METRE', costPerUom: 12.5 },
  },
  workCenters: {
    router: { id: 'router', name: 'CNC router', setupMinutes: 15, machineCostPerHour: 60, laborCostPerHour: 40, minChargeMinutes: 60 },
    bench: { id: 'bench', name: 'Assembly', setupMinutes: 0, machineCostPerHour: 0, laborCostPerHour: 35 },
  },
};

describe('costQuickLine', () => {
  it('costs materials with waste, hours at catalog rates, bought-in and overhead', () => {
    const result = costQuickLine(
      {
        materials: [
          { materialId: 'acrylic', quantity: 2 },
          { materialId: 'vinyl', quantity: 4 },
        ],
        hours: [
          { workCenterId: 'router', hours: 0.5 },
          { workCenterId: 'bench', hours: 3 },
        ],
        boughtIn: [{ description: 'LED modules', amount: 240 }],
        overheadPct: 0.1,
        costedForQuantity: 2,
      },
      catalog,
      2,
    );
    // 2 sheets + 10% = 2.2, bought whole: 3 sheets.
    expect(result.materials[0].purchaseUnits).toBe(3);
    expect(result.materialCost).toBe(540 + 50);
    // The router charges its one-hour minimum.
    expect(result.hours[0].chargedHours).toBe(1);
    expect(result.machineCost).toBe(60);
    expect(result.laborCost).toBe(40 + 105);
    expect(result.boughtInCost).toBe(240);
    expect(result.directCost).toBe(1035);
    expect(result.overheadCost).toBe(103.5);
    expect(result.totalCost).toBe(1138.5);
    expect(result.unitCost).toBe(569.25);
  });

  it('scales the amounts when the line quantity changes', () => {
    const result = costQuickLine(
      {
        materials: [{ materialId: 'vinyl', quantity: 2 }],
        hours: [{ workCenterId: 'bench', hours: 1 }],
        boughtIn: [{ description: 'Fixings', amount: 10 }],
        overheadPct: 0,
        costedForQuantity: 5,
      },
      catalog,
      10,
    );
    expect(result.scale).toBe(2);
    expect(result.totalCost).toBe(50 + 70 + 20);
    expect(result.unitCost).toBe(14);
  });

  it('does not round a whole sheet up on a float', () => {
    const result = costQuickLine(
      {
        materials: [{ materialId: 'acrylic', quantity: 10 }],
        hours: [],
        boughtIn: [],
        overheadPct: 0,
        costedForQuantity: 1,
      },
      catalog,
      1,
    );
    expect(result.materials[0].purchaseUnits).toBe(11);
  });

  it('refuses a costing that adds up to nothing or names a removed material', () => {
    expect(() =>
      costQuickLine({ materials: [], hours: [], boughtIn: [], overheadPct: 0.2, costedForQuantity: 1 }, catalog, 1),
    ).toThrow(QuickCostError);
    expect(() =>
      costQuickLine(
        { materials: [{ materialId: 'gone', quantity: 1 }], hours: [], boughtIn: [], overheadPct: 0, costedForQuantity: 1 },
        catalog,
        1,
      ),
    ).toThrow(/removed/);
  });
});

describe('priceForMargin', () => {
  it('gives the unit price that keeps the margin after discount', () => {
    expect(priceForMargin(80, 0.2)).toBe(100);
    expect(priceForMargin(80, 0.2, 20)).toBe(125);
    expect(priceForMargin(10, 1)).toBeNull();
  });
});
