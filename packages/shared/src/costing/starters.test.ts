import { describe, expect, it } from 'vitest';
import { costTemplate } from './engine';
import { RIGID_BOX_TEMPLATE } from './templates/rigid-box';
import {
  STARTER_INDUSTRIES,
  STARTER_TEMPLATES,
  findStarterTemplate,
  previewStarterTemplate,
} from './templates/starters';
import { createProductTemplateSchema } from '../schemas/catalog';

const starter = (key: string) => {
  const found = findStarterTemplate(key);
  if (!found) throw new Error(`No starter ${key}`);
  return found;
};

const cost = (key: string, overrides: Record<string, string | number | boolean> = {}, quantity?: number) => {
  const { template, catalog, example } = starter(key);
  return costTemplate(template, catalog, { ...example.parameters, ...overrides }, quantity ?? example.quantity);
};

describe('starter template library', () => {
  it('has a starter for every industry, priced in AED', () => {
    for (const industry of STARTER_INDUSTRIES) {
      expect(STARTER_TEMPLATES.some((s) => s.industry === industry.id)).toBe(true);
    }
    for (const s of STARTER_TEMPLATES) expect(s.template.currency).toBe('AED');
  });

  it('only box templates draw a rigid box blank', () => {
    const drawn = STARTER_TEMPLATES.filter((s) => s.template.blankPreview === 'RIGID_BOX').map((s) => s.key);
    expect(drawn).toEqual(['rigid-box']);
  });

  it.each(STARTER_TEMPLATES.map((s) => [s.key, s] as const))(
    '%s names only primitives its own catalog defines',
    (_key, s) => {
      for (const line of s.template.materials) expect(s.catalog.materials[line.materialId]).toBeDefined();
      for (const line of s.template.operations) expect(s.catalog.workCenters[line.workCenterId]).toBeDefined();
      for (const line of s.template.tooling ?? []) expect(s.catalog.tooling[line.toolingId]).toBeDefined();
      for (const material of Object.values(s.catalog.materials)) expect(material.sku).toBeTruthy();
    },
  );

  it.each(STARTER_TEMPLATES.map((s) => [s.key, s] as const))(
    '%s costs its example job and every option combination without error',
    (_key, s) => {
      const preview = previewStarterTemplate(s);
      expect(preview.example.unitPrice).toBeGreaterThan(preview.example.unitCost);
      expect(preview.materials).toHaveLength(s.template.materials.length);

      for (const parameter of s.template.parameters) {
        const values =
          parameter.type === 'ENUM' ? (parameter.options ?? []) : parameter.type === 'BOOLEAN' ? [true, false] : [];
        for (const value of values) {
          const result = costTemplate(s.template, s.catalog, { ...s.example.parameters, [parameter.key]: value }, s.example.quantity);
          expect(result.totalCost).toBeGreaterThan(0);
        }
      }
    },
  );

  it('rigid box keeps the demo model and re-rates it in AED', () => {
    const { catalog } = starter('rigid-box');
    expect(catalog.materials['greyboard-2mm'].costPerUom).toBe(6.79); // 1.85 USD × 3.6725
    expect(starter('rigid-box').template.operations).toEqual(RIGID_BOX_TEMPLATE.operations);
  });

  it('RSC carton: two blanks a sheet, whole sheets plus waste, cutter time from sheets', () => {
    const result = cost('rsc-carton');
    const board = result.materials.find((m) => m.key === 'board_single')!;
    // Blank 2×400 + 2×300 + 35 = 1435 wide, 300 + 300 = 600 high on a 2180 × 1380 usable sheet.
    expect(board.perSheet).toBe(2);
    // 1000 boxes ÷ 2 = 500 sheets, + 3% waste = 515.
    expect(board.purchaseUnits).toBe(515);
    expect(board.cost).toBe(3862.5);
    const cut = result.operations.find((o) => o.key === 'cut_crease')!;
    // 515 sheets at 400 an hour = 77.25 min, + 2% scrap = 78.8; + 15 setup = 93.8 min at 80 AED/h.
    expect(cut.chargedMinutes).toBeCloseTo(93.8, 1);
    expect(cut.cost).toBeCloseTo(125.07, 1);
    expect(result.price.unitPrice).toBeGreaterThan(5);
    expect(result.price.unitPrice).toBeLessThan(10);
  });

  it('RSC carton: no print means no ink, no plate and a shorter slotter setup', () => {
    const result = cost('rsc-carton', { print: 'none' });
    expect(result.materials.some((m) => m.key === 'ink')).toBe(false);
    expect(result.tooling).toHaveLength(0);
    expect(result.operations.find((o) => o.key === 'print_slot')!.setupMinutes).toBe(20);
  });

  it('labels: 42 up on SRA3 and a die only for custom shapes', () => {
    const result = cost('label-run');
    const paper = result.materials.find((m) => m.key === 'paper')!;
    // 60×40 with a 3 mm gutter: 6 across × 7 down on 430 × 300 usable.
    expect(paper.perSheet).toBe(42);
    // 5000 ÷ 42 = 119.05 sheets, + 2% waste = 121.4, bought as 122.
    expect(paper.purchaseUnits).toBe(122);
    expect(result.tooling).toHaveLength(0);
    expect(result.price.unitPrice).toBeLessThan(0.2);

    const shaped = cost('label-run', { shape: 'custom die' });
    expect(shaped.tooling.map((t) => t.toolingId)).toEqual(['label-die']);
    expect(shaped.operations.some((o) => o.key === 'kiss_cut')).toBe(false);
  });

  it('sign: panel and letters are cut in parallel, LEDs and install are options', () => {
    const result = cost('acrylic-letter-sign');
    // 8 letters × 200 mm ÷ 60 mm a module = 26.7 → 27, + 5% waste = 28.35 → 29.
    expect(result.materials.find((m) => m.key === 'leds')!.purchaseUnits).toBe(29);
    expect(result.operations.find((o) => o.key === 'route_panel')!.branch).toBe('panel');
    expect(result.operations.find((o) => o.key === 'laser_letters')!.branch).toBe('letters');
    expect(result.price.unitPrice).toBeGreaterThan(1500);
    expect(result.price.unitPrice).toBeLessThan(5000);

    const plain = cost('acrylic-letter-sign', { lit: false, install: false });
    expect(plain.materials.some((m) => m.key === 'leds' || m.key === 'driver')).toBe(false);
    expect(plain.operations.some((o) => o.key === 'install' || o.key === 'wire')).toBe(false);
    expect(plain.price.unitPrice).toBeLessThan(result.price.unitPrice);
  });

  it('sheet metal: 48 parts a sheet and laser time from cut length and pierces', () => {
    const result = cost('sheet-metal-part');
    const sheet = result.materials.find((m) => m.key === 'mild_steel')!;
    // 300×200 with a 5 mm gutter on 2480 × 1230 usable: 8 × 6.
    expect(sheet.perSheet).toBe(48);
    expect(sheet.purchaseUnits).toBe(2);
    const laser = result.operations.find((o) => o.key === 'laser')!;
    // 50 × (1.4 m ÷ 8 m/min + 6 × 0.02) = 14.75 min, + 2% scrap = 15.05.
    expect(laser.runMinutes).toBeCloseTo(15.05, 2);

    expect(cost('sheet-metal-part', { bends: 4 }).tooling.map((t) => t.toolingId)).toEqual(['bend-fixture']);
    expect(cost('sheet-metal-part', { metal: 'stainless 304 1.5 mm' }).materialCost).toBeGreaterThan(
      result.materialCost,
    );
  });

  it('cabinet: board by area at a nesting yield, hardware per door, install optional', () => {
    const result = cost('cabinet-carcass');
    // Carcass (2×720×560 + 3×600×560) + door 600×720 = 2.2512 m² ÷ 2.9768 ÷ 0.82
    // = 0.922 sheets a cabinet; six cabinets buy 6 sheets.
    expect(result.materials.find((m) => m.key === 'mfc')!.purchaseUnits).toBe(6);
    // Two doors under 900 mm: two hinges each.
    expect(result.materials.find((m) => m.key === 'hinge')!.purchaseUnits).toBe(24);
    expect(result.operations.some((o) => o.key === 'install')).toBe(true);
    expect(result.price.unitPrice).toBeGreaterThan(500);
    expect(result.price.unitPrice).toBeLessThan(1200);

    const sprayed = cost('cabinet-carcass', { board: 'sprayed MDF', install: false });
    expect(sprayed.materials.some((m) => m.key === 'edge')).toBe(false);
    expect(sprayed.operations.map((o) => o.key)).toContain('spray');
    expect(sprayed.operations.map((o) => o.key)).not.toContain('install');
  });

  it('shared primitives are identical wherever they appear', () => {
    const seen = new Map<string, string>();
    for (const s of STARTER_TEMPLATES) {
      for (const wc of Object.values(s.catalog.workCenters)) {
        const json = JSON.stringify(wc);
        const before = seen.get(`wc:${wc.name}`);
        if (before) expect(json).toBe(before);
        seen.set(`wc:${wc.name}`, json);
      }
      for (const m of Object.values(s.catalog.materials)) {
        const json = JSON.stringify(m);
        const before = seen.get(`m:${m.sku}`);
        if (before) expect(json).toBe(before);
        seen.set(`m:${m.sku}`, json);
      }
    }
  });

  it('every starter passes the template schema once ids are swapped for uuids', () => {
    const uuid = '00000000-0000-4000-8000-000000000000';
    for (const s of STARTER_TEMPLATES) {
      const { template } = s;
      const parsed = createProductTemplateSchema.safeParse({
        templateKey: s.key,
        name: template.name,
        description: template.description,
        currency: template.currency,
        blankPreview: template.blankPreview ?? null,
        parameters: template.parameters,
        derived: template.derived ?? [],
        materials: template.materials.map((m) => ({ ...m, materialId: uuid })),
        operations: template.operations.map((o) => ({ ...o, workCenterId: uuid })),
        tooling: (template.tooling ?? []).map((t) => ({ ...t, toolingId: uuid })),
        pricing: template.pricing,
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
