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
  daysEmployed,
  LEDGER_ROLES,
  periodBounds,
  PERMISSIONS,
  round2,
  type JournalLineInput,
  type LedgerRole,
  type Permission,
  type PayrollRunDto,
  type PayPayrollRunPayload,
} from '@saas/shared';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { lockJobCosting } from '../job-costing/job-costing.lock';
import { LabourAbsorptionService } from '../job-costing/labour-absorption.service';
import { Employee } from './entities/employee.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { PensionRemittance } from './entities/pension-remittance.entity';
import { Settlement } from './entities/settlement.entity';
import { AdvancesService, POSTED_RUN_STATUSES } from './advances.service';
import { GratuityService, lockGratuityOpening } from './gratuity.service';
import { LeaveService } from './leave.service';
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

/** Line columns approval writes: leave and pension re-applied, flags, amounts, true-ups, labour. */
const APPROVAL_LINE_COLUMNS = [
  'isNational',
  'unpaidLeaveDays',
  'halfPayDays',
  'annualLeaveDays',
  'leaveDaysInPeriod',
  'pensionSchemeId',
  'pensionSchemeName',
  'pensionBase',
  'pensionEmployee',
  'pensionEmployer',
  'flags',
  'proratedGross',
  'overtimeAmount',
  'unpaidLeaveAmount',
  'halfPayAmount',
  'salaryCost',
  'netPay',
  'gratuityBefore',
  'gratuityAccrual',
  'gratuityAfter',
  'leaveProvisionBefore',
  'leaveProvisionChange',
  'leaveProvisionAfter',
  'standardHours',
  'loggedHours',
  'directHours',
  'labourRate',
  'labourAbsorbed',
] as const satisfies readonly (keyof PayrollRunLine)[];

/** The days a line's leave ledger rows carry, worked out before the journal exists. */
interface LeaveTrueUp {
  line: PayrollRunLine;
  accrualDays: number;
  takenDays: number;
  asOf: string;
}

/**
 * Approval posts a run to the ledger: salaries, pension contributions, and
 * each employee's gratuity and leave salary provisions trued up to month end.
 * Void reverses all of it exactly. Timesheet hours are charged to jobs in a
 * journal of their own (LabourAbsorptionService), which void takes back from
 * wherever each amount sits now.
 */
