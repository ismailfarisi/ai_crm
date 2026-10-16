import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { LEDGER_ROLES, PERMISSIONS } from '@saas/shared';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { PensionRemittance } from './entities/pension-remittance.entity';
import { PensionRemittanceService } from './pension-remittance.service';

const T = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const BANK = '44444444-4444-4444-8444-444444444444';
const PAYER = { userId: USER, permissions: [PERMISSIONS.PAYROLL_PAY] };
const ADVISORY = 'pg_advisory_xact_lock';

function repo(rows: any[]) {
  let n = 0;
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (d: any) => ({ ...d }),
    find: jest.fn(async ({ where }: any = {}) =>
      rows.filter((r) => match(r, where)),
    ),
    findOne: jest.fn(
      async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null,
    ),
    save: jest.fn(async (e: any) => {
      if (!e.id) e.id = `id-${++n}`;
      e.createdAt ??= new Date('2026-10-20T00:00:00Z');
      rows.push(e);
      return e;
    }),
    update: jest.fn(async (where: any, patch: any) => {
      for (const r of rows.filter((x) => match(x, where)))
        Object.assign(r, patch);
      return { affected: 1 };
    }),
  };
}

function setup(opts: { runStatus?: string; pension?: boolean } = {}) {
  const runs = repo([
    {
      id: 'run1',
      tenantId: T,
      period: '2026-10',
      status: opts.runStatus ?? 'APPROVED',
    },
  ]);
  const withPension = opts.pension ?? true;
  const lines = repo([
    {
      id: 'l1',
      tenantId: T,
      runId: 'run1',
      employeeId: 'n1',
      employeeName: 'Mariam',
      pensionSchemeName: 'GPSSA',
      pensionBase: 30000,
      pensionEmployee: withPension ? 3300 : 0,
      pensionEmployer: withPension ? 4500 : 0,
    },
    {
      id: 'l2',
      tenantId: T,
      runId: 'run1',
      employeeId: 'e1',
      employeeName: 'Expat',
      pensionSchemeName: null,
      pensionBase: 0,
      pensionEmployee: 0,
      pensionEmployer: 0,
    },
  ]);
  const remittances = repo([]);
  const entries = repo([]);
  const accounts = repo([
    { id: BANK, tenantId: T, name: 'ENBD', currency: 'AED' },
    { id: 'usd', tenantId: T, name: 'USD acct', currency: 'USD' },
  ]);
  const repos = new Map<any, any>([
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [PensionRemittance, remittances],
    [JournalEntry, entries],
    [FinanceAccount, accounts],
    [Organization, repo([{ id: T, baseCurrency: 'AED' }])],
  ]);
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async () => [{ current_value: 1 }]),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const ledger: any = {
    resolveLines: jest.fn(async (_t: string, input: any[]) => {
      const d = input.reduce((s, l) => s + l.debit - l.credit, 0);
      if (Math.abs(d) > 0.005) throw new Error(`unbalanced by ${d}`);
      return input.map((l) => ({
        ...l,
        ledgerAccountId: l.ledgerAccountId ?? `acct-${l.role}`,
      }));
    }),
  };
  const service = new PensionRemittanceService(dataSource, ledger);
  return { service, manager, remittances, entries };
}

const balanceCalls = (ctx: ReturnType<typeof setup>) =>
  ctx.manager.query.mock.calls.filter(([sql]: any) =>
    /UPDATE "finance_accounts"/.test(sql),
  );

