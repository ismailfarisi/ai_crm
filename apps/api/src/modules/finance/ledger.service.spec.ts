import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LEDGER_ROLES, SYSTEM_LEDGER_ACCOUNTS } from '@saas/shared';
import { LedgerService } from './ledger.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

interface Seed {
  accounts?: any[];
  financeAccounts?: any[];
  entries?: any[];
}

function makeService(seed: Seed = {}) {
  const accounts: any[] = seed.accounts ?? [];
  const financeAccounts: any[] = seed.financeAccounts ?? [];
  const entries: any[] = seed.entries ?? [];
  let seq = 0;

  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'type' in (v as any))
        return row[k] == null;
      return row[k] === v;
    });

  const accountRepo = {
    find: jest.fn(async ({ where }: any = {}) =>
      where ? accounts.filter((a) => matches(a, where)) : accounts,
    ),
    findOne: jest.fn(
      async ({ where }: any) => accounts.find((a) => matches(a, where)) ?? null,
    ),
    create: jest.fn((dto: any) => ({ id: `ledger-${++seq}`, ...dto })),
    save: jest.fn(async (a: any) => {
      const idx = accounts.findIndex((x) => x.id === a.id);
      if (idx >= 0) accounts[idx] = a;
      else accounts.push(a);
      return a;
    }),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => {
      const b: any = {
        where: () => b,
        andWhere: () => b,
        getMany: async () =>
          accounts.filter((a) => /^10\d+$/.test(a.code) && a.code !== '1000'),
      };
      return b;
    }),
  };

  const financeRepo = {
    findOne: jest.fn(
      async ({ where }: any) =>
        financeAccounts.find((a) => matches(a, where)) ?? null,
    ),
    update: jest.fn(async (criteria: any, patch: any) => {
      const row = financeAccounts.find((a) => a.id === criteria.id);
      if (row) Object.assign(row, patch);
      return { affected: 1 };
    }),
  };

  const journalRepo = { find: jest.fn(async () => entries) };

  const manager = {
    getRepository: jest.fn((entity: any) =>
      entity?.name === 'FinanceAccount' ? financeRepo : accountRepo,
    ),
  };
  const dataSource = { manager } as any;

  const service = new LedgerService(
    accountRepo as any,
    journalRepo as any,
    dataSource,
  );
  return { service, accounts, financeAccounts, accountRepo, financeRepo };
}

/** The chart as it stands after provisioning. */
const seededChart = () =>
  SYSTEM_LEDGER_ACCOUNTS.map((a, i) => ({
    id: `ledger-sys-${i}`,
    tenantId,
    code: a.code,
    name: a.name,
    type: a.type,
    role: a.role,
    isSystem: true,
    isActive: true,
    deletedAt: null,
  }));

