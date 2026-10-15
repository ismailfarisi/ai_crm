import { PrepaidService } from './prepaid.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

function setup(schedule: any, already: string[] = []) {
  const amortizations: any[] = already.map((m) => ({ scheduleId: schedule.id, month: m, amount: 10000 }));
  const entries: any[] = [];
  const manager = {
    getRepository: (e: any) => {
      if (e.name === 'PrepaidAmortization') return { find: async () => amortizations };
      if (e.name === 'JournalEntry') {
        return {
          create: (x: any) => x,
          save: async (x: any) => { const s = { id: `je-${entries.length + 1}`, ...x }; entries.push(s); return s; },
        };
      }
      if (e.name === 'PrepaidSchedule') return { save: async (x: any) => x, findOne: async () => schedule, find: async () => [schedule] };
      throw new Error(e.name);
    },
  };
  // A thrown transaction rolls back the entries it wrote.
  const dataSource = {
    manager,
    transaction: async (fn: any) => {
      const before = entries.length;
      try { return await fn(manager); } catch (e) { entries.length = before; throw e; }
    },
  };
  const store = {
    claim: jest.fn(async (_m: any, v: any) => {
      if (amortizations.some((a) => a.month === v.month)) return null;
      amortizations.push(v);
      return v;
    }),
  };
  const ledger = { resolveLines: jest.fn(async (_t: string, lines: any[]) => lines.map((l) => ({ ...l, ledgerAccountId: l.role, ledgerAccountCode: l.role }))) };
  const tenantContext = { runAsSystem: (fn: any) => fn(), runWithTenant: (_t: string, fn: any) => fn() };
  const service = new PrepaidService(dataSource as any, ledger as any, tenantContext as any, store as any);
  return { service, amortizations, entries, ledger, store };
}

const annual = { id: 's1', tenantId, billId: 'b1', billLineId: 'l1', expenseRole: 'RENT', totalBase: 120000, firstMonth: '2026-01-01', months: 12, status: 'ACTIVE' };

describe('PrepaidService', () => {
  it('releases every month that has arrived, each dated the 1st of its month', async () => {
    const { service, entries } = setup({ ...annual });
    await service.releaseSchedule({ ...annual } as any, '2026-03-16');
    expect(entries.map((e) => e.entryDate.toISOString().slice(0, 10))).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(entries[0].lines).toEqual([
      expect.objectContaining({ role: 'RENT', debit: 10000, credit: 0 }),
      expect.objectContaining({ role: 'PREPAID_EXPENSES', debit: 0, credit: 10000 }),
    ]);
    expect(entries[0].referenceType).toBe('PREPAID');
  });

  it('skips months already released', async () => {
    const { service, entries } = setup({ ...annual }, ['2026-01-01']);
    await service.releaseSchedule({ ...annual } as any, '2026-02-10');
    expect(entries).toHaveLength(1);
  });

  it('rolls back the entry when another run claims the month first', async () => {
    const sched = { ...annual };
    const { service, entries, store } = setup(sched);
    store.claim.mockResolvedValueOnce(null);
    await service.releaseSchedule(sched as any, '2026-01-20');
    expect(entries).toHaveLength(0);
  });

  it('completes after the last month, last month takes the remainder', async () => {
    const odd = { ...annual, totalBase: 1000, months: 3 };
    const sched = { ...odd };
    const { service, entries } = setup(sched);
    await service.releaseSchedule(sched as any, '2026-12-01');
    expect(entries.map((e) => e.totalAmount)).toEqual([333.33, 333.33, 333.34]);
    expect(sched.status).toBe('COMPLETED');
  });

  it('end early posts the unreleased remainder today and closes', async () => {
    const sched = { ...annual };
    const { service, entries } = setup(sched, ['2026-01-01', '2026-02-01']);
    const dto = await service.endEarly(tenantId, 's1', 'u1', '2026-03-05');
    expect(entries).toHaveLength(1);
    expect(entries[0].totalAmount).toBe(100000);
    expect(sched.status).toBe('ENDED_EARLY');
    expect(dto.releasedAmount).toBe(120000);
    expect(dto.remainingAmount).toBe(0);
  });
});
