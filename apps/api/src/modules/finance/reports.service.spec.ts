import { ReportsService } from './reports.service';

describe('ReportsService.profitAndLoss', () => {
  const tenantId = 't1';
  const ledger = { list: jest.fn() };
  const journal = {
    find: jest.fn(),
    manager: {
      getRepository: () => ({
        findOne: () => Promise.resolve({ baseCurrency: 'USD' }),
      }),
    },
  };
  const service = new ReportsService(
    journal as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    ledger as never,
  );

  it('carries the parent account on each statement line', async () => {
    ledger.list.mockResolvedValue([
      {
        id: 'p',
        code: '6000',
        name: 'Other operating expense',
        type: 'EXPENSE',
        parentId: null,
      },
      {
        id: 'c',
        code: '6100',
        name: 'Rent & premises',
        type: 'EXPENSE',
        parentId: 'p',
      },
    ]);
    journal.find.mockResolvedValue([
      {
        lines: [
          { ledgerAccountId: 'c', debit: 100, credit: 0 },
          { ledgerAccountId: 'p', debit: 5, credit: 0 },
        ],
      },
    ]);
    const pl = await service.profitAndLoss(
      tenantId,
      new Date('2026-01-01'),
      new Date('2026-12-31'),
    );
    expect(pl.expenses.find((l) => l.code === '6100')!.parentId).toBe('p');
    expect(pl.expenses.find((l) => l.code === '6000')!.parentId).toBeNull();
  });

  it('keeps a zero parent that has a non-zero child', async () => {
    ledger.list.mockResolvedValue([
      { id: 'p', code: '6000', name: 'Other operating expense', type: 'EXPENSE', parentId: null },
      { id: 'c', code: '6100', name: 'Rent & premises', type: 'EXPENSE', parentId: 'p' },
      { id: 'z', code: '6200', name: 'Unused', type: 'EXPENSE', parentId: null },
    ]);
    journal.find.mockResolvedValue([{ lines: [{ ledgerAccountId: 'c', debit: 100, credit: 0 }] }]);
    const pl = await service.profitAndLoss(tenantId, new Date('2026-01-01'), new Date('2026-12-31'));
    expect(pl.expenses.map((l) => l.code)).toEqual(['6000', '6100']);
    expect(pl.expenses.find((l) => l.code === '6000')!.amount).toBe(0);
    expect(pl.totalExpenses).toBe(100);
  });
});
