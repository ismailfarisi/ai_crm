import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  LEDGER_ROLES,
  round2,
  type EmployeeAdvanceDto,
  type EmployeeAdvancesDto,
  type PayrollRunStatus,
  type RecordAdvancePayload,
} from '@saas/shared';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { Employee } from './entities/employee.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';

/** Runs whose journal stands: approved and not voided. */
export const POSTED_RUN_STATUSES: readonly PayrollRunStatus[] = [
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
];

/**
 * Lines of `employeeId` on posted runs, each with its run. A tenant has one
 * run a month, so filtering in memory is cheaper than it looks.
 */
export async function postedRunLines(
  manager: EntityManager,
  tenantId: string,
  employeeId: string,
): Promise<{ line: PayrollRunLine; run: PayrollRun }[]> {
  const runs = await manager
    .getRepository(PayrollRun)
    .find({ where: { tenantId } });
  const posted = new Map(
    runs
      .filter((r) => POSTED_RUN_STATUSES.includes(r.status))
      .map((r) => [r.id, r]),
  );
  const lines = await manager
    .getRepository(PayrollRunLine)
    .find({ where: { tenantId, employeeId } });
  return lines
    .filter((l) => posted.has(l.runId))
    .map((line) => ({ line, run: posted.get(line.runId)! }));
}

function toAdvanceDto(a: EmployeeAdvance): EmployeeAdvanceDto {
  return {
    id: a.id,
    employeeId: a.employeeId,
    amount: a.amount,
    issuedAt: new Date(a.issuedAt).toISOString(),
    financeAccountId: a.financeAccountId,
    note: a.note,
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

/** Salary advances: paid out of a finance account, recovered through payroll. */
@Injectable()
export class AdvancesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  async list(tenantId: string, employeeId: string): Promise<EmployeeAdvancesDto> {
    const manager = this.dataSource.manager;
    await this.loadEmployee(manager, tenantId, employeeId);
    const rows = await manager
      .getRepository(EmployeeAdvance)
      .find({ where: { tenantId, employeeId } });
    const advanced = round2(rows.reduce((s, a) => s + a.amount, 0));
    const recovered = await this.recovered(manager, tenantId, employeeId);
    return {
      advances: rows
        .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
        .map(toAdvanceDto),
      recovered,
      outstanding: round2(advanced - recovered),
    };
  }

  /**
   * Σ advances − Σ recoveries on posted runs. `excludeRunId` leaves one run
   * out, so a run being re-checked does not count its own recovery twice.
   */
  async outstanding(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    excludeRunId?: string,
  ): Promise<number> {
    const rows = await manager
      .getRepository(EmployeeAdvance)
      .find({ where: { tenantId, employeeId } });
    const advanced = rows.reduce((s, a) => s + a.amount, 0);
    const recovered = await this.recovered(
      manager,
      tenantId,
      employeeId,
      excludeRunId,
    );
    return round2(advanced - recovered);
  }

  /**
   * Pays an advance: Dr employee advances / Cr the finance account, with the
   * cash balance moved by a relative UPDATE as bill payments do.
   */
  async record(
    tenantId: string,
    employeeId: string,
    actorId: string,
    input: RecordAdvancePayload,
  ): Promise<EmployeeAdvanceDto> {
    return this.dataSource.transaction(async (manager) => {
      const employee = await this.loadEmployee(manager, tenantId, employeeId);
      const amount = round2(input.amount);
      if (!(amount > 0)) {
        throw new BadRequestException('An advance must be above zero');
      }

      const account = await manager
        .getRepository(FinanceAccount)
        .findOne({ where: { id: input.financeAccountId, tenantId } });
      if (!account) throw new NotFoundException('Account not found');
      const base = await baseCurrencyFor(manager, tenantId);
      if ((account.currency ?? '').trim().toUpperCase() !== base) {
        throw new BadRequestException(`Pay advances from a ${base} account`);
      }

      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [amount, account.id, tenantId],
      );

      const name = `${employee.firstName} ${employee.lastName}`;
      const description = `Salary advance to ${name}`;
      const lines = await this.ledger.resolveLines(
        tenantId,
        [
          {
            role: LEDGER_ROLES.EMPLOYEE_ADVANCES,
            accountName: 'Employee advances',
            debit: amount,
            credit: 0,
            description,
          },
          {
            financeAccountId: account.id,
            accountName: account.name,
            debit: 0,
            credit: amount,
            description,
          },
        ],
        manager,
      );

      // The id is chosen up front: the entry's number and reference carry it,
      // and the advance row needs the entry's id.
      const id = randomUUID();
      const issuedAt = input.issuedAt ?? new Date();
      const entryRepo = manager.getRepository(JournalEntry);
      const entry = await entryRepo.save(
        entryRepo.create({
          tenantId,
          entryNumber: `JE-ADV-${employee.employeeNumber}-${id.slice(0, 8)}`,
          referenceType: 'PAYROLL',
          referenceId: `advance:${id}`,
          entryDate: issuedAt,
          totalAmount: amount,
          currency: base,
          fxRate: 1,
          lines,
        }),
      );

      const repo = manager.getRepository(EmployeeAdvance);
      const saved = await repo.save(
        repo.create({
          id,
          tenantId,
          employeeId,
          amount,
          issuedAt,
          financeAccountId: account.id,
          journalEntryId: entry.id,
          note: input.note ?? null,
          createdById: actorId,
        }),
      );
      return toAdvanceDto(saved);
    });
  }

  private async recovered(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    excludeRunId?: string,
  ): Promise<number> {
    const lines = await postedRunLines(manager, tenantId, employeeId);
    return round2(
      lines
        .filter(({ run }) => run.id !== excludeRunId)
        .reduce((s, { line }) => s + (line.advanceRecovery ?? 0), 0),
    );
  }

  private async loadEmployee(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<Employee> {
    const row = await manager
      .getRepository(Employee)
      .findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }
}
