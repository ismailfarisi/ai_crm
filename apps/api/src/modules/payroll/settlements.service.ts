import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { QueryFailedError, type DataSource, type EntityManager } from 'typeorm';
import {
  leaveEncashment,
  leaveServiceDays,
  LEDGER_ROLES,
  noticePay,
  packageGross,
  periodBounds,
  PERMISSIONS,
  round2,
  settlementGratuity,
  type CreateSettlementPayload,
  type JournalLineInput,
  type LedgerRole,
  type PaySettlementPayload,
  type SettlementDto,
  type SettlementLineKind,
  type SettlementStatementDto,
  type UpdateSettlementPayload,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { Organization } from '../organizations/entities/organization.entity';
import { Employee } from './entities/employee.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { Settlement, SettlementLine } from './entities/settlement.entity';
import { AdvancesService, postedRunLines } from './advances.service';
import { EmployeesService } from './employees.service';
import { GratuityService, lockGratuityOpening } from './gratuity.service';
import { LeaveService } from './leave.service';
import { maskIban } from './employee-mask';
import { periodLabel } from './payroll-runs.service';
import type { PayrollActor } from './payroll-posting.service';

const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const todayUtc = () => dayToDate(new Date().toISOString().slice(0, 10));
const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;
const fullName = (e: Employee) => `${e.firstName} ${e.lastName}`;

/** A settlement line before it is stored. */
type LinePlan = Pick<SettlementLine, 'kind' | 'label' | 'quantity' | 'rate' | 'amount'>;

/** Everything the calculated lines are built from, read at one moment. */
interface Basis {
  employee: Employee;
  name: string;
  leavingDate: string;
  serviceDays: number;
  basic: number;
  gross: number;
  gratuity: number;
  leaveBalanceDays: number;
  outstanding: number;
}

const MANUAL_KINDS: readonly SettlementLineKind[] = ['ADDITION', 'DEDUCTION'];

function gratuityLine(b: Basis): LinePlan {
  return {
    kind: 'GRATUITY',
    label: `End-of-service gratuity (${(b.serviceDays / 365).toFixed(2)} years)`,
    quantity: null,
    rate: null,
    amount: b.gratuity,
  };
}

function leaveLine(days: number, basic: number): LinePlan {
  return {
    kind: 'LEAVE_ENCASHMENT',
    label: days < 0 ? 'Leave taken in advance' : 'Untaken leave encashment',
    quantity: round2(days),
    rate: Math.round((basic / 30) * 10000) / 10000,
    amount: leaveEncashment({ days, basic }),
  };
}

function noticeLine(days: number, direction: 'PAY' | 'DEDUCT', gross: number): LinePlan {
  return {
    kind: 'NOTICE_PAY',
    label: direction === 'PAY' ? 'Notice pay in lieu' : 'Notice not served',
    quantity: round2(days),
    rate: Math.round((gross / 30) * 10000) / 10000,
    amount: noticePay({ days, gross, direction }),
  };
}

function advanceLine(recovery: number): LinePlan {
  return {
    kind: 'ADVANCE_RECOVERY',
    label: 'Salary advance recovered',
    quantity: null,
    rate: null,
    amount: round2(0 - recovery),
  };
}

/** The advance line: everything outstanding unless a smaller amount is asked for. */
function recoveryPlan(outstanding: number, asked?: number): LinePlan[] {
  if (!(outstanding > 0)) return [];
  return [advanceLine(Math.min(asked ?? outstanding, outstanding))];
}

/**
 * Reads a settlement `FOR UPDATE` inside the caller's transaction, so edits,
 * approval, void and payment of one settlement serialise.
 */
export async function lockSettlement(
  manager: EntityManager,
  tenantId: string,
  id: string,
): Promise<Settlement> {
  const row = await manager
    .getRepository(Settlement)
    .createQueryBuilder('s')
    .setLock('pessimistic_write')
    .where('s.id = :id', { id })
    .andWhere('s.tenant_id = :tenantId', { tenantId })
    .getOne();
  if (!row) throw new NotFoundException('Settlement not found');
  return row;
}

/**
 * A leaver's final settlement: gratuity, leave encashment, notice pay,
 * advance recovery and free lines. Approval pays out the employee's gratuity
 * and leave provisions (2400, 2410) and recognises the difference to what is
 * owed; void reverses it exactly.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly employees: EmployeesService,
    private readonly advances: AdvancesService,
    private readonly gratuity: GratuityService,
    private readonly leave: LeaveService,
  ) {}

  async list(tenantId: string): Promise<SettlementDto[]> {
    const manager = this.dataSource.manager;
    const rows = await manager.getRepository(Settlement).find({ where: { tenantId } });
    const lines = await manager.getRepository(SettlementLine).find({ where: { tenantId } });
    return rows
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((s) => this.toDto(s, lines.filter((l) => l.settlementId === s.id)));
  }

  async get(tenantId: string, id: string): Promise<SettlementDto> {
    const manager = this.dataSource.manager;
    const row = await manager.getRepository(Settlement).findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Settlement not found');
    return this.toDto(row, await this.linesOf(manager, row));
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateSettlementPayload,
  ): Promise<SettlementDto> {
    let id: string;
    try {
      id = await this.dataSource.transaction(async (manager) => {
        const b = await this.basis(manager, tenantId, input.employeeId);
        await this.assertFinalRunPosted(manager, tenantId, b);
        const live = (
          await manager
            .getRepository(Settlement)
            .find({ where: { tenantId, employeeId: b.employee.id } })
        ).find((s) => s.status !== 'VOIDED');
        if (live) {
          throw new ConflictException(
            `${b.name} already has settlement ${live.settlementNumber}`,
          );
        }

        const seq = await allocateNextSequenceValue(manager, tenantId, 'settlement_number');
        const repo = manager.getRepository(Settlement);
        // The partial unique index rejects a racing second live settlement here.
        const saved = await repo.save(
          repo.create({
            tenantId,
            settlementNumber: formatSequenceNumber('FS', seq),
            employeeId: b.employee.id,
            employeeName: b.name,
            leavingDate: b.leavingDate,
            reason: input.reason,
            serviceDays: b.serviceDays,
            status: 'DRAFT',
            basic: b.basic,
            gross: b.gross,
            leaveBalanceDays: b.leaveBalanceDays,
            netPay: 0,
            paymentMethod: b.employee.paymentMethod,
            financeAccountId: null,
            paidAt: null,
            journalEntryId: null,
            paymentJournalEntryId: null,
            voidJournalEntryId: null,
            approvedById: null,
            approvedAt: null,
            createdById: actorId,
          }),
        );
        const netPay = await this.writeLines(manager, saved, [
          gratuityLine(b),
          leaveLine(b.leaveBalanceDays, b.basic),
          ...recoveryPlan(b.outstanding),
        ]);
        await repo.update({ id: saved.id, tenantId }, { netPay });
        return saved.id;
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException('This employee already has a live settlement');
      }
      throw err;
    }
    return this.get(tenantId, id);
  }

  /** Edits a draft: reason, encashment days, notice, advance recovery, free lines. */
  async update(
    tenantId: string,
    id: string,
    input: UpdateSettlementPayload,
  ): Promise<SettlementDto> {
    await this.dataSource.transaction(async (manager) => {
      const s = await this.lockDraft(manager, tenantId, id, 'edited');
      const lines = await this.linesOf(manager, s);
      const of = (kind: SettlementLineKind) => lines.filter((l) => l.kind === kind);

      let leave: LinePlan[] = of('LEAVE_ENCASHMENT');
      if (input.leaveEncashmentDays !== undefined) {
        const balance = s.leaveBalanceDays;
        if (balance < 0) {
          throw new BadRequestException('Leave taken in advance is deducted in full');
        }
        if (input.leaveEncashmentDays > balance) {
          throw new BadRequestException(`Only ${balance} days of leave are untaken`);
        }
        leave = [leaveLine(input.leaveEncashmentDays, s.basic)];
      }

      let notice: LinePlan[] = of('NOTICE_PAY');
      if (input.noticeDays !== undefined || input.noticeDirection !== undefined) {
        const current = notice[0];
        const days = input.noticeDays ?? current?.quantity ?? 0;
        const direction =
          input.noticeDirection ?? (current && current.amount < 0 ? 'DEDUCT' : 'PAY');
        notice = days > 0 ? [noticeLine(days, direction, s.gross)] : [];
      }

      let recovery: LinePlan[] = of('ADVANCE_RECOVERY');
      if (input.advanceRecovery !== undefined) {
        const outstanding = await this.advances.outstanding(manager, tenantId, s.employeeId);
        recovery = recoveryPlan(outstanding, input.advanceRecovery);
      }

      const manual: LinePlan[] = input.manualLines
        ? input.manualLines.map((l) => ({
            kind: l.kind,
            label: l.label,
            quantity: null,
            rate: null,
            amount: l.kind === 'DEDUCTION' ? round2(0 - l.amount) : round2(l.amount),
          }))
        : lines.filter((l) => MANUAL_KINDS.includes(l.kind));

      const netPay = await this.writeLines(manager, s, [
        ...of('GRATUITY'),
        ...leave,
        ...notice,
        ...recovery,
        ...manual,
      ]);
      await manager
        .getRepository(Settlement)
        .update({ id: s.id, tenantId }, { netPay, ...(input.reason ? { reason: input.reason } : {}) });
    });
    return this.get(tenantId, id);
  }

  /**
   * Recomputes the calculated lines from the balances as they stand now.
   * Notice pay and free lines are kept (notice revalued on the current gross).
   */
  async refresh(tenantId: string, id: string): Promise<SettlementDto> {
    await this.dataSource.transaction(async (manager) => {
      const s = await this.lockDraft(manager, tenantId, id, 'refreshed');
      const lines = await this.linesOf(manager, s);
      const b = await this.basis(manager, tenantId, s.employeeId);
      const notice = lines
        .filter((l) => l.kind === 'NOTICE_PAY')
        .map((l) => noticeLine(l.quantity ?? 0, l.amount < 0 ? 'DEDUCT' : 'PAY', b.gross));
      const netPay = await this.writeLines(manager, s, [
        gratuityLine(b),
        leaveLine(b.leaveBalanceDays, b.basic),
        ...notice,
        ...recoveryPlan(b.outstanding),
        ...lines.filter((l) => MANUAL_KINDS.includes(l.kind)),
      ]);
      await manager.getRepository(Settlement).update(
        { id: s.id, tenantId },
        {
          employeeName: b.name,
          leavingDate: b.leavingDate,
          serviceDays: b.serviceDays,
          basic: b.basic,
          gross: b.gross,
          leaveBalanceDays: b.leaveBalanceDays,
          paymentMethod: b.employee.paymentMethod,
          netPay,
        },
      );
    });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const s = await this.lockDraft(manager, tenantId, id, 'deleted');
      await manager.getRepository(SettlementLine).delete({ tenantId, settlementId: s.id });
      await manager.getRepository(Settlement).delete({ id: s.id, tenantId });
    });
  }

  async approve(tenantId: string, id: string, actor: PayrollActor): Promise<SettlementDto> {
    this.assertCanApprove(actor);

    await this.dataSource.transaction(async (manager) => {
      const s = await lockSettlement(manager, tenantId, id);
      if (s.status !== 'DRAFT') {
        throw new ConflictException(
          `${s.settlementNumber} is ${s.status.toLowerCase()}; only a draft can be approved`,
        );
      }
      // Serialises with run approvals and voids, leave changes and gratuity
      // postings, so the balances below cannot move before this commits.
      await lockGratuityOpening(manager, tenantId);

      const b = await this.basis(manager, tenantId, s.employeeId);
      const posted = await this.assertFinalRunPosted(manager, tenantId, b);
      const finalPeriod = b.leavingDate.slice(0, 7);
      const later = posted
        .filter(({ run }) => run.period > finalPeriod)
        .sort((x, y) => y.run.period.localeCompare(x.run.period))[0];
      if (later) {
        throw new ConflictException(
          `${b.name} is on payroll for ${periodLabel(later.run.period)}; void it first`,
        );
      }

      const lines = await this.linesOf(manager, s);
      const sum = (kinds: SettlementLineKind[]) =>
        round2(lines.filter((l) => kinds.includes(l.kind)).reduce((t, l) => t + l.amount, 0));
      const G = sum(['GRATUITY']);
      const L = sum(['LEAVE_ENCASHMENT']);
      const S = sum(['NOTICE_PAY', 'ADDITION', 'DEDUCTION']);
      const A = round2(0 - sum(['ADVANCE_RECOVERY']));
      const net = round2(lines.reduce((t, l) => t + l.amount, 0));

      // A gratuity or leave change since the draft must not post stale figures.
      if (
        b.leavingDate !== s.leavingDate ||
        b.basic !== s.basic ||
        b.gross !== s.gross ||
        b.gratuity !== G ||
        b.leaveBalanceDays !== s.leaveBalanceDays ||
        A > b.outstanding
      ) {
        throw new ConflictException(
          `Balances changed since ${s.settlementNumber} was drafted; refresh it`,
        );
      }
      if (net < 0) {
        throw new BadRequestException(
          `${s.employeeName} owes more than the settlement pays; recover the difference outside payroll`,
        );
      }

      const gB = await this.gratuity.balance(manager, tenantId, s.employeeId);
      const lB = await this.leave.provisionBalance(manager, tenantId, s.employeeId);
      const description = `Final settlement ${s.settlementNumber} (${s.employeeName})`;
      // Signed: positive debits, negative credits.
      const signed = (role: LedgerRole, accountName: string, amount: number): JournalLineInput => ({
        role,
        accountName,
        debit: round2(Math.max(amount, 0)),
        credit: round2(Math.max(0 - amount, 0)),
        description,
      });
      const input = [
        signed(LEDGER_ROLES.GRATUITY_PROVISION, 'End-of-service provision', gB),
        signed(LEDGER_ROLES.GRATUITY_EXPENSE, 'End-of-service gratuity', round2(G - gB)),
        signed(LEDGER_ROLES.LEAVE_PROVISION, 'Leave salary provision', lB),
        signed(LEDGER_ROLES.LEAVE_EXPENSE, 'Leave salary expense', round2(L - lB)),
        signed(LEDGER_ROLES.SALARIES, 'Salaries & wages', S),
        signed(LEDGER_ROLES.EMPLOYEE_ADVANCES, 'Employee advances', round2(0 - A)),
        signed(LEDGER_ROLES.SALARIES_PAYABLE, 'Salaries payable', round2(0 - net)),
      ].filter((l) => l.debit !== 0 || l.credit !== 0);

      let journalEntryId: string | null = null;
      if (input.length) {
        const resolved = await this.ledger.resolveLines(tenantId, input, manager);
        const entries = manager.getRepository(JournalEntry);
        const entry = await entries.save(
          entries.create({
            tenantId,
            entryNumber: `JE-${s.settlementNumber}`,
            referenceType: 'SETTLEMENT',
            referenceId: s.id,
            entryDate: todayUtc(),
            totalAmount: round2(input.reduce((t, l) => t + l.debit, 0)),
            currency: await baseCurrencyFor(manager, tenantId),
            fxRate: 1,
            lines: resolved,
          }),
        );
        journalEntryId = entry.id;
      }

      const note = `Settlement ${s.settlementNumber}`;
      if (gB !== 0) {
        const gratRepo = manager.getRepository(GratuityLedgerEntry);
        await gratRepo.save(
          gratRepo.create({
            tenantId,
            employeeId: s.employeeId,
            kind: 'SETTLEMENT',
            amount: round2(0 - gB),
            asOf: s.leavingDate,
            runLineId: null,
            settlementId: s.id,
            journalEntryId,
            note,
          }),
        );
      }
      if (b.leaveBalanceDays !== 0 || lB !== 0) {
        const leaveRepo = manager.getRepository(LeaveLedgerEntry);
        await leaveRepo.save(
          leaveRepo.create({
            tenantId,
            employeeId: s.employeeId,
            kind: 'ENCASHMENT',
            days: round2(0 - b.leaveBalanceDays),
            amount: round2(0 - lB),
            asOf: s.leavingDate,
            runLineId: null,
            settlementId: s.id,
            journalEntryId,
            note,
          }),
        );
      }

      await manager.getRepository(Settlement).update(
        { id: s.id, tenantId },
        {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: actor.userId,
          journalEntryId,
          netPay: net,
        },
      );
    });

    return this.get(tenantId, id);
  }

  async void(tenantId: string, id: string, actor: PayrollActor): Promise<SettlementDto> {
    this.assertCanApprove(actor);

    await this.dataSource.transaction(async (manager) => {
      const s = await lockSettlement(manager, tenantId, id);
      await lockGratuityOpening(manager, tenantId);
      if (s.status === 'PAID') {
        throw new ConflictException('Paid settlements cannot be voided');
      }
      if (s.status !== 'APPROVED') {
        throw new ConflictException(
          `${s.settlementNumber} is ${s.status.toLowerCase()}; only an approved settlement can be voided`,
        );
      }

      const entries = manager.getRepository(JournalEntry);
      let voidJournalEntryId: string | null = null;
      if (s.journalEntryId) {
        const original = await entries.findOne({ where: { id: s.journalEntryId, tenantId } });
        if (!original) {
          throw new NotFoundException(`Journal entry for ${s.settlementNumber} not found`);
        }
        const description = `Void of final settlement ${s.settlementNumber}`;
        // Each line back to the exact account it posted to.
        const resolved = await this.ledger.resolveLines(
          tenantId,
          original.lines.map((l): JournalLineInput => ({
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
            entryNumber: `JE-${s.settlementNumber}-VOID`,
            referenceType: 'SETTLEMENT',
            referenceId: s.id,
            // Never before the entry it reverses.
            entryDate: new Date(
              Math.max(todayUtc().getTime(), new Date(original.entryDate).getTime()),
            ),
            totalAmount: original.totalAmount,
            currency: original.currency,
            fxRate: 1,
            lines: resolved,
          }),
        );
        voidJournalEntryId = reversal.id;
      }

      const note = `Void of settlement ${s.settlementNumber}`;
      const gratRepo = manager.getRepository(GratuityLedgerEntry);
      const gratRows = await gratRepo.find({
        where: { tenantId, settlementId: s.id, kind: 'SETTLEMENT' },
      });
      if (gratRows.length) {
        await gratRepo.save(
          gratRows.map((r) =>
            gratRepo.create({
              tenantId,
              employeeId: r.employeeId,
              kind: 'REVERSAL',
              amount: round2(0 - r.amount),
              asOf: r.asOf,
              runLineId: null,
              settlementId: s.id,
              journalEntryId: voidJournalEntryId,
              note,
            }),
          ),
        );
      }
      const leaveRepo = manager.getRepository(LeaveLedgerEntry);
      const leaveRows = await leaveRepo.find({
        where: { tenantId, settlementId: s.id, kind: 'ENCASHMENT' },
      });
      if (leaveRows.length) {
        await leaveRepo.save(
          leaveRows.map((r) =>
            leaveRepo.create({
              tenantId,
              employeeId: r.employeeId,
              kind: 'REVERSAL',
              days: round2(0 - r.days),
              amount: r.amount == null ? null : round2(0 - r.amount),
              asOf: r.asOf,
              runLineId: null,
              settlementId: s.id,
              journalEntryId: voidJournalEntryId,
              note,
            }),
          ),
        );
      }

      await manager
        .getRepository(Settlement)
        .update({ id: s.id, tenantId }, { status: 'VOIDED', voidJournalEntryId });
    });

    return this.get(tenantId, id);
  }

  async pay(
    tenantId: string,
    id: string,
    actor: PayrollActor,
    input: PaySettlementPayload,
  ): Promise<SettlementDto> {
    if (!actor.permissions.includes(PERMISSIONS.PAYROLL_PAY)) {
      throw new ForbiddenException('You do not have permission to pay settlements.');
    }

    await this.dataSource.transaction(async (manager) => {
      const s = await lockSettlement(manager, tenantId, id);
      if (s.status === 'PAID') {
        throw new ConflictException(`${s.settlementNumber} is already paid`);
      }
      if (s.status !== 'APPROVED') {
        throw new ConflictException(
          `${s.settlementNumber} is ${s.status.toLowerCase()}; only an approved settlement can be paid`,
        );
      }
      const account = await manager
        .getRepository(FinanceAccount)
        .findOne({ where: { id: input.financeAccountId, tenantId } });
      if (!account) throw new NotFoundException('Account not found');
      const base = await baseCurrencyFor(manager, tenantId);
      if ((account.currency ?? '').trim().toUpperCase() !== base) {
        throw new BadRequestException(`Pay settlements from a ${base} account`);
      }

      const paidAt = input.paidAt ?? new Date();
      const amount = round2(s.netPay);
      let paymentJournalEntryId: string | null = null;
      if (amount > 0) {
        await manager.query(
          `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
           WHERE "id" = $2 AND "tenantId" = $3`,
          [amount, account.id, tenantId],
        );
        const description = `Final settlement ${s.settlementNumber} (${s.employeeName}) paid`;
        const resolved = await this.ledger.resolveLines(
          tenantId,
          [
            {
              role: LEDGER_ROLES.SALARIES_PAYABLE,
              accountName: 'Salaries payable',
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
        const entries = manager.getRepository(JournalEntry);
        const entry = await entries.save(
          entries.create({
            tenantId,
            entryNumber: `JE-${s.settlementNumber}-PAY`,
            referenceType: 'SETTLEMENT',
            referenceId: s.id,
            entryDate: paidAt,
            totalAmount: amount,
            currency: base,
            fxRate: 1,
            lines: resolved,
          }),
        );
        paymentJournalEntryId = entry.id;
      }

      await manager.getRepository(Settlement).update(
        { id: s.id, tenantId },
        {
          status: 'PAID',
          paidAt,
          financeAccountId: account.id,
          paymentJournalEntryId,
        },
      );
    });

    return this.get(tenantId, id);
  }

  /** The printable statement: the settlement, the employee and the employer. */
  async statement(tenantId: string, id: string): Promise<SettlementStatementDto> {
    const settlement = await this.get(tenantId, id);
    const manager = this.dataSource.manager;
    // Soft-deleted employees keep their statements.
    const employee = await manager.getRepository(Employee).findOne({
      where: { id: settlement.employeeId, tenantId },
      withDeleted: true,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const org = await manager.getRepository(Organization).findOne({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Organization not found');
    const address =
      [org.addressLine1, org.addressLine2, org.city, org.region, org.postalCode, org.country]
        .filter(Boolean)
        .join(', ') || null;
    return {
      settlement,
      employee: {
        employeeNumber: employee.employeeNumber,
        fullName: fullName(employee),
        jobTitle: employee.jobTitle,
        joiningDate: employee.joiningDate,
        // Only the last four digits ever leave the server on a statement.
        ibanMasked: maskIban(employee.ibanLast4),
        bankName: employee.bankName,
      },
      organization: {
        name: org.name,
        legalName: org.legalName,
        address,
        baseCurrency: org.baseCurrency,
      },
    };
  }

  /**
   * The leaver, their package at the leaving date and the balances a
   * settlement pays out. Gratuity is taken as of the final month's end, so
   * service stops at the leaving date but the final run's unpaid leave
   * counts, matching what that run trued the provision up to. Service days
   * are counted directly: the statutory figure is 0 for nationals.
   */
  private async basis(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
  ): Promise<Basis> {
    const employee = await manager.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId },
      withDeleted: true,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const leavingDate = employee.leavingDate;
    if (employee.status !== 'LEFT' || !leavingDate) {
      throw new BadRequestException('Only employees who have left can be settled');
    }
    const name = fullName(employee);
    const pkg = await this.employees.packageAt(manager, tenantId, employee.id, leavingDate);
    if (!pkg) {
      throw new BadRequestException(`${name} has no salary package on ${leavingDate}`);
    }
    const monthEnd = periodBounds(leavingDate.slice(0, 7)).last;
    const t = await this.gratuity.target(manager, tenantId, employee, monthEnd);
    const unpaidDays = await this.gratuity.unpaidLeaveDaysTo(
      manager,
      tenantId,
      employee.id,
      monthEnd,
    );
    const serviceDays = leaveServiceDays({
      joiningDate: employee.joiningDate,
      asOf: leavingDate,
      unpaidDays,
    });
    return {
      employee,
      name,
      leavingDate,
      serviceDays,
      basic: pkg.basic,
      gross: packageGross(pkg),
      gratuity: settlementGratuity({
        serviceDays,
        statutory: t.statutory,
        adjustments: t.adjustments,
      }),
      leaveBalanceDays: await this.leave.balanceDays(manager, tenantId, employee.id),
      outstanding: await this.advances.outstanding(manager, tenantId, employee.id),
    };
  }

  /** The leaver's final month must be posted with them on it; returns their posted lines. */
  private async assertFinalRunPosted(manager: EntityManager, tenantId: string, b: Basis) {
    const period = b.leavingDate.slice(0, 7);
    const posted = await postedRunLines(manager, tenantId, b.employee.id);
    if (!posted.some(({ run }) => run.period === period)) {
      throw new ConflictException(
        `Approve payroll for ${periodLabel(period)} first: it is ${b.name}'s final month`,
      );
    }
    return posted;
  }

  private async lockDraft(
    manager: EntityManager,
    tenantId: string,
    id: string,
    verb: string,
  ): Promise<Settlement> {
    const s = await lockSettlement(manager, tenantId, id);
    if (s.status !== 'DRAFT') {
      throw new ConflictException(
        `${s.settlementNumber} is ${s.status.toLowerCase()}; only a draft can be ${verb}`,
      );
    }
    return s;
  }

  /** Replaces the settlement's lines; returns the net they add up to. */
  private async writeLines(
    manager: EntityManager,
    s: Settlement,
    plans: LinePlan[],
  ): Promise<number> {
    const repo = manager.getRepository(SettlementLine);
    await repo.delete({ tenantId: s.tenantId, settlementId: s.id });
    if (plans.length) {
      await repo.save(
        plans.map((p, i) =>
          repo.create({
            tenantId: s.tenantId,
            settlementId: s.id,
            kind: p.kind,
            label: p.label,
            quantity: p.quantity,
            rate: p.rate,
            amount: round2(p.amount),
            sortOrder: i,
          }),
        ),
      );
    }
    return round2(plans.reduce((t, p) => t + p.amount, 0));
  }

  private async linesOf(manager: EntityManager, s: Settlement): Promise<SettlementLine[]> {
    const rows = await manager
      .getRepository(SettlementLine)
      .find({ where: { tenantId: s.tenantId, settlementId: s.id } });
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  private assertCanApprove(actor: PayrollActor): void {
    if (!actor.permissions.includes(PERMISSIONS.PAYROLL_APPROVE)) {
      throw new ForbiddenException(
        'You do not have permission to approve or void settlements.',
      );
    }
  }

  private toDto(s: Settlement, lines: SettlementLine[]): SettlementDto {
    return {
      id: s.id,
      settlementNumber: s.settlementNumber,
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      leavingDate: s.leavingDate,
      reason: s.reason,
      serviceDays: s.serviceDays,
      basic: s.basic,
      gross: s.gross,
      leaveBalanceDays: s.leaveBalanceDays,
      status: s.status,
      netPay: s.netPay,
      paymentMethod: s.paymentMethod,
      financeAccountId: s.financeAccountId,
      paidAt: iso(s.paidAt),
      approvedAt: iso(s.approvedAt),
      journalEntryId: s.journalEntryId,
      lines: [...lines]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => ({
          id: l.id,
          kind: l.kind,
          label: l.label,
          quantity: l.quantity,
          rate: l.rate,
          amount: l.amount,
        })),
      createdAt: iso(s.createdAt)!,
      updatedAt: iso(s.updatedAt)!,
    };
  }
}
