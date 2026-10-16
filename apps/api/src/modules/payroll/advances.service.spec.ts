import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LEDGER_ROLES } from '@saas/shared';
import { Organization } from '../organizations/entities/organization.entity';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { Employee } from './entities/employee.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { Settlement, SettlementLine } from './entities/settlement.entity';
import { AdvancesService } from './advances.service';

const T = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const EMP = '44444444-4444-4444-8444-444444444444';
const BANK = '55555555-5555-4555-8555-555555555555';
const USD_BANK = '66666666-6666-4666-8666-666666666666';

function repo(rows: any[]) {
  let n = 0;
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (d: any) => ({ ...d }),
    find: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    findOne: jest.fn(async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null),
    save: jest.fn(async (e: any) => {
      if (!e.id) e.id = `id-${++n}`;
      if (!rows.includes(e)) {
        e.createdAt ??= new Date();
        rows.push(e);
      }
      return e;
    }),
  };
}

function setup() {
  const employees = repo([
    { id: EMP, tenantId: T, employeeNumber: 'EMP-0007', firstName: 'Ada', lastName: 'Okafor', status: 'ACTIVE' },
  ]);
  const accounts = repo([
    { id: BANK, tenantId: T, name: 'ENBD current', currency: 'AED', balance: 50000 },
    { id: USD_BANK, tenantId: T, name: 'USD account', currency: 'USD', balance: 50000 },
  ]);
  const advances = repo([]);
  const runs = repo([]);
  const lines = repo([]);
  const entries = repo([]);
  const orgs = repo([{ id: T, baseCurrency: 'AED' }]);
  const settlements = repo([]);
  const settlementLines = repo([]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [FinanceAccount, accounts],
    [EmployeeAdvance, advances],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [JournalEntry, entries],
    [Organization, orgs],
    [Settlement, settlements],
    [SettlementLine, settlementLines],
  ]);
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async () => []),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  // Echoes the roles so the test can read the posting.
  const ledger: any = {
    resolveLines: jest.fn(async (_t: string, input: any[]) =>
      input.map((l) => ({ ...l, ledgerAccountId: l.role ?? `fa:${l.financeAccountId}` })),
    ),
  };
  const service = new AdvancesService(dataSource, ledger);
  return { service, manager, ledger, advances, runs, lines, entries, settlements, settlementLines };
}

