import { describe, it, expect } from 'vitest';
import {
  CostingError,
  calculatePriceBreaks,
  costTemplate,
  estimateWorkingDays,
  resolveParameters,
} from './engine';
import { RIGID_BOX_TEMPLATE, SAMPLE_CATALOG } from './templates/rigid-box';
import type { ProductTemplate } from './types';

/** A 200×150×80mm two-piece rigid box — a typical mid-size gift box. */
const BOX = {
  length_mm: 200,
  width_mm: 150,
  height_mm: 80,
  finish: 'matt',
};

const cost = (quantity: number, overrides: Record<string, unknown> = {}) =>
  costTemplate(
    RIGID_BOX_TEMPLATE,
    SAMPLE_CATALOG,
    { ...BOX, ...overrides } as Record<string, string | number | boolean>,
    quantity,
  );

describe('costTemplate — rigid gift box', () => {
  it('derives the board blanks from the box dimensions', () => {
    const result = cost(500);

    // base: width + 2*height + 4*thickness = 150 + 160 + 8
    expect(result.scope.base_blank_w).toBe(318);
    // base: length + 2*height + 4*thickness = 200 + 160 + 8
    expect(result.scope.base_blank_h).toBe(368);
    // lid depth is max(25, round(80 * 0.3)) = 25
    expect(result.scope.lid_depth_mm).toBe(25);
    // wrap adds the turn-in on both sides: 318 + 30
    expect(result.scope.base_wrap_w).toBe(348);
  });

  it('buys whole sheets, not area', () => {
    const result = cost(500);
    const boardBase = result.materials.find((line) => line.key === 'board_base');

    expect(boardBase).toBeDefined();
    expect(boardBase!.perSheet).toBe(4);
    // ceil(500 * 1.03 / 4) = ceil(128.75) = 129
    expect(boardBase!.purchaseUnits).toBe(129);
    expect(boardBase!.cost).toBeCloseTo(129 * 1.85, 2);
  });

  it('honours the grain lock on printed wrap', () => {
    const wrapBase = cost(500).materials.find((line) => line.key === 'wrap_base');
    // Art paper is grained, so the 348×398 blank cannot rotate on 720×1020.
    expect(wrapBase!.orientation).toBe('AS_IS');
  });

  it('skips conditional materials and operations that are switched off', () => {
    const plain = cost(500);
    expect(plain.materials.some((line) => line.key === 'magnets')).toBe(false);
    expect(plain.operations.some((line) => line.key === 'magnet_fit')).toBe(false);

    const magnetic = cost(500, { magnet: true });
    const magnets = magnetic.materials.find((line) => line.key === 'magnets');
    expect(magnets!.purchaseUnits).toBe(1000); // 2 per box
    expect(magnetic.operations.some((line) => line.key === 'magnet_fit')).toBe(true);
    expect(magnetic.totalCost).toBeGreaterThan(plain.totalCost);
  });

  it('drops the laminator from the routing when there is no finish', () => {
    expect(cost(500).operations.some((line) => line.key === 'laminate')).toBe(true);
    expect(cost(500, { finish: 'none' }).operations.some((line) => line.key === 'laminate')).toBe(
      false,
    );
  });

  it('charges setup once, independent of quantity', () => {
    const small = cost(100).operations.find((line) => line.key === 'diecut');
    const large = cost(2500).operations.find((line) => line.key === 'diecut');

    expect(small!.setupMinutes).toBe(35);
    expect(large!.setupMinutes).toBe(35);
    expect(large!.runMinutes).toBeGreaterThan(small!.runMinutes);
  });

  it('rolls material, machine, labour, tooling and overhead into the total', () => {
    const result = cost(500);
    const direct =
      result.materialCost + result.machineCost + result.laborCost + result.amortizedToolingCost;

    expect(result.directCost).toBeCloseTo(direct, 1);
    expect(result.overheadCost).toBeCloseTo(direct * 0.12, 1);
    expect(result.totalCost).toBeCloseTo(direct * 1.12, 1);
    expect(result.unitCost).toBeCloseTo(result.totalCost / 500, 2);
  });

  it('prices on margin, not markup', () => {
    const result = cost(500);
    // 35% margin means cost / 0.65, which is a 53.8% markup — not cost * 1.35.
    expect(result.price.marginPct).toBeGreaterThanOrEqual(0.35);
    expect(result.price.totalPrice).toBeGreaterThan(result.totalCost * 1.5);
    expect(result.price.marginAmount).toBeCloseTo(
      result.price.totalPrice - result.totalCost,
      1,
    );
  });

  it('produces a plausible unit price for a 500-run box', () => {
    const result = cost(500);
    // Sanity band, not a golden value — hand-wrapping should dominate labour.
    expect(result.price.unitPrice).toBeGreaterThan(2);
    expect(result.price.unitPrice).toBeLessThan(8);

    const wrap = result.operations.find((line) => line.key === 'wrap');
    expect(wrap!.laborCost).toBeGreaterThan(result.machineCost);
  });
});

