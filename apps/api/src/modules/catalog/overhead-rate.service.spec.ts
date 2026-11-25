import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { JournalEntry } from '../finance/entities/journal-entry.entity';
import type { LedgerAccount } from '../finance/entities/ledger-account.entity';
import type { CostingService } from './costing.service';
import type { ProductTemplate } from './entities/product-template.entity';
import { classifyAccounts, OverheadRateService } from './overhead-rate.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const TODAY = new Date('2026-11-25T10:00:00Z');

const account = (
  id: string,
  code: string,
  name: string,
  role: string | null,
  parentId: string | null = null,
) => ({ id, code, name, role, parentId }) as LedgerAccount;

const LEDGER = [
  account('cogs', '5000', 'Cost of goods sold', 'COGS'),
  account('freight', '5100', 'Freight in', null, 'cogs'),
  account('opex', '6000', 'Other operating expense', 'OPERATING_EXPENSE'),
  account('rent', '6100', 'Rent & premises', 'RENT', 'opex'),
  account('salaries', '6300', 'Salaries & wages', 'SALARIES', 'opex'),
  account('absorbed', '6390', 'Labour absorbed', 'LABOUR_ABSORBED', 'salaries'),
  account('custom', '8800', 'Workshop consumables', null, 'opex'),
  account('fx', '7000', 'Exchange gains and losses', 'FX_GAIN_LOSS'),
];

describe('classifyAccounts', () => {
  const classified = classifyAccounts(LEDGER);

  it('treats cost of sales and accounts filed under it as direct cost', () => {
    expect(classified.get('cogs')?.kind).toBe('DIRECT');
    expect(classified.get('freight')?.kind).toBe('DIRECT');
  });

  it('treats operating expenses, including labour absorbed and accounts filed under them, as overhead', () => {
    expect(classified.get('rent')?.kind).toBe('OVERHEAD');
    expect(classified.get('absorbed')?.kind).toBe('OVERHEAD');
    expect(classified.get('custom')?.kind).toBe('OVERHEAD');
  });

  it('leaves out exchange differences', () => {
    expect(classified.has('fx')).toBe(false);
  });
});

describe('OverheadRateService', () => {
  const months = ['2026-08', '2026-09', '2026-10'];
  let journalQuery: jest.Mock;
  let firstPosting: string | null;
  let saved: unknown;

  const build = () => {
    const journal = {
      query: journalQuery,
      createQueryBuilder: () => ({
        select: function () {
          return this;
        },
        where: function () {
          return this;
        },
        getRawOne: async () => ({ first: firstPosting }),
      }),
      manager: {
        getRepository: () => ({
          findOne: async () => ({ id: tenantId, baseCurrency: 'AED' }),
        }),
      },
    } as unknown as Repository<JournalEntry>;
    const accounts = {
      find: jest.fn().mockResolvedValue(LEDGER),
    } as unknown as Repository<LedgerAccount>;
    const templates = {
      find: jest.fn().mockResolvedValue([
        { id: 't1', name: 'Rigid box', pricing: { overheadPct: null } },
        { id: 't2', name: 'Folding carton', pricing: { overheadPct: 0.12 } },
      ]),
    } as unknown as Repository<ProductTemplate>;
    const costing = {
      getPolicy: jest.fn().mockResolvedValue({ defaultOverheadPct: 0 }),
      setOverheadFromBooks: jest
        .fn()
        .mockImplementation(async (_t, pct, basis) => {
          saved = { pct, basis };
          return { defaultOverheadPct: pct };
        }),
    } as unknown as CostingService;
    return new OverheadRateService(journal, accounts, templates, costing);
  };

  beforeEach(() => {
    saved = undefined;
    firstPosting = '2025-01-01T00:00:00Z';
    journalQuery = jest.fn().mockResolvedValue(
      months.flatMap((month) => [
        { accountId: 'rent', month, amount: '10000.00' },
        { accountId: 'salaries', month, amount: '30000.00' },
        { accountId: 'absorbed', month, amount: '-25000.00' },
        { accountId: 'cogs', month, amount: '60000.00' },
      ]),
    );
  });

  it('scopes the ledger read to the tenant and the full months asked for', async () => {
    await build().suggest(tenantId, 3, [], TODAY);
    const [, params] = journalQuery.mock.calls[0];
    expect(params[0]).toBe(tenantId);
    expect((params[1] as Date).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect((params[2] as Date).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('explains the suggestion with totals, months and the templates it would change', async () => {
    const s = await build().suggest(tenantId, 3, [], TODAY);
    // (10k + 30k − 25k) × 3 = 45k over 180k.
    expect(s.status).toBe('READY');
    expect(s.overheadTotal).toBe(45_000);
    expect(s.directTotal).toBe(180_000);
    expect(s.suggestedPct).toBe(0.25);
    expect(s.monthsCounted).toEqual(months);
    expect(s.currency).toBe('AED');
    expect(s.templates.usingShopRate).toEqual([
      { id: 't1', name: 'Rigid box' },
    ]);
    expect(s.templates.ownRate).toEqual([
      { id: 't2', name: 'Folding carton', overheadPct: 0.12 },
    ]);
  });

  it('works the rate out again on accept and keeps the basis', async () => {
    await build().accept(tenantId, 3, [], TODAY);
    expect(saved).toEqual({
      pct: 0.25,
      basis: {
        from: '2026-08-01',
        to: '2026-10-31',
        months,
        overheadTotal: 45_000,
        directTotal: 180_000,
        excludedAccountCodes: [],
        currency: 'AED',
      },
    });
  });

  it('refuses to accept when the books are too new', async () => {
    firstPosting = '2026-09-15T00:00:00Z';
    await expect(build().accept(tenantId, 6, [], TODAY)).rejects.toThrow(
      BadRequestException,
    );
    expect(saved).toBeUndefined();
  });
});