describe('PensionRemittanceService', () => {
  it('period view lists lines with pension and totals what is due', async () => {
    const ctx = setup();
    const out = await ctx.service.period(T, '2026-10');
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({
      employeeName: 'Mariam',
      schemeName: 'GPSSA',
      base: 30000,
      employee: 3300,
      employer: 4500,
    });
    expect(out).toMatchObject({
      employeeTotal: 3300,
      employerTotal: 4500,
      due: 7800,
      remittance: null,
    });
  });

  it('period with no posted run is empty', async () => {
    const ctx = setup({ runStatus: 'DRAFT' });
    const out = await ctx.service.period(T, '2026-10');
    expect(out).toMatchObject({ due: 0, lines: [], remittance: null });
  });

  it('remit posts a balanced Dr 2420 / Cr account entry and moves the balance', async () => {
    const ctx = setup();
    const paidAt = new Date('2026-11-03T00:00:00Z');
    const out = await ctx.service.remit(T, '2026-10', PAYER, {
      financeAccountId: BANK,
      paidAt,
    });
    expect(out.amount).toBe(7800);
    const entry = ctx.entries.rows[0];
    expect(entry).toMatchObject({
      entryNumber: 'JE-PENSION-2026-10',
      referenceType: 'PENSION_REMITTANCE',
      referenceId: out.id,
      entryDate: paidAt,
      totalAmount: 7800,
    });
    expect(entry.lines[0]).toMatchObject({
      role: LEDGER_ROLES.PENSION_PAYABLE,
      debit: 7800,
    });
    expect(entry.lines[1]).toMatchObject({ financeAccountId: BANK, credit: 7800 });
    expect(balanceCalls(ctx)).toHaveLength(1);
    expect(balanceCalls(ctx)[0][1]).toEqual([7800, BANK, T]);
    expect(ctx.remittances.rows[0].journalEntryId).toBe(entry.id);

    const after = await ctx.service.period(T, '2026-10');
    expect(after.due).toBe(0);
    expect(after.remittance?.id).toBe(out.id);
  });

  it('takes the tenant advisory lock before reading anything', async () => {
    const ctx = setup();
    await ctx.service.remit(T, '2026-10', PAYER, { financeAccountId: BANK });
    expect(ctx.manager.query.mock.calls[0][0]).toContain(ADVISORY);
  });

  it('a second remit is refused (409)', async () => {
    const ctx = setup();
    await ctx.service.remit(T, '2026-10', PAYER, { financeAccountId: BANK });
    const err = await ctx.service
      .remit(T, '2026-10', PAYER, { financeAccountId: BANK })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Pension for October 2026 is already remitted');
  });

  it('remit before approval is refused (409)', async () => {
    const ctx = setup({ runStatus: 'DRAFT' });
    const err = await ctx.service
      .remit(T, '2026-10', PAYER, { financeAccountId: BANK })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Approve payroll for October 2026 first');
  });

  it('nothing due is refused (409)', async () => {
    const ctx = setup({ pension: false });
    const err = await ctx.service
      .remit(T, '2026-10', PAYER, { financeAccountId: BANK })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('No pension is due for October 2026');
  });

  it('refuses a foreign-currency account (400) and an unknown one (404)', async () => {
    const ctx = setup();
    await expect(
      ctx.service.remit(T, '2026-10', PAYER, { financeAccountId: 'usd' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctx.service.remit(T, '2026-10', PAYER, { financeAccountId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.entries.rows).toHaveLength(0);
  });

  it('without payroll:pay is refused (403)', async () => {
    const ctx = setup();
    const nobody = { userId: USER, permissions: [PERMISSIONS.PAYROLL_READ] };
    await expect(
      ctx.service.remit(T, '2026-10', nobody, { financeAccountId: BANK }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      ctx.service.void(T, '2026-10', nobody),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('void reverses the entry, restores the balance and frees the period', async () => {
    const ctx = setup();
    const first = await ctx.service.remit(T, '2026-10', PAYER, {
      financeAccountId: BANK,
      paidAt: new Date('2026-11-03T00:00:00Z'),
    });
    const voided = await ctx.service.void(T, '2026-10', PAYER);
    expect(voided.voidedAt).not.toBeNull();

    const reversal = ctx.entries.rows[1];
    expect(reversal).toMatchObject({
      entryNumber: 'JE-PENSION-2026-10-VOID',
      referenceType: 'PENSION_REMITTANCE',
      referenceId: first.id,
      totalAmount: 7800,
    });
    expect(reversal.lines[0]).toMatchObject({ credit: 7800 });
    // Each line goes back to the exact ledger account it posted to.
    expect(reversal.lines[1]).toMatchObject({
      ledgerAccountId: ctx.entries.rows[0].lines[1].ledgerAccountId,
      accountName: 'ENBD',
      debit: 7800,
    });
    expect(new Date(reversal.entryDate).getTime()).toBeGreaterThanOrEqual(
      new Date('2026-11-03T00:00:00Z').getTime(),
    );
    const calls = balanceCalls(ctx);
    expect(calls[1][0]).toContain('"balance" + $1');
    expect(calls[1][1]).toEqual([7800, BANK, T]);
    expect(ctx.remittances.rows[0].voidJournalEntryId).toBe(reversal.id);

    const again = await ctx.service.remit(T, '2026-10', PAYER, {
      financeAccountId: BANK,
    });
    expect(again.id).not.toBe(first.id);
    expect((await ctx.service.period(T, '2026-10')).remittance?.id).toBe(
      again.id,
    );
  });

  it('a re-remit after a void, and its void, take new entry numbers', async () => {
    const ctx = setup();
    for (let i = 0; i < 3; i++) {
      await ctx.service.remit(T, '2026-10', PAYER, { financeAccountId: BANK });
      await ctx.service.void(T, '2026-10', PAYER);
    }
    expect(ctx.entries.rows.map((e: any) => e.entryNumber)).toEqual([
      'JE-PENSION-2026-10',
      'JE-PENSION-2026-10-VOID',
      'JE-PENSION-2026-10-2',
      'JE-PENSION-2026-10-2-VOID',
      'JE-PENSION-2026-10-3',
      'JE-PENSION-2026-10-3-VOID',
    ]);
  });

  it('void with nothing live is 404', async () => {
    const ctx = setup();
    await expect(
      ctx.service.void(T, '2026-10', PAYER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a unique-index race (23505) on insert is a 409', async () => {
    const ctx = setup();
    ctx.remittances.save.mockRejectedValueOnce(
      new QueryFailedError('INSERT', [], { code: '23505' } as any),
    );
    const err = await ctx.service
      .remit(T, '2026-10', PAYER, { financeAccountId: BANK })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Pension for October 2026 is already remitted');
  });

  it('void takes the tenant advisory lock before reading', async () => {
    const ctx = setup();
    await ctx.service.remit(T, '2026-10', PAYER, { financeAccountId: BANK });
    ctx.manager.query.mockClear();
    ctx.remittances.find.mockClear();
    await ctx.service.void(T, '2026-10', PAYER);
    expect(ctx.manager.query.mock.calls[0][0]).toContain(ADVISORY);
    expect(
      ctx.manager.query.mock.invocationCallOrder[0],
    ).toBeLessThan(ctx.remittances.find.mock.invocationCallOrder[0]);
  });
});