describe('LedgerService', () => {
  describe('provisionChartOfAccounts', () => {
    it('creates every system account', async () => {
      const { service, accounts } = makeService();
      const created = await service.provisionChartOfAccounts(tenantId);

      expect(created).toHaveLength(SYSTEM_LEDGER_ACCOUNTS.length);
      expect(accounts.map((a) => a.code).sort()).toEqual(
        SYSTEM_LEDGER_ACCOUNTS.map((a) => a.code).sort(),
      );
    });

    it('is idempotent, so it is safe from both signup and a backfill', async () => {
      const { service, accounts } = makeService({ accounts: seededChart() });
      await service.provisionChartOfAccounts(tenantId);

      expect(accounts).toHaveLength(SYSTEM_LEDGER_ACCOUNTS.length);
    });

    it('gives every account a role that resolution can find', async () => {
      const { service } = makeService({ accounts: seededChart() });
      for (const role of Object.values(LEDGER_ROLES)) {
        await expect(service.byRole(tenantId, role)).resolves.toBeDefined();
      }
    });
  });

  describe('byRole', () => {
    it('refuses rather than guessing when the chart is missing an account', async () => {
      const { service } = makeService({ accounts: [] });
      await expect(
        service.byRole(tenantId, LEDGER_ROLES.SALES),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveLines', () => {
    const cash = {
      id: 'acc-1',
      tenantId,
      name: 'Operating Bank',
      ledgerAccountId: null as string | null,
    };

    it('resolves a role to its ledger account', async () => {
      const { service } = makeService({ accounts: seededChart() });

      const lines = await service.resolveLines(tenantId, [
        {
          role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
          accountName: 'Accounts Receivable',
          debit: 100,
          credit: 0,
          description: 'x',
        },
        {
          role: LEDGER_ROLES.SALES,
          accountName: 'Sales',
          debit: 0,
          credit: 100,
          description: 'x',
        },
      ]);

      expect(lines[0].ledgerAccountCode).toBe('1100');
      expect(lines[1].ledgerAccountCode).toBe('4000');
    });

    it('gives a cash account its own ledger account on first use', async () => {
      const { service, financeAccounts } = makeService({
        accounts: seededChart(),
        financeAccounts: [{ ...cash }],
      });

      const lines = await service.resolveLines(tenantId, [
        {
          financeAccountId: 'acc-1',
          accountName: 'Operating Bank',
          debit: 50,
          credit: 0,
          description: 'x',
        },
        {
          role: LEDGER_ROLES.SALES,
          accountName: 'Sales',
          debit: 0,
          credit: 50,
          description: 'x',
        },
      ]);

      // Numbered under the 1000 parent so a trial balance shows a figure per
      // bank rather than one pooled cash total.
      expect(lines[0].ledgerAccountCode).toBe('1001');
      expect(lines[0].financeAccountId).toBe('acc-1');
      expect(financeAccounts[0].ledgerAccountId).toBeTruthy();
    });

    it('maps the pre-ledger literal names, so old callers still post correctly', async () => {
      const { service } = makeService({ accounts: seededChart() });

      const lines = await service.resolveLines(tenantId, [
        {
          accountName: 'Accounts Payable',
          debit: 0,
          credit: 20,
          description: 'x',
        },
        {
          accountName: 'Accounts Receivable',
          debit: 20,
          credit: 0,
          description: 'x',
        },
      ]);

      expect(lines[0].ledgerAccountCode).toBe('2100');
      expect(lines[1].ledgerAccountCode).toBe('1100');
    });

    it('sends an unrecognised label to operating expense rather than failing', async () => {
      const { service } = makeService({ accounts: seededChart() });

      const lines = await service.resolveLines(tenantId, [
        { accountName: 'Travel', debit: 75, credit: 0, description: 'x' },
        {
          role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
          accountName: 'Accounts Payable',
          debit: 0,
          credit: 75,
          description: 'x',
        },
      ]);

      expect(lines[0].ledgerAccountCode).toBe('6000');
    });

    it('refuses an entry whose debits and credits differ', async () => {
      const { service } = makeService({ accounts: seededChart() });

      await expect(
        service.resolveLines(tenantId, [
          {
            role: LEDGER_ROLES.SALES,
            accountName: 'Sales',
            debit: 0,
            credit: 100,
            description: 'x',
          },
          {
            role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
            accountName: 'AR',
            debit: 99,
            credit: 0,
            description: 'x',
          },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an entry that balances only after cent rounding', async () => {
      const { service } = makeService({ accounts: seededChart() });

      const lines = await service.resolveLines(tenantId, [
        {
          role: LEDGER_ROLES.SALES,
          accountName: 'Sales',
          debit: 0,
          credit: 0.1 + 0.2,
          description: 'x',
        },
        {
          role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
          accountName: 'AR',
          debit: 0.3,
          credit: 0,
          description: 'x',
        },
      ]);

      expect(lines).toHaveLength(2);
    });

    it('rejects an unknown cash account instead of inventing one', async () => {
      const { service } = makeService({
        accounts: seededChart(),
        financeAccounts: [],
      });

      await expect(
        service.resolveLines(tenantId, [
          {
            financeAccountId: 'nope',
            accountName: 'Ghost',
            debit: 1,
            credit: 0,
            description: 'x',
          },
          {
            role: LEDGER_ROLES.SALES,
            accountName: 'Sales',
            debit: 0,
            credit: 1,
            description: 'x',
          },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('trialBalance', () => {
    it('balances, and signs each row by its normal balance', async () => {
      const chart = seededChart();
      const ar = chart.find((a) => a.code === '1100')!;
      const sales = chart.find((a) => a.code === '4000')!;

      const { service } = makeService({
        accounts: chart,
        entries: [
          {
            tenantId,
            lines: [
              { ledgerAccountId: ar.id, debit: 1200, credit: 0 },
              { ledgerAccountId: sales.id, debit: 0, credit: 1200 },
            ],
          },
        ],
      });

      const tb = await service.trialBalance(tenantId);

      expect(tb.difference).toBe(0);
      expect(tb.totalDebit).toBe(1200);
      expect(tb.totalCredit).toBe(1200);

      // Receivable is debit-normal and sales credit-normal, so both read
      // positive despite sitting on opposite sides.
      expect(tb.rows.find((r) => r.code === '1100')?.balance).toBe(1200);
      expect(tb.rows.find((r) => r.code === '4000')?.balance).toBe(1200);
    });

    it('omits accounts nothing has posted to', async () => {
      const { service } = makeService({ accounts: seededChart(), entries: [] });
      const tb = await service.trialBalance(tenantId);

      expect(tb.rows).toEqual([]);
      expect(tb.difference).toBe(0);
    });

    it('reports a non-zero difference when an unbalanced entry exists', async () => {
      const chart = seededChart();
      const ar = chart.find((a) => a.code === '1100')!;

      const { service } = makeService({
        accounts: chart,
        entries: [
          {
            tenantId,
            lines: [{ ledgerAccountId: ar.id, debit: 500, credit: 0 }],
          },
        ],
      });

      // resolveLines refuses to write one of these, but a bad migration or a
      // direct SQL edit could still produce it - the report has to show it
      // rather than quietly balancing.
      const tb = await service.trialBalance(tenantId);
      expect(tb.difference).toBe(500);
    });
  });

  describe('resolveLines in another currency', () => {
    it('converts to base and posts the rate difference to exchange gains and losses', async () => {
      // EUR 1,000 invoiced at 0.85, received when the euro is worth 0.87.
      const { service } = makeService({ accounts: seededChart() });
      const lines = await service.resolveLines(
        tenantId,
        [
          {
            role: LEDGER_ROLES.CASH,
            accountName: 'Bank',
            debit: 1000,
            credit: 0,
            fxRate: 0.87,
            description: 'Receipt',
          },
          {
            role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
            accountName: 'AR',
            debit: 0,
            credit: 1000,
            fxRate: 0.85,
            description: 'Receipt',
          },
        ],
        undefined,
        0.87,
      );
      expect(
        lines.map((l) => [l.ledgerAccountCode, l.debit, l.credit]),
      ).toEqual([
        ['1000', 870, 0],
        ['1100', 0, 850],
        ['7000', 0, 20],
      ]);
    });

    it('still refuses an entry that does not balance in its own currency', async () => {
      const { service } = makeService({ accounts: seededChart() });
      await expect(
        service.resolveLines(
          tenantId,
          [
            {
              role: LEDGER_ROLES.CASH,
              accountName: 'Bank',
              debit: 1000,
              credit: 0,
              fxRate: 0.87,
              description: 'x',
            },
            {
              role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
              accountName: 'AR',
              debit: 0,
              credit: 999,
              fxRate: 0.85,
              description: 'x',
            },
          ],
          undefined,
          0.87,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('adds nothing when everything is already in base currency', async () => {
      const { service } = makeService({ accounts: seededChart() });
      const lines = await service.resolveLines(tenantId, [
        {
          role: LEDGER_ROLES.CASH,
          accountName: 'Bank',
          debit: 10,
          credit: 0,
          description: 'x',
        },
        {
          role: LEDGER_ROLES.SALES,
          accountName: 'Sales',
          debit: 0,
          credit: 10,
          description: 'x',
        },
      ]);
      expect(lines).toHaveLength(2);
    });
  });
});