describe('AdvancesService', () => {
  it('record posts Dr employee advances / Cr the finance account and moves the balance', async () => {
    const { service, manager, ledger, advances, entries } = setup();
    const dto = await service.record(T, EMP, ACTOR, {
      amount: 2500,
      financeAccountId: BANK,
      note: 'Rent',
    } as any);

    expect(dto.amount).toBe(2500);
    expect(dto.employeeId).toBe(EMP);
    expect(advances.rows).toHaveLength(1);

    const [, input] = ledger.resolveLines.mock.calls[0];
    expect(input).toEqual([
      expect.objectContaining({ role: LEDGER_ROLES.EMPLOYEE_ADVANCES, debit: 2500, credit: 0 }),
      expect.objectContaining({ financeAccountId: BANK, debit: 0, credit: 2500 }),
    ]);

    const update = manager.query.mock.calls.find(([sql]: any) =>
      /UPDATE "finance_accounts" SET "balance" = "balance" - \$1/.test(sql),
    );
    expect(update?.[1]).toEqual([2500, BANK, T]);

    const entry = entries.rows[0];
    const adv = advances.rows[0];
    expect(entry.referenceType).toBe('PAYROLL');
    expect(entry.referenceId).toBe(`advance:${adv.id}`);
    expect(entry.entryNumber).toBe(`JE-ADV-EMP-0007-${adv.id.slice(0, 8)}`);
    expect(entry.totalAmount).toBe(2500);
    expect(adv.journalEntryId).toBe(entry.id);
    expect(adv.createdById).toBe(ACTOR);
  });

  it('record refuses a finance account outside the base currency', async () => {
    const { service } = setup();
    await expect(
      service.record(T, EMP, ACTOR, { amount: 100, financeAccountId: USD_BANK } as any),
    ).rejects.toThrow(new BadRequestException('Pay advances from a AED account'));
  });

  it('record refuses an employee of another tenant', async () => {
    const { service } = setup();
    await expect(
      service.record(OTHER, EMP, ACTOR, { amount: 100, financeAccountId: BANK } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('outstanding counts recoveries only on approved or paid runs, and can exclude one', async () => {
    const { service, manager, advances, runs, lines } = setup();
    advances.rows.push(
      { id: 'a1', tenantId: T, employeeId: EMP, amount: 3000 },
      { id: 'a2', tenantId: T, employeeId: EMP, amount: 2000 },
      { id: 'a3', tenantId: T, employeeId: 'someone-else', amount: 9000 },
    );
    runs.rows.push(
      { id: 'r-app', tenantId: T, status: 'APPROVED', period: '2026-08' },
      { id: 'r-draft', tenantId: T, status: 'DRAFT', period: '2026-09' },
      { id: 'r-void', tenantId: T, status: 'VOIDED', period: '2026-07' },
      { id: 'r-paid', tenantId: T, status: 'PAID', period: '2026-06' },
    );
    lines.rows.push(
      { id: 'l1', tenantId: T, runId: 'r-app', employeeId: EMP, advanceRecovery: 1000 },
      { id: 'l2', tenantId: T, runId: 'r-draft', employeeId: EMP, advanceRecovery: 700 },
      { id: 'l3', tenantId: T, runId: 'r-void', employeeId: EMP, advanceRecovery: 500 },
    );
    expect(await service.outstanding(manager, T, EMP)).toBe(4000);

    lines.rows.push({ id: 'l4', tenantId: T, runId: 'r-paid', employeeId: EMP, advanceRecovery: 250 });
    expect(await service.outstanding(manager, T, EMP)).toBe(3750);
    expect(await service.outstanding(manager, T, EMP, 'r-app')).toBe(4750);
  });

  it('outstanding counts recoveries on approved or paid settlements', async () => {
    const { service, manager, advances, settlements, settlementLines } = setup();
    advances.rows.push({ id: 'a1', tenantId: T, employeeId: EMP, amount: 5000 });
    settlements.rows.push(
      { id: 's-draft', tenantId: T, employeeId: EMP, status: 'DRAFT' },
      { id: 's-void', tenantId: T, employeeId: EMP, status: 'VOIDED' },
    );
    settlementLines.rows.push(
      { id: 'sl1', tenantId: T, settlementId: 's-draft', kind: 'ADVANCE_RECOVERY', amount: -5000 },
      { id: 'sl2', tenantId: T, settlementId: 's-void', kind: 'ADVANCE_RECOVERY', amount: -5000 },
    );
    expect(await service.outstanding(manager, T, EMP)).toBe(5000);

    settlements.rows.push({ id: 's-ok', tenantId: T, employeeId: EMP, status: 'APPROVED' });
    settlementLines.rows.push(
      { id: 'sl3', tenantId: T, settlementId: 's-ok', kind: 'ADVANCE_RECOVERY', amount: -1200 },
      { id: 'sl4', tenantId: T, settlementId: 's-ok', kind: 'GRATUITY', amount: 9000 },
    );
    expect(await service.outstanding(manager, T, EMP)).toBe(3800);
  });

  it('list returns the advances with recovered and outstanding totals', async () => {
    const { service, advances, runs, lines } = setup();
    advances.rows.push({
      id: 'a1', tenantId: T, employeeId: EMP, amount: 5000, financeAccountId: BANK,
      issuedAt: new Date('2026-08-01T00:00:00Z'), note: null, createdAt: new Date('2026-08-01T00:00:00Z'),
    });
    runs.rows.push({ id: 'r1', tenantId: T, status: 'APPROVED', period: '2026-08' });
    lines.rows.push({ id: 'l1', tenantId: T, runId: 'r1', employeeId: EMP, advanceRecovery: 1000 });
    const dto = await service.list(T, EMP);
    expect(dto.recovered).toBe(1000);
    expect(dto.outstanding).toBe(4000);
    expect(dto.advances).toEqual([
      expect.objectContaining({ id: 'a1', amount: 5000, issuedAt: '2026-08-01T00:00:00.000Z' }),
    ]);
  });
});
