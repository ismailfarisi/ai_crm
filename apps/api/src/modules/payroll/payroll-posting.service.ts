import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  LEDGER_ROLES,
  periodBounds,
  PERMISSIONS,
  round2,
  type JournalLineInput,
  type LedgerRole,
  type Permission,
  type PayrollRunDto,
} from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { Employee } from './entities/employee.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { AdvancesService } from './advances.service';
import { GratuityService, lockGratuityOpening } from './gratuity.service';
import {
  lockPayrollRun,
  PayrollRunsService,
  periodLabel,
} from './payroll-runs.service';

export interface PayrollActor {
  userId: string;
  /** The actor's own resolved effective permissions — never a role. */
  permissions: Permission[];
}

const money = (n: number) => n.toFixed(2);
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const todayUtc = () => dayToDate(new Date().toISOString().slice(0, 10));

/**
 * Approval posts a run to the ledger and trues each employee's gratuity
 * provision up to their entitlement at month end; void reverses both exactly.
 */
@Injectable()
export class PayrollPostingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly runs: PayrollRunsService,
    private readonly advances: AdvancesService,
    private readonly gratuity: GratuityService,
  ) {}

  async approve(
    tenantId: string,
    runId: string,
    actor: PayrollActor,
  ): Promise<PayrollRunDto> {
    this.assertCanApprove(actor);

    await this.dataSource.transaction(async (manager) => {
      const run = await lockPayrollRun(manager, tenantId, runId);
      if (run.status !== 'DRAFT') {
        throw new ConflictException(
          `Payroll run ${run.runNumber} is ${run.status.toLowerCase().replace(/_/g, ' ')}; only a draft can be approved`,
        );
      }
      // Serialises with opening posts and other approvals and voids of this
      // tenant, so the cut-over, gratuity balances and outstanding advances
      // read below cannot move before this commits.
      await lockGratuityOpening(manager, tenantId);

      const label = periodLabel(run.period);
      const asOf = periodBounds(run.period).last;
      const cutover = await this.gratuity.latestCutover(manager, tenantId);
      if (cutover && asOf <= cutover) {
        throw new ConflictException(
          `Gratuity opening balances were set up as of ${cutover}; payroll for ${label} is already in them`,
        );
      }

      const lineRepo = manager.getRepository(PayrollRunLine);
      const lines = await lineRepo.find({ where: { tenantId, runId: run.id } });
      if (!lines.length) {
        throw new BadRequestException(
          `Payroll run ${run.runNumber} has no lines to approve`,
        );
      }
      await this.revalidate(manager, run, lines);

      // Gratuity true-up: provision after = entitlement at month end. This
      // run is still a draft, so its own unpaid leave is passed in.
      for (const line of lines) {
        const employee = await manager.getRepository(Employee).findOne({
          where: { id: line.employeeId, tenantId },
          withDeleted: true,
        });
        if (!employee) throw new NotFoundException('Employee not found');
        const before = await this.gratuity.balance(
          manager,
          tenantId,
          employee.id,
        );
        const ent = await this.gratuity.entitlement(
          manager,
          tenantId,
          employee,
          asOf,
          line.unpaidLeaveDays ?? 0,
        );
        const accrual = round2(ent.amount - before);
        line.gratuityBefore = before;
        line.gratuityAccrual = accrual;
        line.gratuityAfter = round2(before + accrual);
      }
      await lineRepo.save(lines);

      run.lines = lines;
      this.runs.recalcTotals(run);

      const description = `Payroll ${run.runNumber} (${label})`;
      const G = run.totalGratuityAccrual;
      const input = (
        [
          [
            LEDGER_ROLES.SALARIES,
            'Salaries & wages',
            run.totalSalaryCost,
            0,
            description,
          ],
          [
            LEDGER_ROLES.SALARIES,
            'Salaries & wages',
            0,
            run.totalOtherDeductions,
            'Payroll deductions',
          ],
          [
            LEDGER_ROLES.SALARIES_PAYABLE,
            'Salaries payable',
            0,
            run.totalNet,
            description,
          ],
          [
            LEDGER_ROLES.EMPLOYEE_ADVANCES,
            'Employee advances',
            0,
            run.totalAdvanceRecovery,
            description,
          ],
          [
            LEDGER_ROLES.GRATUITY_EXPENSE,
            'End-of-service gratuity',
            Math.max(G, 0),
            Math.max(-G, 0),
            description,
          ],
          [
            LEDGER_ROLES.GRATUITY_PROVISION,
            'End-of-service provision',
            Math.max(-G, 0),
            Math.max(G, 0),
            description,
          ],
        ] as [LedgerRole, string, number, number, string][]
      )
        .map(([role, accountName, debit, credit, desc]): JournalLineInput => ({
          role,
          accountName,
          debit: round2(debit),
          credit: round2(credit),
          description: desc,
        }))
        .filter((l) => l.debit !== 0 || l.credit !== 0);

      let journalEntryId: string | null = null;
      if (input.length) {
        const resolved = await this.ledger.resolveLines(
          tenantId,
          input,
          manager,
        );
        const entries = manager.getRepository(JournalEntry);
        const entry = await entries.save(
          entries.create({
            tenantId,
            entryNumber: `JE-${run.runNumber}`,
            referenceType: 'PAYROLL',
            referenceId: run.id,
            entryDate: dayToDate(asOf),
            totalAmount: round2(run.totalSalaryCost + Math.abs(G)),
            currency: await baseCurrencyFor(manager, tenantId),
            fxRate: 1,
            lines: resolved,
          }),
        );
        journalEntryId = entry.id;
      }

      const gratRepo = manager.getRepository(GratuityLedgerEntry);
      const accruals = lines
        .filter((l) => l.gratuityAccrual)
        .map((l) =>
          gratRepo.create({
            tenantId,
            employeeId: l.employeeId,
            kind: 'ACCRUAL',
            amount: l.gratuityAccrual!,
            asOf,
            runLineId: l.id,
            journalEntryId,
            note: null,
          }),
        );
      if (accruals.length) await gratRepo.save(accruals);

      // Only the columns approval owns; never the row as this request read it.
      await manager.getRepository(PayrollRun).update(
        { id: run.id, tenantId },
        {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: actor.userId,
          journalEntryId,
          totalSalaryCost: run.totalSalaryCost,
          totalOvertime: run.totalOvertime,
          totalBonus: run.totalBonus,
          totalUnpaidLeave: run.totalUnpaidLeave,
          totalAdvanceRecovery: run.totalAdvanceRecovery,
          totalOtherDeductions: run.totalOtherDeductions,
          totalNet: run.totalNet,
          totalGratuityAccrual: run.totalGratuityAccrual,
        },
      );
    });

    return this.runs.get(tenantId, runId);
  }

  async void(
    tenantId: string,
    runId: string,
    actor: PayrollActor,
  ): Promise<PayrollRunDto> {
    this.assertCanApprove(actor);

    await this.dataSource.transaction(async (manager) => {
      const run = await lockPayrollRun(manager, tenantId, runId);
      if (
        run.bankPaidAt ||
        run.cashPaidAt ||
        run.status === 'PARTIALLY_PAID' ||
        run.status === 'PAID'
      ) {
        throw new ConflictException('Paid runs cannot be voided');
      }
      if (run.status !== 'APPROVED') {
        throw new ConflictException(
          `Payroll run ${run.runNumber} is ${run.status.toLowerCase().replace(/_/g, ' ')}; only an approved run can be voided`,
        );
      }
      await lockGratuityOpening(manager, tenantId);

      const entries = manager.getRepository(JournalEntry);
      let voidEntryId: string | null = null;
      if (run.journalEntryId) {
        const approval = await entries.findOne({
          where: { id: run.journalEntryId, tenantId },
        });
        if (!approval) {
          throw new NotFoundException(
            `Journal entry for payroll run ${run.runNumber} not found`,
          );
        }
        const description = `Void of payroll ${run.runNumber}`;
        // Each line back to the exact account it posted to.
        const resolved = await this.ledger.resolveLines(
          tenantId,
          approval.lines.map((l): JournalLineInput => ({
            ledgerAccountId: l.ledgerAccountId,
            accountName: l.accountName,
            debit: l.credit,
            credit: l.debit,
            description,
          })),
          manager,
        );
        const reversal = await entries.save(
          entries.create({
            tenantId,
            entryNumber: `JE-${run.runNumber}-VOID`,
            referenceType: 'PAYROLL',
            referenceId: run.id,
            entryDate: todayUtc(),
            totalAmount: approval.totalAmount,
            currency: approval.currency,
            fxRate: 1,
            lines: resolved,
          }),
        );
        voidEntryId = reversal.id;
      }

      const lines = await manager
        .getRepository(PayrollRunLine)
        .find({ where: { tenantId, runId: run.id } });
      const gratRepo = manager.getRepository(GratuityLedgerEntry);
      const reversals: GratuityLedgerEntry[] = [];
      for (const line of lines) {
        const rows = await gratRepo.find({
          where: { tenantId, runLineId: line.id, kind: 'ACCRUAL' },
        });
        for (const r of rows) {
          reversals.push(
            gratRepo.create({
              tenantId,
              employeeId: r.employeeId,
              kind: 'REVERSAL',
              amount: round2(-r.amount),
              asOf: r.asOf,
              runLineId: r.runLineId,
              journalEntryId: voidEntryId,
              note: `Void of payroll ${run.runNumber}`,
            }),
          );
        }
      }
      if (reversals.length) await gratRepo.save(reversals);

      await manager
        .getRepository(PayrollRun)
        .update(
          { id: run.id, tenantId },
          { status: 'VOIDED', voidJournalEntryId: voidEntryId },
        );
    });

    return this.runs.get(tenantId, runId);
  }

  private assertCanApprove(actor: PayrollActor): void {
    if (!actor.permissions.includes(PERMISSIONS.PAYROLL_APPROVE)) {
      throw new ForbiddenException(
        'You do not have permission to approve or void payroll runs.',
      );
    }
  }

  /**
   * Every line recomputed from its snapshot and extras, then checked again:
   * a refresh after the extras were typed can leave them invalid, and two
   * drafts can each recover an advance that only covers one of them.
   */
  private async revalidate(
    manager: EntityManager,
    run: PayrollRun,
    lines: PayrollRunLine[],
  ): Promise<void> {
    const label = periodLabel(run.period);
    const recovering = new Map<string, { name: string; total: number }>();
    for (const line of lines) {
      this.runs.recalcLine(line);
      const name = line.employeeName;
      if (line.unpaidLeaveDays > line.daysEmployed) {
        throw new BadRequestException(
          `${name} was employed for only ${line.daysEmployed} days in ${label}`,
        );
      }
      if (line.netPay < 0) {
        throw new BadRequestException(`${name}'s deductions exceed their pay`);
      }
      if (line.advanceRecovery > 0) {
        const r = recovering.get(line.employeeId) ?? { name, total: 0 };
        r.total = round2(r.total + line.advanceRecovery);
        recovering.set(line.employeeId, r);
      }
    }
    for (const [employeeId, { name, total }] of recovering) {
      const outstanding = await this.advances.outstanding(
        manager,
        run.tenantId,
        employeeId,
        run.id,
      );
      if (total > outstanding) {
        throw new BadRequestException(
          `Only ${money(Math.max(0, outstanding))} of ${name}'s advance is outstanding`,
        );
      }
    }
  }
}
