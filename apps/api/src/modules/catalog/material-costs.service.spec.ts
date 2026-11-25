import { BadRequestException } from '@nestjs/common';
import { MaterialCostsService } from './material-costs.service';

const TENANT = 'tenant-1';

function setup(receiptRows: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'innerJoin',
    'leftJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'limit',
  ]) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(receiptRows);
  const materials = {
    find: jest
      .fn()
      .mockResolvedValue([
        { id: 'm1', name: 'Greyboard 2mm', uom: 'SHEET', costPerUom: '6.7900' },
      ]),
    manager: {},
  };
  const items = { find: jest.fn().mockResolvedValue([]) };
  const receiptLines = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
  const stock = {
    find: jest
      .fn()
      .mockResolvedValue([
        { materialId: 'm1', qtyOnHand: '200', avgUnitCost: '7.0500' },
      ]),
  };
  const supplierMaterials = { find: jest.fn().mockResolvedValue([]) };
  const suppliers = { find: jest.fn().mockResolvedValue([]) };
  const catalog = {
    updateMaterial: jest
      .fn()
      .mockImplementation((_t, id, patch) => ({ id, ...patch })),
    updateItem: jest.fn(),
  };
  const service = new MaterialCostsService(
    materials as never,
    items as never,
    receiptLines as never,
    stock as never,
    supplierMaterials as never,
    suppliers as never,
    catalog as never,
  );
  return { service, catalog };
}

const row = (over: Record<string, unknown> = {}) => ({
  materialId: 'm1',
  unitCost: '1.9500',
  fxRate: '3.672500',
  receivedAt: new Date('2026-11-20T08:00:00Z'),
  receiptNumber: 'GRN-0004',
  supplierName: 'Gulf Board',
  lineUom: 'SHEET',
  materialUom: 'SHEET',
  ...over,
});

describe('MaterialCostsService', () => {
  it('converts the last receipt to base currency and skips other-unit lines', async () => {
    const { service } = setup([row({ lineUom: 'KG', unitCost: '99' }), row()]);
    const review = await service.review(TENANT);
    const figure = review.rows[0].figures.find(
      (f) => f.basis === 'LAST_PURCHASE',
    );
    // 1.95 USD × 3.6725 = 7.161375 → 4dp.
    expect(figure?.unitCost).toBe(7.1614);
    expect(review.notes[0]).toMatch(
      /1 receipt line was ordered in a different unit/,
    );
  });

  it('applies a figure it worked out itself through the ordinary material update', async () => {
    const { service, catalog } = setup([row()]);
    await service.apply(TENANT, { type: 'MATERIAL', id: 'm1' }, 'AVERAGE');
    expect(catalog.updateMaterial).toHaveBeenCalledWith(TENANT, 'm1', {
      costPerUom: 7.05,
    });
  });

  it('refuses a figure that is not on offer', async () => {
    const { service } = setup([]);
    await expect(
      service.apply(TENANT, { type: 'MATERIAL', id: 'm1' }, 'SUPPLIER'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