describe('price breaks', () => {
  it('drops the unit price as quantity rises, because setup amortises', () => {
    const breaks = calculatePriceBreaks(
      RIGID_BOX_TEMPLATE,
      SAMPLE_CATALOG,
      BOX,
      [100, 250, 500, 1000, 2500],
    );

    expect(breaks.map((row) => row.quantity)).toEqual([100, 250, 500, 1000, 2500]);
    for (let i = 1; i < breaks.length; i++) {
      expect(breaks[i].unitPrice).toBeLessThan(breaks[i - 1].unitPrice);
    }
    // Setup and tooling dominate a short run — the 100 price is far above 2500.
    expect(breaks[0].unitPrice).toBeGreaterThan(breaks[4].unitPrice * 1.5);
  });

  it('returns breaks sorted even when the caller passes them jumbled', () => {
    const breaks = calculatePriceBreaks(
      RIGID_BOX_TEMPLATE,
      SAMPLE_CATALOG,
      BOX,
      [1000, 100, 500],
    );
    expect(breaks.map((row) => row.quantity)).toEqual([100, 500, 1000]);
  });

  it('is a step function — one more box can cost a whole extra sheet', () => {
    // 4 base blanks per sheet at 3% waste: 388 needs 100 sheets, 389 needs 101.
    const at388 = cost(388).materials.find((line) => line.key === 'board_base');
    const at389 = cost(389).materials.find((line) => line.key === 'board_base');
    expect(at388!.purchaseUnits).toBe(100);
    expect(at389!.purchaseUnits).toBe(101);
  });
});

describe('tooling', () => {
  it('amortises the die into the unit price on a first order', () => {
    const result = cost(500);
    const die = result.tooling.find((line) => line.key === 'die');
    expect(die!.cost).toBe(180);
    expect(die!.reused).toBe(false);
    expect(result.amortizedToolingCost).toBe(180);
  });

  it('does not re-charge a die the customer already owns', () => {
    const repeat = costTemplate(RIGID_BOX_TEMPLATE, SAMPLE_CATALOG, BOX, 500, {
      toolingAlreadyOwned: ['cutting-die'],
    });
    const die = repeat.tooling.find((line) => line.key === 'die');

    expect(die!.reused).toBe(true);
    expect(die!.cost).toBe(0);
    expect(repeat.totalCost).toBeLessThan(cost(500).totalCost);
  });
});

describe('lead time', () => {
  it('treats a parallel group as its slowest member, not the sum', () => {
    const result = cost(500);
    expect(result.criticalPathMinutes).toBeLessThan(result.totalMinutes);
  });

  it('derives working days from the busiest work centre', () => {
    const small = estimateWorkingDays(cost(100), SAMPLE_CATALOG);
    const large = estimateWorkingDays(cost(2500), SAMPLE_CATALOG);

    expect(small).toBeGreaterThanOrEqual(1);
    expect(large).toBeGreaterThan(small);
  });
});

describe('validation', () => {
  it('fills defaults and rejects an out-of-range dimension', () => {
    const resolved = resolveParameters(RIGID_BOX_TEMPLATE, BOX);
    expect(resolved.board_thickness_mm).toBe(2);
    expect(resolved.turn_in_mm).toBe(15);

    expect(() => cost(500, { height_mm: 900 })).toThrow(/above the maximum/);
  });

  it('rejects an unknown enum option', () => {
    expect(() => cost(500, { finish: 'velvet' })).toThrow(/must be one of/);
  });

  it('rejects an unknown parameter rather than silently ignoring it', () => {
    expect(() => cost(500, { widht_mm: 150 })).toThrow(/Unknown parameter/);
  });

  it('rejects a fractional or zero quantity', () => {
    expect(() => cost(0)).toThrow(/positive whole number/);
    expect(() => cost(10.5)).toThrow(/positive whole number/);
  });

  // The defining failure of a genuinely custom shape.
  it('fails loudly when a blank is too big for any sheet in stock', () => {
    expect(() => cost(500, { length_mm: 600, width_mm: 600, height_mm: 400 })).toThrow(CostingError);
    expect(() => cost(500, { length_mm: 600, width_mm: 600, height_mm: 400 })).toThrow(
      /does not fit on/,
    );
  });

  it('warns when a layout wastes most of the sheet', () => {
    const result = cost(500, { length_mm: 340, width_mm: 300, height_mm: 120 });
    expect(result.warnings.some((warning) => warning.includes('of each'))).toBe(true);
  });

  it('rejects an impossible target margin', () => {
    const broken: ProductTemplate = {
      ...RIGID_BOX_TEMPLATE,
      pricing: { ...RIGID_BOX_TEMPLATE.pricing, rate: 1 },
    };
    expect(() => costTemplate(broken, SAMPLE_CATALOG, BOX, 500)).toThrow(/between 0 and 1/);
  });

  it('names the offending formula when one fails', () => {
    const broken: ProductTemplate = {
      ...RIGID_BOX_TEMPLATE,
      derived: [{ key: 'bad', formula: 'widht_mm * 2' }],
    };
    expect(() => costTemplate(broken, SAMPLE_CATALOG, BOX, 500)).toThrow(/Derived "bad" failed/);
  });
});

describe('explainability', () => {
  it('snapshots the parameters, template version and full scope', () => {
    const result = cost(500);

    expect(result.templateId).toBe('rigid-box-2pc');
    expect(result.templateVersion).toBe(1);
    expect(result.parameters.length_mm).toBe(200);
    // Every intermediate is retained so a quote can explain itself later.
    expect(result.scope.base_blank_w).toBe(318);
    expect(result.scope.board_base_units).toBe(129);
    expect(result.scope.wrap_units).toBeUndefined();
  });
});
