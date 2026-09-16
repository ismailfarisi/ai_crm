import { PERMISSIONS, type Permission, type QuoteLineItem } from '@saas/shared';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CostingService, type ResolvedLines } from './costing.service';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { CatalogItem } from './entities/catalog-item.entity';
import type { ProductTemplate } from './entities/product-template.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';

function actor(permissions: Permission[]): AuthenticatedUser {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    organizationId: tenantId,
    email: 'rep@example.com',
    firstName: 'Sam',
    lastName: 'Rep',
    roles: ['member'],
    level: 30,
    permissions,
    isOwner: false,
    teamId: null,
    managerId: null,
  };
}

const WITH_COST = actor([
  PERMISSIONS.CATALOG_READ,
  PERMISSIONS.QUOTE_VIEW_COST,
]);
const WITHOUT_COST = actor([PERMISSIONS.CATALOG_READ]);

const COSTED_LINE: QuoteLineItem = {
  id: 'line_1',
  type: 'product',
  description: 'Rigid gift box (200 × 150 × 80mm, matt)',
  quantity: 500,
  uom: 'Units',
  unitPrice: 3.7,
  discount: 0,
  taxRate: 0,
  subtotal: 1850,
  templateId: 'template-1',
  templateVersion: 3,
  cost: {
    unitCost: 2.3993,
    totalCost: 1199.67,
    source: 'COMPUTED',
    materialCost: 451.53,
    machineCost: 141.23,
    laborCost: 298.37,
    toolingCost: 180,
    overheadCost: 128.54,
  },
};

const RESOLVED: ResolvedLines = {
  lines: [COSTED_LINE],
  totals: {
    subtotalAmount: 1850,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 1850,
    costAmount: 1199.67,
    marginAmount: 650.33,
    marginPct: 0.3515,
    hasCompleteCost: true,
  },
  warnings: [],
  leadTimeDays: 1,
  violations: [],
};