@Injectable()
export class PayrollPostingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly runs: PayrollRunsService,
    private readonly advances: AdvancesService,
    private readonly gratuity: GratuityService,
    private readonly leave: LeaveService,
    private readonly labour: LabourAbsorptionService,
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
      // Then timesheets and jobs: no entry can be written or moved, nor a job
      // completed or cancelled, between reading the hours and absorbing them.
      await lockJobCosting(manager, tenantId);

      // The true-up targets the entitlement at this month end; a later month
      // already posted would make it reverse that month's accrual.
      const later = await this.laterPostedRun(manager, run);
      if (later) {
        throw new ConflictException(
          `Payroll for ${periodLabel(later.period)} is already posted; approve runs in month order`,
        );
      }

      const label = periodLabel(run.period);
      const asOf = periodBounds(run.period).last;
      const cutover = await this.gratuity.latestCutover(manager, tenantId);
      if (cutover && asOf <= cutover) {
        throw new ConflictException(
          `Gratuity opening balances were set up as of ${cutover}; payroll for ${label} is already in them`,
        );
      }
      const leaveCutover = await this.leave.latestCutover(manager, tenantId);
      if (leaveCutover && asOf <= leaveCutover) {
        throw new ConflictException(
          `Leave opening balances were set up as of ${leaveCutover}; payroll for ${label} is already in them`,
        );
      }

      const lineRepo = manager.getRepository(PayrollRunLine);
      const lines = await lineRepo.find({ where: { tenantId, runId: run.id } });
      if (!lines.length) {
        throw new BadRequestException(
          `Payroll run ${run.runNumber} has no lines to approve`,
        );
      }

      // Leave and pension as they stand now, not as the draft froze them: a
      // record or scheme changed since must not post stale. Lines whose leave
      // was typed by hand keep their unpaid and half-pay days.
      // A settled leaver is paid off: a draft made before the settlement, or
      // before their dates changed, must not pay or provision them again.
      const settled = new Set(
        (await manager.getRepository(Settlement).find({ where: { tenantId } }))
          .filter((s) => s.status === 'APPROVED' || s.status === 'PAID')
          .map((s) => s.employeeId),
      );
      const employees = new Map<string, Employee>();
      const noScheme: string[] = [];
      for (const line of lines) {
        if (settled.has(line.employeeId)) {
          throw new ConflictException(
            `${line.employeeName} is settled — refresh the run`,
          );
        }
        // A soft-deleted employee can still have a line.
        const employee = await manager.getRepository(Employee).findOne({
          where: { id: line.employeeId, tenantId },
          withDeleted: true,
        });
        if (!employee) throw new NotFoundException('Employee not found');
        const days = daysEmployed({
          period: run.period,
          joiningDate: employee.joiningDate,
          leavingDate: employee.leavingDate,
        });
        if (days !== line.daysEmployed) {
          throw new ConflictException(
            `${line.employeeName}'s employment dates changed — refresh the run`,
          );
        }
        employees.set(line.id, employee);
        line.isNational = employee.isNational;
        await this.runs.fillLeave(manager, line, employee, run.period);
        await this.runs.applyPension(manager, line, employee);
        line.flags = await this.runs.flagsFor(manager, line, employee, run.period);
        if (line.isNational && !line.pensionSchemeId) {
          noScheme.push(line.employeeName);
        }
      }
      if (noScheme.length) {
        throw new ConflictException(
          `Assign an active pension scheme to ${noScheme.join(', ')} before approving`,
        );
      }
      await this.revalidate(manager, run, lines);

      // Gratuity true-up: provision after = statutory entitlement at month
      // end + Σ adjustments (they persist as an offset). This run is still a
      // draft, so its own unpaid leave is passed in.
      //
      // Leave true-up: provision after = days the employee will hold after
      // this month × basic ÷ 30. Day adjustments are already in the balance,
      // so they are valued like any other day.
      const leaveTrueUps: LeaveTrueUp[] = [];
      for (const line of lines) {
        const employee = employees.get(line.id)!;
        const before = await this.gratuity.balance(
          manager,
          tenantId,
          employee.id,
        );
        const target = await this.gratuity.target(
          manager,
          tenantId,
          employee,
          asOf,
          line.unpaidLeaveDays ?? 0,
        );
        const accrual = round2(target.amount - before);
        line.gratuityBefore = before;
        line.gratuityAccrual = accrual;
        line.gratuityAfter = round2(before + accrual);

        const acc = await this.leave.accruedTo(
          manager,
          tenantId,
          employee,
          asOf,
          line.unpaidLeaveDays ?? 0,
        );
        const baseline = await this.leave.accrualBaseline(
          manager,
          tenantId,
          employee.id,
        );
        const balance = await this.leave.balanceDays(
          manager,
          tenantId,
          employee.id,
        );
        const provision = await this.leave.provisionBalance(
          manager,
          tenantId,
          employee.id,
        );
        const accrualDays = round2(acc.accrued - baseline);
        const takenDays = round2(0 - (line.annualLeaveDays ?? 0));
        const balanceAfter = round2(balance + accrualDays + takenDays);
        const leaveTarget = round2((balanceAfter * line.basic) / 30);
        line.leaveProvisionBefore = provision;
        line.leaveProvisionChange = round2(leaveTarget - provision);
        line.leaveProvisionAfter = leaveTarget;
        leaveTrueUps.push({
          line,
          accrualDays,
          takenDays,
          asOf:
            employee.leavingDate && employee.leavingDate < asOf
              ? employee.leavingDate
              : asOf,
        });
      }
      // Hours read only now, under lockJobCosting; sets each line's labour columns.
      const absorption = await this.labour.prepare(
        manager,
        tenantId,
        run,
        lines,
      );

      // Only the columns approval owns; the run lock keeps other writers out.
      for (const line of lines) {
        const patch: Record<string, unknown> = {};
        for (const c of APPROVAL_LINE_COLUMNS) patch[c] = line[c];
        await lineRepo.update({ id: line.id, tenantId }, patch as never);
      }

      run.lines = lines;
      this.runs.recalcTotals(run);

      const description = `Payroll ${run.runNumber} (${label})`;
      const G = run.totalGratuityAccrual;
      const LP = run.totalLeaveProvision;
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
          // The employee's share is withheld from net pay.
          [
            LEDGER_ROLES.PENSION_PAYABLE,
            'Pension contributions payable',
            0,
            run.totalPensionEmployee,
            description,
          ],
          [
            LEDGER_ROLES.PENSION_EXPENSE,
            'Employer pension contribution',
            run.totalPensionEmployer,
            0,
            description,
          ],
          [
            LEDGER_ROLES.PENSION_PAYABLE,
            'Pension contributions payable',
            0,
            run.totalPensionEmployer,
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
          [
            LEDGER_ROLES.LEAVE_EXPENSE,
            'Leave salary expense',
            Math.max(LP, 0),
            Math.max(-LP, 0),
            description,
          ],
          [
            LEDGER_ROLES.LEAVE_PROVISION,
            'Leave salary provision',
            Math.max(-LP, 0),
            Math.max(LP, 0),
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
            totalAmount: round2(
              run.totalSalaryCost +
                Math.abs(G) +
                run.totalPensionEmployer +
                Math.abs(LP),
            ),
            currency: await baseCurrencyFor(manager, tenantId),
            fxRate: 1,
            lines: resolved,
          }),
        );
        journalEntryId = entry.id;
      }

      const labourJournalEntryId = await this.labour.post(
        manager,
        tenantId,
        run,
        absorption,
        dayToDate(asOf),
      );

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

      // Every line gets an ACCRUAL row, even of 0 days: it carries the
      // provision change, so Σ amount stays equal to the 2410 balance.
      const leaveRepo = manager.getRepository(LeaveLedgerEntry);
      const leaveRows: LeaveLedgerEntry[] = [];
      for (const t of leaveTrueUps) {
        const common = {
          tenantId,
          employeeId: t.line.employeeId,
          asOf: t.asOf,
          runLineId: t.line.id,
          settlementId: null,
          journalEntryId,
          note: null,
        };
        leaveRows.push(
          leaveRepo.create({
            ...common,
            kind: 'ACCRUAL',
            days: t.accrualDays,
            amount: t.line.leaveProvisionChange ?? 0,
          }),
        );
        if (t.takenDays !== 0) {
          leaveRows.push(
            leaveRepo.create({
              ...common,
              kind: 'TAKEN',
              days: t.takenDays,
              amount: null,
            }),
          );
        }
      }
      if (leaveRows.length) await leaveRepo.save(leaveRows);

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
          totalHalfPay: run.totalHalfPay,
          totalPensionEmployee: run.totalPensionEmployee,
          totalPensionEmployer: run.totalPensionEmployer,
          totalLeaveProvision: run.totalLeaveProvision,
          totalLabourAbsorbed: run.totalLabourAbsorbed,
          labourJournalEntryId,
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
      await lockJobCosting(manager, tenantId);

      const later = await this.laterPostedRun(manager, run);
      if (later) {
        throw new ConflictException(`Void ${periodLabel(later.period)} first`);
      }

      // The month's pension was paid to the fund from this run's lines.
      const remittances = await manager
        .getRepository(PensionRemittance)
        .find({ where: { tenantId, period: run.period } });
      if (remittances.some((r) => !r.voidedAt)) {
        throw new ConflictException(
          `Void the pension remittance for ${periodLabel(run.period)} first`,
        );
      }

      const lines = await manager
        .getRepository(PayrollRunLine)
        .find({ where: { tenantId, runId: run.id } });
      // A leaver's settlement is approved against their final month's run.
      const onRun = new Set(lines.map((l) => l.employeeId));
      const settled = (
        await manager.getRepository(Settlement).find({ where: { tenantId } })
      ).find(
        (s) =>
          (s.status === 'APPROVED' || s.status === 'PAID') &&
          onRun.has(s.employeeId) &&
          s.leavingDate.slice(0, 7) === run.period,
      );
      if (settled) {
        throw new ConflictException(
          `${settled.settlementNumber} for ${settled.employeeName} depends on this run; void it first`,
        );
      }

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
            // Never before the entry it reverses: a run approved ahead of its
            // month end is dated that month end.
            entryDate: new Date(
              Math.max(
                todayUtc().getTime(),
                new Date(approval.entryDate).getTime(),
              ),
            ),
            totalAmount: approval.totalAmount,
            currency: approval.currency,
            fxRate: 1,
            lines: resolved,
          }),
        );
        voidEntryId = reversal.id;
      }

      const note = `Void of payroll ${run.runNumber}`;
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
              note,
            }),
          );
        }
      }
      if (reversals.length) await gratRepo.save(reversals);

      const leaveRepo = manager.getRepository(LeaveLedgerEntry);
      const leaveReversals: LeaveLedgerEntry[] = [];
      for (const line of lines) {
        const rows = await leaveRepo.find({
          where: { tenantId, runLineId: line.id },
        });
        for (const r of rows) {
          if (r.kind !== 'ACCRUAL' && r.kind !== 'TAKEN') continue;
          leaveReversals.push(
            leaveRepo.create({
              tenantId,
              employeeId: r.employeeId,
              kind: 'REVERSAL',
              days: round2(0 - r.days),
              amount: r.amount == null ? null : round2(0 - r.amount),
              asOf: r.asOf,
              runLineId: r.runLineId,
              settlementId: null,
              journalEntryId: voidEntryId,
              note,
            }),
          );
        }
      }
      if (leaveReversals.length) await leaveRepo.save(leaveReversals);

      const labourVoidJournalEntryId = await this.labour.reverse(
        manager,
        tenantId,
        run,
      );

      // Totals stay as approved, as the payroll totals do.
      await manager.getRepository(PayrollRun).update(
        { id: run.id, tenantId },
        {
          status: 'VOIDED',
          voidJournalEntryId: voidEntryId,
          labourVoidJournalEntryId,
        },
      );
    });

    return this.runs.get(tenantId, runId);
  }

  async pay(
    tenantId: string,
    runId: string,
    actor: PayrollActor,
    input: PayPayrollRunPayload,
  ): Promise<PayrollRunDto> {
    if (!actor.permissions.includes(PERMISSIONS.PAYROLL_PAY)) {
      throw new ForbiddenException(
        'You do not have permission to pay payroll runs.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const run = await lockPayrollRun(manager, tenantId, runId);
      if (run.status === 'PAID') {
        throw new ConflictException('Nothing left to pay');
      }
      if (run.status !== 'APPROVED' && run.status !== 'PARTIALLY_PAID') {
        throw new ConflictException(
          `Payroll run ${run.runNumber} is ${run.status.toLowerCase().replace(/_/g, ' ')}; only an approved run can be paid`,
        );
      }
      const bank = input.method === 'BANK';
      const label = bank ? 'Bank' : 'Cash';
      if (bank ? run.bankPaidAt : run.cashPaidAt) {
        throw new ConflictException(
          `${label} payees on ${run.runNumber} are already paid`,
        );
      }

      const lineRepo = manager.getRepository(PayrollRunLine);
      const lines = await lineRepo.find({ where: { tenantId, runId: run.id } });
      const paidAt = input.paidAt ?? new Date();
      const mine = lines.filter(
        (l) => l.paymentMethod === input.method && !l.paidAt,
      );
      const total = round2(mine.reduce((s, l) => s + l.netPay, 0));
      if (!mine.length) {
        throw new ConflictException(
          `No ${label.toLowerCase()} payees on ${run.runNumber}`,
        );
      }

      if (total > 0) {
        const account = await manager
          .getRepository(FinanceAccount)
          .findOne({ where: { id: input.financeAccountId, tenantId } });
        if (!account) throw new NotFoundException('Account not found');
        const base = await baseCurrencyFor(manager, tenantId);
        if ((account.currency ?? '').trim().toUpperCase() !== base) {
          throw new BadRequestException(`Pay payroll from a ${base} account`);
        }

        await manager.query(
          `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
           WHERE "id" = $2 AND "tenantId" = $3`,
          [total, account.id, tenantId],
        );

        const description = `Payroll ${run.runNumber} (${periodLabel(run.period)}) paid by ${label.toLowerCase()}`;
        const resolved = await this.ledger.resolveLines(
          tenantId,
          [
            {
              role: LEDGER_ROLES.SALARIES_PAYABLE,
              accountName: 'Salaries payable',
              debit: total,
              credit: 0,
              description,
            },
            {
              financeAccountId: account.id,
              accountName: account.name,
              debit: 0,
              credit: total,
              description,
            },
          ],
          manager,
        );
        const entries = manager.getRepository(JournalEntry);
        await entries.save(
          entries.create({
            tenantId,
            entryNumber: `JE-${run.runNumber}-${input.method}`,
            referenceType: 'PAYROLL',
            referenceId: run.id,
            entryDate: paidAt,
            totalAmount: total,
            currency: base,
            fxRate: 1,
            lines: resolved,
          }),
        );
      }

      await lineRepo.update(
        { tenantId, runId: run.id, paymentMethod: input.method },
        { paidAt },
      );
      const remaining = lines.some(
        (l) => l.paymentMethod !== input.method && !l.paidAt,
      );
      await manager.getRepository(PayrollRun).update(
        { id: run.id, tenantId },
        {
          status: remaining ? 'PARTIALLY_PAID' : 'PAID',
          ...(bank ? { bankPaidAt: paidAt } : { cashPaidAt: paidAt }),
          updatedAt: new Date(),
        },
      );
    });

    return this.runs.get(tenantId, runId);
  }

  /** The latest posted run for a period after `run`'s, if any. */
  private async laterPostedRun(
    manager: EntityManager,
    run: PayrollRun,
  ): Promise<PayrollRun | null> {
    const runs = await manager
      .getRepository(PayrollRun)
      .find({ where: { tenantId: run.tenantId } });
    const later = runs
      .filter(
        (r) =>
          r.id !== run.id &&
          r.period > run.period &&
          POSTED_RUN_STATUSES.includes(r.status),
      )
      .sort((a, b) => b.period.localeCompare(a.period));
    return later[0] ?? null;
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
      if ((line.unpaidLeaveDays ?? 0) + (line.halfPayDays ?? 0) > line.daysEmployed) {
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
