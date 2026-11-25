import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  PERMISSIONS,
  RIGID_BOX_TEMPLATE,
  type QuoteLineItem,
  type ResolveLinesPayload,
} from '@saas/shared';
import { CostingService } from './costing.service';
import { CatalogItem } from './entities/catalog-item.entity';
import { CostingPolicy } from './entities/costing-policy.entity';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';
const otherTenantId = '99999999-9999-9999-9999-999999999999';
const templateId = '22222222-2222-2222-2222-222222222222';
const itemId = '33333333-3333-3333-3333-333333333333';

/**
 * The sample catalog from `@saas/shared` uses slug ids; the database uses
 * uuids. Map the slugs onto uuids so the template's material/work-centre
 * references still resolve.
 */
const uuidFor = (slug: string): string => {
  const map: Record<string, string> = {
    'greyboard-2mm': '10000000-0000-0000-0000-000000000001',
    'artpaper-157': '10000000-0000-0000-0000-000000000002',
    'glue-pva': '10000000-0000-0000-0000-000000000003',
    'magnet-10mm': '10000000-0000-0000-0000-000000000004',
    'ribbon-25mm': '10000000-0000-0000-0000-000000000005',
    'press-offset': '20000000-0000-0000-0000-000000000001',
    laminator: '20000000-0000-0000-0000-000000000002',
    diecutter: '20000000-0000-0000-0000-000000000003',
    'wrap-bench': '20000000-0000-0000-0000-000000000004',
    assembly: '20000000-0000-0000-0000-000000000005',
    'qc-pack': '20000000-0000-0000-0000-000000000006',
    'cutting-die': '30000000-0000-0000-0000-000000000001',
  };
  return map[slug] ?? slug;
};

const SAMPLE = RIGID_BOX_TEMPLATE;

function materialRows(): Material[] {
  return [
    {
      id: uuidFor('greyboard-2mm'),
      tenantId,
      sku: 'GB-2.0',
      name: 'Greyboard 2.0mm',
      uom: 'SHEET',
      costPerUom: 1.85,
      sheetWidthMm: 1000,
      sheetHeightMm: 700,
      grain: 'NONE',
      wastePct: 0.03,
      isActive: true,
    },
    {
      id: uuidFor('artpaper-157'),
      tenantId,
      sku: 'AP-157',
      name: 'Art paper 157gsm',
      uom: 'SHEET',
      costPerUom: 0.42,
      sheetWidthMm: 720,
      sheetHeightMm: 1020,
      grain: 'LENGTH',
      wastePct: 0.05,
      isActive: true,
    },
    {
      id: uuidFor('glue-pva'),
      tenantId,
      name: 'PVA adhesive',
      uom: 'KG',
      costPerUom: 4.2,
      sheetWidthMm: null,
      sheetHeightMm: null,
      grain: 'NONE',
      wastePct: 0,
      isActive: true,
    },
    {
      id: uuidFor('magnet-10mm'),
      tenantId,
      name: 'Magnet 10mm',
      uom: 'EACH',
      costPerUom: 0.09,
      sheetWidthMm: null,
      sheetHeightMm: null,
      grain: 'NONE',
      wastePct: 0,
      isActive: true,
    },
    {
      id: uuidFor('ribbon-25mm'),
      tenantId,
      name: 'Satin ribbon 25mm',
      uom: 'METRE',
      costPerUom: 0.35,
      sheetWidthMm: null,
      sheetHeightMm: null,
      grain: 'NONE',
      wastePct: 0.08,
      isActive: true,
    },
  ] as Material[];
}

function workCenterRows(): WorkCenter[] {
  return Object.values(SAMPLE_WORK_CENTERS).map(
    (wc) =>
      ({ ...wc, id: uuidFor(wc.id), tenantId, isActive: true }) as WorkCenter,
  );
}

