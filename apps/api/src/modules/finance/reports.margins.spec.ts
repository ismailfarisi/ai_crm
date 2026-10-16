import { ReportsService } from './reports.service';

const repo = (rows: object[]) => ({ find: jest.fn(async () => rows) });

function build(workOrders: object[]) {
  const journal = {
    manager: {
      getRepository: () => ({
        findOne: () => Promise.resolve({ baseCurrency: 'AED' }),
      }),
    },
  };
  return new ReportsService(
    journal as never,
    {} as never,
    repo([
      {
        id: 'inv-1',
        salesOrderId: 'so-1',
        status: 'ISSUED',
        subtotalAmount: 2000,
        fxRate: 1,
      },
    ]) as never,
    repo([]) as never,
    repo([
      {
        id: 'so-1',
        quoteId: 'q-1',
        customerId: 'c-1',
        customerName: 'Acme',
        status: 'CONFIRMED',
      },
    ]) as never,
    repo([
      { id: 'l-1', salesOrderId: 'so-1', quoteLineId: 'qi-1', lineTotal: 1000 },
      { id: 'l-2', salesOrderId: 'so-1', quoteLineId: 'qi-2', lineTotal: 1000 },
    ]) as never,
    repo(workOrders) as never,
    repo([
      {
        id: 'q-1',
        items: [
          { id: 'qi-1', cost: { totalCost: 1 } },
          { id: 'qi-2', cost: { totalCost: 1 } },
        ],
      },
    ]) as never,
    {} as never,
  );
}

describe('ReportsService.margins provisionalLabourShare', () => {
  const range = [new Date('2026-01-01'), new Date('2026-12-31')] as const;

  it('is the provisional labour over the cost of a group with one provisional and one actual job', async () => {
    const service = build([
      {
        salesOrderLineId: 'l-1',
        actualCost: { total: 500 },
        labourSplit: { actual: 300, provisional: 100, unlinked: 0 },
      },
      {
        salesOrderLineId: 'l-2',
        actualCost: { total: 300 },
        labourSplit: { actual: 200, provisional: 0, unlinked: 0 },
      },
    ]);
    const [row] = (await service.margins('t1', ...range, 'customer')).rows;
    expect(row.cost).toBe(800);
    expect(row.measuredCostShare).toBe(1);
    expect(row.provisionalLabourShare).toBe(0.125); // 100 / 800
  });

  it('rounds to three places and treats a job with no split as none', async () => {
    const service = build([
      {
        salesOrderLineId: 'l-1',
        actualCost: { total: 200 },
        labourSplit: { actual: 0, provisional: 100, unlinked: 0 },
      },
      { salesOrderLineId: 'l-2', actualCost: { total: 100 }, labourSplit: null },
    ]);
    const [row] = (await service.margins('t1', ...range, 'customer')).rows;
    expect(row.provisionalLabourShare).toBe(0.333); // 100 / 300
  });

  it('is 0 when the group has no cost', async () => {
    const service = build([]);
    const svc = service as unknown as { quotes: { find: jest.Mock } };
    svc.quotes.find.mockResolvedValue([
      { id: 'q-1', items: [{ id: 'qi-1' }, { id: 'qi-2' }] },
    ]);
    const [row] = (await service.margins('t1', ...range, 'customer')).rows;
    expect(row.cost).toBe(0);
    expect(row.provisionalLabourShare).toBe(0);
  });
});
