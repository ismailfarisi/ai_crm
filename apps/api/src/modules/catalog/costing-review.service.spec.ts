import { FindOperator } from 'typeorm';
import { CostingReviewService } from './costing-review.service';

const TENANT = 'tenant-1';

function setup(jobs: unknown[] = []) {
  const workOrders = { find: jest.fn().mockResolvedValue(jobs) };
  const materialUses = {
    find: jest.fn().mockResolvedValue(
      ['a', 'b', 'c'].map((wo) => ({
        workOrderId: wo,
        materialId: 'm1',
        qtyPlanned: 105,
        qtyIssued: 120,
        qtyReturned: 8,
        valueIssued: 112 * 2.4,
        plannedWastePct: 0.05,
      })),
    ),
  };
  const operations = { find: jest.fn().mockResolvedValue([]) };
  const materials = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'm1',
        name: 'Kraft board',
        uom: 'SHEET',
        costPerUom: 2.4,
        wastePct: 0.05,
      },
    ]),
  };
  const workCenters = { find: jest.fn().mockResolvedValue([]) };
  const service = new CostingReviewService(
    workOrders as never,
    materialUses as never,
    operations as never,
    materials as never,
    workCenters as never,
  );
  return { service, workOrders, materialUses };
}

const jobs = ['a', 'b', 'c'].map((id) => ({
  id,
  woNumber: `WO-2026-000${id}`,
  estimatedCost: null,
  actualCost: null,
}));

describe('CostingReviewService', () => {
  it('reviews completed jobs in the window, netting returns off what was issued', async () => {
    const { service, workOrders } = setup(jobs);
    const r = await service.review(TENANT, 90);

    const where = workOrders.find.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: TENANT, status: 'COMPLETE' });
    expect(where.completedAt).toBeInstanceOf(FindOperator);
    expect(r.windowDays).toBe(90);

    // 120 issued − 8 returned = 112 against 100 needed: a 12% allowance.
    const waste = r.proposals.find((p) => p.kind === 'MATERIAL_WASTE');
    expect(waste).toMatchObject({
      proposed: 0.12,
      workOrderNumbers: ['WO-2026-000a', 'WO-2026-000b', 'WO-2026-000c'],
    });
  });

  it('does not query job lines when no job finished in the window', async () => {
    const { service, materialUses } = setup([]);
    const r = await service.review(TENANT, 30);
    expect(materialUses.find).not.toHaveBeenCalled();
    expect(r).toMatchObject({ jobs: 0, proposals: [], variancePct: null });
  });

  it('keeps the window within bounds', async () => {
    const { service } = setup([]);
    expect((await service.review(TENANT, 10_000)).windowDays).toBe(730);
    expect((await service.review(TENANT, 0)).windowDays).toBe(1);
  });
});