const SAMPLE_WORK_CENTERS = {
  'press-offset': {
    id: 'press-offset',
    name: 'Offset press',
    setupMinutes: 45,
    machineCostPerHour: 85,
    laborCostPerHour: 22,
    scrapPct: 0.02,
    minChargeMinutes: 30,
    dailyCapacityMinutes: 480,
  },
  laminator: {
    id: 'laminator',
    name: 'Laminator',
    setupMinutes: 20,
    machineCostPerHour: 40,
    laborCostPerHour: 18,
    scrapPct: 0,
    minChargeMinutes: 20,
    dailyCapacityMinutes: 480,
  },
  diecutter: {
    id: 'diecutter',
    name: 'Die-cutter',
    setupMinutes: 35,
    machineCostPerHour: 55,
    laborCostPerHour: 20,
    scrapPct: 0.03,
    minChargeMinutes: 30,
    dailyCapacityMinutes: 480,
  },
  'wrap-bench': {
    id: 'wrap-bench',
    name: 'Wrapping bench',
    setupMinutes: 10,
    machineCostPerHour: 0,
    laborCostPerHour: 16,
    scrapPct: 0,
    minChargeMinutes: 0,
    dailyCapacityMinutes: 1920,
  },
  assembly: {
    id: 'assembly',
    name: 'Assembly',
    setupMinutes: 5,
    machineCostPerHour: 0,
    laborCostPerHour: 15,
    scrapPct: 0,
    minChargeMinutes: 0,
    dailyCapacityMinutes: 960,
  },
  'qc-pack': {
    id: 'qc-pack',
    name: 'QC and packing',
    setupMinutes: 5,
    machineCostPerHour: 0,
    laborCostPerHour: 14,
    scrapPct: 0,
    minChargeMinutes: 0,
    dailyCapacityMinutes: 960,
  },
};

function templateRow(): ProductTemplate {
  return {
    id: templateId,
    tenantId,
    templateKey: SAMPLE.id,
    version: 3,
    isCurrent: true,
    name: SAMPLE.name,
    description: SAMPLE.description ?? null,
    currency: 'USD',
    parameters: SAMPLE.parameters,
    derived: SAMPLE.derived ?? [],
    materials: SAMPLE.materials.map((line) => ({
      ...line,
      materialId: uuidFor(line.materialId),
    })),
    operations: SAMPLE.operations.map((line) => ({
      ...line,
      workCenterId: uuidFor(line.workCenterId),
    })),
    tooling: (SAMPLE.tooling ?? []).map((line) => ({
      ...line,
      toolingId: uuidFor(line.toolingId),
    })),
    pricing: SAMPLE.pricing,
    createdById: null,
  } as ProductTemplate;
}

const BOX_PARAMS = {
  length_mm: 200,
  width_mm: 150,
  height_mm: 80,
  finish: 'matt',
};