describe('CatalogController', () => {
  let controller: CatalogController;
  let catalogService: jest.Mocked<Partial<CatalogService>>;
  let costingService: jest.Mocked<Partial<CostingService>>;

  beforeEach(() => {
    catalogService = {
      searchItems: jest.fn().mockResolvedValue([]),
      findItem: jest.fn(),
      listTemplates: jest.fn().mockResolvedValue([]),
      findTemplate: jest.fn(),
    };
    costingService = {
      resolveLines: jest.fn().mockResolvedValue(RESOLVED),
      priceBreaks: jest.fn().mockResolvedValue({
        templateId: 'template-1',
        templateVersion: 3,
        breaks: [
          {
            quantity: 100,
            unitPrice: 8.25,
            totalPrice: 825,
            unitCost: 5.35,
            marginPct: 0.351,
          },
          {
            quantity: 500,
            unitPrice: 3.7,
            totalPrice: 1850,
            unitCost: 2.4,
            marginPct: 0.351,
          },
        ],
        warnings: [],
        leadTimeDays: 1,
      }),
    };

    controller = new CatalogController(
      catalogService as CatalogService,
      costingService as CostingService,
    );
  });

  const resolvePayload = {
    lines: [
      {
        kind: 'TEMPLATE' as const,
        templateId: '22222222-2222-2222-2222-222222222222',
        quantity: 500,
        parameters: {},
        toolingAlreadyOwned: [],
        discount: 0,
      },
    ],
  };

  /**
   * Hiding cost in React is not hiding it — without `quote:view_cost` the
   * numbers must not be on the wire at all.
   */
  describe('cost stripping', () => {
    it('returns the full breakdown to an actor with quote:view_cost', async () => {
      const result = await controller.resolveLines(WITH_COST, resolvePayload);

      expect(result.lines[0].cost?.unitCost).toBe(2.3993);
      expect(result.totals.costAmount).toBe(1199.67);
      expect(result.totals.marginPct).toBe(0.3515);
    });

    it('omits the cost object entirely without the permission', async () => {
      const result = await controller.resolveLines(
        WITHOUT_COST,
        resolvePayload,
      );

      expect(result.lines[0]).not.toHaveProperty('cost');
      expect(JSON.stringify(result)).not.toContain('1199.67');
      expect(JSON.stringify(result)).not.toContain('451.53');
    });

    it('still returns the price, so a rep can quote without seeing margin', async () => {
      const result = await controller.resolveLines(
        WITHOUT_COST,
        resolvePayload,
      );

      expect(result.lines[0].unitPrice).toBe(3.7);
      expect(result.lines[0].subtotal).toBe(1850);
      expect(result.totals.totalAmount).toBe(1850);
      expect(result.leadTimeDays).toBe(1);
    });

    it('zeroes margin rather than reporting a false 100%', async () => {
      const result = await controller.resolveLines(
        WITHOUT_COST,
        resolvePayload,
      );

      // costAmount 0 with a real subtotal would otherwise read as 100% margin.
      expect(result.totals.costAmount).toBe(0);
      expect(result.totals.marginAmount).toBe(0);
      expect(result.totals.marginPct).toBe(0);
      expect(result.totals.hasCompleteCost).toBe(false);
    });

    it('strips unit cost and margin from price breaks', async () => {
      const allowed = await controller.priceBreaks(WITH_COST, 'template-1', {
        parameters: {},
        quantities: [100, 500],
        toolingAlreadyOwned: [],
      });
      const denied = await controller.priceBreaks(WITHOUT_COST, 'template-1', {
        parameters: {},
        quantities: [100, 500],
        toolingAlreadyOwned: [],
      });

      expect(allowed.breaks[0].unitCost).toBe(5.35);
      expect(denied.breaks[0].unitCost).toBe(0);
      expect(denied.breaks[0].marginPct).toBe(0);
      // The price the customer sees is unchanged.
      expect(denied.breaks[0].unitPrice).toBe(8.25);
      expect(denied.breaks[1].unitPrice).toBe(3.7);
    });

    it('strips standard cost from catalog item lookups', async () => {
      const item = {
        id: 'item-1',
        sku: 'BOX-1',
        name: 'Small mailer',
        listPrice: 1.4,
        standardCost: 0.82,
      } as CatalogItem;
      catalogService.searchItems = jest.fn().mockResolvedValue([item]);

      const allowed = await controller.searchItems(WITH_COST, {
        limit: 25,
        includeInactive: false,
      });
      const denied = await controller.searchItems(WITHOUT_COST, {
        limit: 25,
        includeInactive: false,
      });

      expect(allowed[0].standardCost).toBe(0.82);
      expect(denied[0].standardCost).toBe(0);
      expect(denied[0].listPrice).toBe(1.4);
    });

    /**
     * A bill of materials and a routing reverse straight back into the cost
     * base — sheet counts times sheet price, machine minutes times machine
     * rate. Returning them to someone denied cost would leak it wholesale.
     */
    it('strips the bill of materials and routing from templates', async () => {
      const template = {
        id: 'template-1',
        name: 'Rigid box',
        parameters: [{ key: 'width_mm' }],
        materials: [{ key: 'board', materialId: 'm1' }],
        operations: [{ key: 'diecut', workCenterId: 'w1' }],
        tooling: [{ key: 'die', toolingId: 't1' }],
        pricing: { method: 'MARGIN', rate: 0.35, overheadPct: 0.12 },
      } as unknown as ProductTemplate;
      catalogService.findTemplate = jest.fn().mockResolvedValue(template);

      const allowed = await controller.findTemplate(WITH_COST, 'template-1');
      const denied = await controller.findTemplate(WITHOUT_COST, 'template-1');

      expect(allowed.materials).toHaveLength(1);
      expect(allowed.pricing.rate).toBe(0.35);

      expect(denied.materials).toEqual([]);
      expect(denied.operations).toEqual([]);
      expect(denied.tooling).toEqual([]);
      expect(denied.pricing.rate).toBe(0);
      // The parameters stay — they are what the picker form needs.
      expect(denied.parameters).toHaveLength(1);
    });
  });

  it('passes the caller tenant to the services, never a client-supplied one', async () => {
    await controller.resolveLines(WITH_COST, resolvePayload);
    expect(costingService.resolveLines).toHaveBeenCalledWith(
      tenantId,
      resolvePayload,
    );
  });
});