describe('CostingService', () => {
  let service: CostingService;
  let materials: jest.Mocked<Partial<Repository<Material>>>;
  let workCenters: jest.Mocked<Partial<Repository<WorkCenter>>>;
  let tooling: jest.Mocked<Partial<Repository<Tooling>>>;
  let items: jest.Mocked<Partial<Repository<CatalogItem>>>;
  let templates: jest.Mocked<Partial<Repository<ProductTemplate>>>;
  let policies: jest.Mocked<Partial<Repository<CostingPolicy>>>;

  beforeEach(() => {
    materials = { find: jest.fn().mockResolvedValue(materialRows()) };
    workCenters = { find: jest.fn().mockResolvedValue(workCenterRows()) };
    tooling = {
      find: jest.fn().mockResolvedValue([
        {
          id: uuidFor('cutting-die'),
          tenantId,
          name: 'Cutting die',
          cost: 180,
          amortize: true,
          reusable: true,
          isActive: true,
        } as Tooling,
      ]),
    };
    items = { findOne: jest.fn().mockResolvedValue(null) };
    templates = {
      findOne: jest.fn().mockResolvedValue(templateRow()),
      find: jest.fn().mockResolvedValue([]),
    };
    // No row means the shared defaults, which have enforcement off.
    policies = { findOne: jest.fn().mockResolvedValue(null) };

    service = new CostingService(
      materials as Repository<Material>,
      workCenters as Repository<WorkCenter>,
      tooling as Repository<Tooling>,
      items as Repository<CatalogItem>,
      templates as Repository<ProductTemplate>,
      policies as Repository<CostingPolicy>,
    );
  });

  const resolve = (payload: ResolveLinesPayload) =>
    service.resolveLines(tenantId, payload);

  describe('template lines', () => {
    it('produces a priced line with a full cost breakdown', async () => {
      const result = await resolve({
        lines: [
          {
            kind: 'TEMPLATE',
            templateId,
            quantity: 500,
            parameters: BOX_PARAMS,
            toolingAlreadyOwned: [],
            discount: 0,
          },
        ],
      });

      expect(result.lines).toHaveLength(1);
      const [line] = result.lines;

      expect(line.type).toBe('product');
      expect(line.quantity).toBe(500);
      expect(line.unitPrice).toBeGreaterThan(2);
      expect(line.unitPrice).toBeLessThan(8);
      expect(line.cost?.source).toBe('COMPUTED');
      expect(line.cost?.materialCost).toBeGreaterThan(0);
      expect(line.cost?.laborCost).toBeGreaterThan(0);
      expect(line.cost?.toolingCost).toBe(180);
    });

    it('pins the template version onto the line so it can be re-costed later', async () => {
      const result = await resolve({
        lines: [
          {
            kind: 'TEMPLATE',
            templateId,
            quantity: 500,
            parameters: BOX_PARAMS,
            toolingAlreadyOwned: [],
            discount: 0,
          },
        ],
      });

      const [line] = result.lines;
      expect(line.templateId).toBe(templateId);
      expect(line.templateVersion).toBe(3);
      expect(line.parameters).toMatchObject(BOX_PARAMS);
      // Defaults are resolved and snapshotted too, not just what was sent.
      expect(line.parameters?.board_thickness_mm).toBe(2);
    });

    it('writes a readable description from the parameters', async () => {
      const result = await resolve({
        lines: [
          {
            kind: 'TEMPLATE',
            templateId,
            quantity: 500,
            parameters: BOX_PARAMS,
            toolingAlreadyOwned: [],
            discount: 0,
          },
        ],
      });

      expect(result.lines[0].description).toContain('200 × 150 × 80mm');
      expect(result.lines[0].description).toContain('matt');
    });

    it('does not charge for a die the customer already owns', async () => {
      const line = {
        kind: 'TEMPLATE' as const,
        templateId,
        quantity: 500,
        parameters: BOX_PARAMS,
        discount: 0,
      };

      const first = await resolve({
        lines: [{ ...line, toolingAlreadyOwned: [] }],
      });
      const repeat = await resolve({
        lines: [{ ...line, toolingAlreadyOwned: [uuidFor('cutting-die')] }],
      });

      expect(repeat.lines[0].cost?.toolingCost).toBe(0);
      expect(repeat.lines[0].unitPrice).toBeLessThan(first.lines[0].unitPrice!);
    });

    it('applies a line discount to the subtotal but not to the cost', async () => {
      const result = await resolve({
        lines: [
          {
            kind: 'TEMPLATE',
            templateId,
            quantity: 500,
            parameters: BOX_PARAMS,
            toolingAlreadyOwned: [],
            discount: 10,
          },
        ],
      });

      const [line] = result.lines;
      const gross = line.unitPrice! * 500;
      expect(line.subtotal).toBeCloseTo(gross * 0.9, 1);
      // Discounting the customer does not make the job cheaper to produce.
      expect(line.cost!.totalCost).toBeGreaterThan(0);
      expect(result.totals.marginPct).toBeLessThan(0.35);
    });

    it('reports the lead time in working days', async () => {
      const result = await resolve({
        lines: [
          {
            kind: 'TEMPLATE',
            templateId,
            quantity: 2500,
            parameters: BOX_PARAMS,
            toolingAlreadyOwned: [],
            discount: 0,
          },
        ],
      });

      expect(result.leadTimeDays).toBeGreaterThan(1);
    });
  });

  describe('catalog item lines', () => {
    beforeEach(() => {
      items.findOne = jest.fn().mockResolvedValue({
        id: itemId,
        tenantId,
        sku: 'BOX-MAILER-S',
        name: 'Small mailer box',
        description: null,
        uom: 'Units',
        listPrice: 1.4,
        standardCost: 0.82,
        taxRate: 5,
        leadTimeDays: 7,
        isActive: true,
      });
    });

    it('snapshots the standing price and cost', async () => {
      const result = await resolve({
        lines: [
          {
            kind: 'CATALOG_ITEM',
            catalogItemId: itemId,
            quantity: 1000,
            discount: 0,
          },
        ],
      });

      const [line] = result.lines;
      expect(line.sku).toBe('BOX-MAILER-S');
      expect(line.unitPrice).toBe(1.4);
      expect(line.taxRate).toBe(5);
      expect(line.leadTimeDays).toBe(7);
      expect(line.cost).toEqual({
        unitCost: 0.82,
        totalCost: 820,
        source: 'STANDARD',
      });
    });

    it('rolls several lines into one set of totals', async () => {
      const result = await resolve({
        lines: [
          {
            kind: 'CATALOG_ITEM',
            catalogItemId: itemId,
            quantity: 1000,
            discount: 0,
          },
          {
            kind: 'TEMPLATE',
            templateId,
            quantity: 500,
            parameters: BOX_PARAMS,
            toolingAlreadyOwned: [],
            discount: 0,
          },
        ],
      });

      expect(result.lines).toHaveLength(2);
      expect(result.totals.hasCompleteCost).toBe(true);
      expect(result.totals.costAmount).toBeGreaterThan(0);
      expect(result.totals.marginAmount).toBe(
        Number(
          (result.totals.subtotalAmount - result.totals.costAmount).toFixed(2),
        ),
      );
    });
  });

  describe('failures reach the caller as 400s, not 500s', () => {
    it('rejects a blank too large for any sheet with the engine message', async () => {
      await expect(
        resolve({
          lines: [
            {
              kind: 'TEMPLATE',
              templateId,
              quantity: 500,
              parameters: {
                ...BOX_PARAMS,
                length_mm: 600,
                width_mm: 600,
                height_mm: 400,
              },
              toolingAlreadyOwned: [],
              discount: 0,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        resolve({
          lines: [
            {
              kind: 'TEMPLATE',
              templateId,
              quantity: 500,
              parameters: {
                ...BOX_PARAMS,
                length_mm: 600,
                width_mm: 600,
                height_mm: 400,
              },
              toolingAlreadyOwned: [],
              discount: 0,
            },
          ],
        }),
      ).rejects.toThrow(/does not fit on/);
    });

    it('rejects an out-of-range parameter', async () => {
      await expect(
        resolve({
          lines: [
            {
              kind: 'TEMPLATE',
              templateId,
              quantity: 500,
              parameters: { ...BOX_PARAMS, height_mm: 900 },
              toolingAlreadyOwned: [],
              discount: 0,
            },
          ],
        }),
      ).rejects.toThrow(/above the maximum/);
    });

    it('404s on a template that belongs to nobody', async () => {
      templates.findOne = jest.fn().mockResolvedValue(null);
      await expect(
        resolve({
          lines: [
            {
              kind: 'TEMPLATE',
              templateId,
              quantity: 500,
              parameters: BOX_PARAMS,
              toolingAlreadyOwned: [],
              discount: 0,
            },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('quick-costed typed lines', () => {
    // Quick costings are parsed, and the parser wants real (v4) uuids.
    const greyboard = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const assembly = '8f14e45f-ceea-467f-a0e6-7d5b4f8c9a11';
    beforeEach(() => {
      const swap = <T extends { id: string }>(
        rows: T[],
        from: string,
        to: string,
      ) => rows.map((row) => (row.id === from ? { ...row, id: to } : row));
      materials.find = jest
        .fn()
        .mockResolvedValue(
          swap(materialRows(), uuidFor('greyboard-2mm'), greyboard),
        );
      workCenters.find = jest
        .fn()
        .mockResolvedValue(
          swap(workCenterRows(), uuidFor('assembly'), assembly),
        );
    });
    const quickCost = {
      materials: [{ materialId: greyboard, quantity: 10 }],
      hours: [{ workCenterId: assembly, hours: 2, per: 'job' as const }],
      boughtIn: [{ description: 'Magnets', amount: 50, per: 'job' as const }],
      overheadPct: 0.2,
      costedForQuantity: 4,
    };
    const typedLine = (extra: Partial<QuoteLineItem> = {}): QuoteLineItem => ({
      id: 'line-1',
      type: 'product',
      description: 'Display box, one-off',
      quantity: 4,
      unitPrice: 40,
      discount: 0,
      taxRate: 5,
      subtotal: 160,
      ...extra,
    });

    it('keeps the cost on save, worked out again at catalog rates', async () => {
      const {
        items: [line],
        totals,
      } = await service.recostLines(tenantId, [
        typedLine({
          quickCost,
          // Whatever the browser claims is replaced.
          cost: { unitCost: 1, totalCost: 4, source: 'QUICK' },
        }),
      ]);

      // 10 sheets + 3% waste, bought whole: 11 × 1.85. 2h × 15. Magnets 50.
      expect(line.cost).toEqual({
        unitCost: 30.105,
        totalCost: 120.42,
        source: 'QUICK',
        materialCost: 20.35,
        machineCost: 0,
        laborCost: 30,
        boughtInCost: 50,
        overheadCost: 20.07,
      });
      expect(line.quickCost).toEqual(quickCost);
      expect(totals.hasCompleteCost).toBe(true);
    });

    it('still drops a cost the browser typed with no costing behind it', async () => {
      const {
        items: [line],
      } = await service.recostLines(tenantId, [
        typedLine({ cost: { unitCost: 1, totalCost: 4, source: 'MANUAL' } }),
      ]);
      expect(line.cost).toBeUndefined();
    });

    it('marks the line uncosted, keeping the inputs, once a material is removed', async () => {
      materials.find = jest.fn().mockResolvedValue([]);
      const {
        items: [line],
        staleLineIds,
      } = await service.recostLines(tenantId, [typedLine({ quickCost })]);
      expect(line.cost).toBeUndefined();
      expect(line.quickCost).toEqual(quickCost);
      expect(staleLineIds).toEqual(['line-1']);
    });

    it('rejects a malformed costing as a 400', async () => {
      await expect(
        service.recostLines(tenantId, [
          typedLine({
            quickCost: {
              ...quickCost,
              hours: [{ workCenterId: assembly, hours: -3 }],
            },
          }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps the margin floor meaningful for a quick-costed line', async () => {
      policies.findOne = jest.fn().mockResolvedValue({
        tenantId,
        minMarginPct: 0.3,
        maxDiscountPct: 20,
        requireKnownCost: true,
        enforce: true,
      });
      const { violations } = await service.recostLines(tenantId, [
        typedLine({ quickCost }),
      ]);
      expect(violations.map((v) => v.code)).toEqual(['MARGIN_BELOW_FLOOR']);
    });

    it('previews the cost, the margin and the price that keeps the floor', async () => {
      const preview = await service.previewQuickCost(tenantId, {
        quickCost,
        quantity: 4,
        unitPrice: 40,
        discount: 0,
      });
      expect(preview.breakdown.totalCost).toBe(120.42);
      expect(preview.marginAmount).toBe(39.58);
      expect(preview.marginPct).toBe(0.2474);
      expect(preview.targetMarginPct).toBe(0.2);
      expect(preview.suggestedUnitPrice).toBe(37.64);
    });

    it('turns a costing that adds up to nothing into a 400', async () => {
      await expect(
        service.previewQuickCost(tenantId, {
          quickCost: { ...quickCost, materials: [], hours: [], boughtIn: [] },
          quantity: 1,
          unitPrice: 10,
          discount: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('offers active materials and machines with their hourly rate', async () => {
      const options = await service.quickCostOptions(tenantId);
      expect(materials.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, isActive: true } }),
      );
      expect(
        options.workCenters.find((w) => w.id === assembly)?.ratePerHour,
      ).toBe(15);
      expect(options.defaultOverheadPct).toBe(0);
      expect(options.targetMarginPct).toBe(0.2);
    });
  });

  describe('tenant scoping', () => {
    it('scopes every catalog read to the caller tenant', async () => {
      await service.loadCostingCatalog(tenantId);

      expect(materials.find).toHaveBeenCalledWith({ where: { tenantId } });
      expect(workCenters.find).toHaveBeenCalledWith({ where: { tenantId } });
      expect(tooling.find).toHaveBeenCalledWith({ where: { tenantId } });
    });

    it('scopes the template lookup to the caller tenant', async () => {
      await resolve({
        lines: [
          {
            kind: 'TEMPLATE',
            templateId,
            quantity: 500,
            parameters: BOX_PARAMS,
            toolingAlreadyOwned: [],
            discount: 0,
          },
        ],
      });

      expect(templates.findOne).toHaveBeenCalledWith({
        where: { id: templateId, tenantId },
      });
      expect(templates.findOne).not.toHaveBeenCalledWith({
        where: { id: templateId, tenantId: otherTenantId },
      });
    });
  });

  describe('price breaks', () => {
    it('falls with quantity, because setup and tooling amortise', async () => {
      const result = await service.priceBreaks(tenantId, templateId, {
        parameters: BOX_PARAMS,
        quantities: [100, 500, 2500],
        toolingAlreadyOwned: [],
      });

      expect(result.templateVersion).toBe(3);
      expect(result.breaks.map((row) => row.quantity)).toEqual([
        100, 500, 2500,
      ]);
      expect(result.breaks[0].unitPrice).toBeGreaterThan(
        result.breaks[2].unitPrice,
      );
      expect(result.leadTimeDays).toBeGreaterThanOrEqual(1);
    });
  });

  it('exposes the cost permission the controller gates on', () => {
    // Guards the constant against a rename that would silently open cost up.
    expect(PERMISSIONS.QUOTE_VIEW_COST).toBe('quote:view_cost');
  });
  describe('shop-wide overhead rate', () => {
    const policyRow = (overrides: Partial<CostingPolicy> = {}) =>
      ({
        tenantId,
        minMarginPct: 0.2,
        maxDiscountPct: 20,
        requireKnownCost: false,
        enforce: false,
        defaultOverheadPct: 0.25,
        defaultOverheadSource: 'BOOKS',
        defaultOverheadSetAt: new Date('2026-11-01T00:00:00Z'),
        defaultOverheadBasis: null,
        overheadSuggestionHidden: false,
        ...overrides,
      }) as CostingPolicy;

    const withOverhead = (overheadPct: number | null) => {
      const row = templateRow();
      templates.findOne = jest.fn().mockResolvedValue({
        ...row,
        pricing: { ...row.pricing, overheadPct },
      });
    };

    it('costs a template with no rate of its own at the shop rate', async () => {
      policies.findOne = jest.fn().mockResolvedValue(policyRow());
      withOverhead(null);
      const { breakdown } = await service.breakdownForTemplate(
        tenantId,
        templateId,
        BOX_PARAMS,
        500,
      );
      expect(breakdown.overheadFrom).toBe('SHOP');
      expect(breakdown.overheadPct).toBe(0.25);
      expect(breakdown.overheadCost).toBeCloseTo(
        breakdown.directCost * 0.25,
        1,
      );
    });

    it('leaves a template with its own rate alone', async () => {
      policies.findOne = jest.fn().mockResolvedValue(policyRow());
      withOverhead(0.12);
      const { breakdown } = await service.breakdownForTemplate(
        tenantId,
        templateId,
        BOX_PARAMS,
        500,
      );
      expect(breakdown.overheadFrom).toBe('TEMPLATE');
      expect(breakdown.overheadPct).toBe(0.12);
    });

    it('adds no overhead before the shop rate is set', async () => {
      withOverhead(null);
      const { breakdown } = await service.breakdownForTemplate(
        tenantId,
        templateId,
        BOX_PARAMS,
        500,
      );
      expect(breakdown.overheadCost).toBe(0);
    });

    it('reports where the shop rate came from', async () => {
      policies.findOne = jest.fn().mockResolvedValue(policyRow());
      const policy = await service.getPolicy(tenantId);
      expect(policy.defaultOverheadPct).toBe(0.25);
      expect(policy.defaultOverhead).toMatchObject({
        source: 'BOOKS',
        setAt: '2026-11-01T00:00:00.000Z',
        suggestionHidden: false,
      });
    });

    it('marks a typed rate as typed and drops the old basis', async () => {
      const row = policyRow({
        defaultOverheadBasis: {
          from: '2026-05-01',
          to: '2026-10-31',
          months: [],
          overheadTotal: 1,
          directTotal: 4,
          excludedAccountCodes: [],
          currency: 'AED',
        },
      });
      policies.findOne = jest.fn().mockResolvedValue(row);
      policies.save = jest
        .fn()
        .mockImplementation(async (r) => r as CostingPolicy);
      const policy = await service.updatePolicy(tenantId, {
        defaultOverheadPct: 0.3,
      });
      expect(policy.defaultOverheadPct).toBe(0.3);
      expect(policy.defaultOverhead).toMatchObject({
        source: 'TYPED',
        basis: null,
      });
    });

    it('does not touch the rate when only the floors change', async () => {
      policies.findOne = jest.fn().mockResolvedValue(policyRow());
      policies.save = jest
        .fn()
        .mockImplementation(async (r) => r as CostingPolicy);
      const policy = await service.updatePolicy(tenantId, {
        minMarginPct: 0.3,
      });
      expect(policy.defaultOverhead?.source).toBe('BOOKS');
      expect(policy.minMarginPct).toBe(0.3);
    });
  });
});
