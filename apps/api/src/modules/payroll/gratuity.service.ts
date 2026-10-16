import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  gratuityEntitlement,
  LEDGER_ROLES,
  periodBounds,
  round2,
  type EmployeeGratuityDto,
  type GratuityAdjustmentPayload,
  type GratuityLedgerEntryDto,
  type JournalLineInput,
  type OpeningGratuityPreviewDto,
  type PostOpeningGratuityPayload,
} from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { Employee } from './entities/employee.entity';
import { PayrollRun } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { EmployeesService } from './employees.service';
import { POSTED_RUN_STATUSES, postedRunLines } from './advances.service';

const today = () => new Date().toISOString().slice(0, 10);
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * The tenant's gratuity lock, held to the end of the caller's transaction.
 * Opening posts take it so two cannot both pass "no OPENING row yet";
 * approval and void take it so they never read a balance or cut-over that
 * another of them is about to change.
 */
export async function lockGratuityOpening(
  manager: EntityManager,
  tenantId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `gratuity-opening:${tenantId}`,
  ]);
}

/** 'YYYY-MM' of the month before `period`. */
function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

function toEntryDto(r: GratuityLedgerEntry): GratuityLedgerEntryDto {
  return {
    id: r.id,
    kind: r.kind as GratuityLedgerEntryDto['kind'],
    amount: r.amount,
    asOf: r.asOf,
    runLineId: r.runLineId,
    note: r.note,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

/**
 * The end-of-service provision, per employee, as an append-only ledger.
 * Balance = Σ amount; the monthly run trues it up to the entitlement.
 */
@Injectable()
export class GratuityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly employees: EmployeesService,
  ) {}

  async balance(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
  ): Promise<number> {
    const rows = await manager
      .getRepository(GratuityLedgerEntry)
      .find({ where: { tenantId, employeeId } });
    return round2(rows.reduce((s, r) => s + r.amount, 0));
  }

  /**
   * Unpaid leave on posted runs whose month ended by `asOf`, plus `extraDays`
   * (the run being approved, which is not posted yet).
   */
  async unpaidLeaveDaysTo(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    asOf: string,
    extraDays = 0,
  ): Promise<number> {
    const lines = await postedRunLines(manager, tenantId, employeeId);
    const days = lines
      .filter(({ run }) => periodBounds(run.period).last <= asOf)
      .reduce((s, { line }) => s + (line.unpaidLeaveDays ?? 0), 0);
    return round2(days + extraDays);
  }

  /**
   * What the employee has earned by `asOf`, on the basic in force that day.
   * Service stops at the leaving date.
   */
  async entitlement(
    manager: EntityManager,
    tenantId: string,
    employee: Employee,
    asOf: string,
    extraUnpaidDays = 0,
  ): Promise<{ serviceDays: number; amount: number; basic: number }> {
    const day =
      employee.leavingDate && employee.leavingDate < asOf
        ? employee.leavingDate
        : asOf;
    const pkg = await this.employees.packageAt(manager, tenantId, employee.id, day);
    const basic = pkg?.basic ?? 0;
    const unpaidLeaveDays = await this.unpaidLeaveDaysTo(
      manager,
      tenantId,
      employee.id,
      day,
      extraUnpaidDays,
    );
    const got = gratuityEntitlement({
      joiningDate: employee.joiningDate,
      asOf: day,
      basic,
      unpaidLeaveDays,
      isNational: employee.isNational,
    });
    return { serviceDays: got.serviceDays, amount: got.amount, basic };
  }

  async summary(tenantId: string, employeeId: string): Promise<EmployeeGratuityDto> {
    const manager = this.dataSource.manager;
    const employee = await this.loadEmployee(manager, tenantId, employeeId);
    const rows = await manager
      .getRepository(GratuityLedgerEntry)
      .find({ where: { tenantId, employeeId } });
    const now = await this.entitlement(manager, tenantId, employee, today());
    return {
      balance: round2(rows.reduce((s, r) => s + r.amount, 0)),
      entitlementToday: now.amount,
      serviceDaysToday: now.serviceDays,
      entries: rows
        .sort(
          (a, b) =>
            b.asOf.localeCompare(a.asOf) ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .map(toEntryDto),
    };
  }

  /** The go-live cut-over: the latest OPENING `asOf`, or null before go-live. */
  async latestCutover(
    manager: EntityManager,
    tenantId: string,
  ): Promise<string | null> {
    const rows = await manager
      .getRepository(GratuityLedgerEntry)
      .find({ where: { tenantId, kind: 'OPENING' } });
    let max: string | null = null;
    for (const r of rows) if (!max || r.asOf > max) max = r.asOf;
    return max;
  }

  async previewOpening(
    tenantId: string,
    cutoverDate?: string,
  ): Promise<OpeningGratuityPreviewDto> {
    const manager = this.dataSource.manager;
    const cutover = cutoverDate ?? (await this.defaultCutover(manager, tenantId));
    const eligible = await this.eligibleForOpening(manager, tenantId, cutover);
    const lines: OpeningGratuityPreviewDto['lines'] = [];
    for (const e of eligible) {
      const got = await this.entitlement(manager, tenantId, e, cutover);
      lines.push({
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName}`,
        joiningDate: e.joiningDate,
        basic: got.basic,
        serviceDays: got.serviceDays,
        calculated: got.amount,
      });
    }
    return { cutoverDate: cutover, lines };
  }

  /**
   * Books the provision employees had already earned at go-live:
   * Dr opening balance equity / Cr end-of-service provision, one entry for
   * the total, one OPENING row per employee (zero rows included, so the
   * employee is marked as set up).
   */
  async postOpening(
    tenantId: string,
    actorId: string,
    input: PostOpeningGratuityPayload,
  ): Promise<{ journalEntryId: string | null; total: number }> {
    void actorId; // the audit trail records who
    return this.dataSource.transaction(async (manager) => {
      // Serialises opening posts per tenant, so two at once cannot both pass
      // the "no OPENING row yet" check.
      await lockGratuityOpening(manager, tenantId);
      const cutover = input.cutoverDate;

      const runs = await manager
        .getRepository(PayrollRun)
        .find({ where: { tenantId } });
      if (
        runs.some(
          (r) =>
            POSTED_RUN_STATUSES.includes(r.status) &&
            periodBounds(r.period).last <= cutover,
        )
      ) {
        throw new ConflictException('Runs already posted for or before the cut-over');
      }

      const ids = input.lines.map((l) => l.employeeId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException('Each employee can appear only once');
      }
      const opened = new Set(
        (
          await manager
            .getRepository(GratuityLedgerEntry)
            .find({ where: { tenantId, kind: 'OPENING' } })
        ).map((r) => r.employeeId),
      );
      const employees = new Map<string, Employee>();
      for (const id of ids) {
        const e = await manager
          .getRepository(Employee)
          .findOne({ where: { id, tenantId } });
        if (!e || e.status === 'LEFT' || e.joiningDate > cutover) {
          throw new BadRequestException(
            `${e ? `${e.firstName} ${e.lastName}` : 'An employee'} does not qualify for an opening balance at ${cutover}`,
          );
        }
        if (opened.has(id)) {
          throw new ConflictException(
            `${e.firstName} ${e.lastName} already has an opening gratuity balance`,
          );
        }
        employees.set(id, e);
      }

      const total = round2(input.lines.reduce((s, l) => s + l.amount, 0));
      let journalEntryId: string | null = null;
      if (total > 0) {
        const entry = await this.post(manager, tenantId, {
          amount: total,
          entryNumber: `JE-GRAT-OPEN-${cutover}-${randomUUID().slice(0, 8)}`,
          referenceId: `gratuity-opening:${cutover}`,
          entryDate: dayToDate(cutover),
          description: `End-of-service provision at go-live (${cutover})`,
        });
        journalEntryId = entry.id;
      }

      const repo = manager.getRepository(GratuityLedgerEntry);
      await repo.save(
        input.lines.map((l) =>
          repo.create({
            tenantId,
            employeeId: l.employeeId,
            kind: 'OPENING',
            amount: round2(l.amount),
            asOf: cutover,
            runLineId: null,
            journalEntryId,
            note: null,
          }),
        ),
      );
      // A zero total posts no journal, hence a null id.
      return { journalEntryId, total };
    });
  }

  /** A correction after go-live: Dr/Cr opening balance equity ↔ provision. */
  async adjust(
    tenantId: string,
    employeeId: string,
    actorId: string,
    input: GratuityAdjustmentPayload,
  ): Promise<GratuityLedgerEntryDto> {
    void actorId; // the audit trail records who
    return this.dataSource.transaction(async (manager) => {
      const employee = await this.loadEmployee(manager, tenantId, employeeId);
      const amount = round2(input.amount);
      if (amount === 0) throw new BadRequestException('Amount cannot be zero');
      const id = randomUUID();
      const entry = await this.post(manager, tenantId, {
        amount,
        entryNumber: `JE-GRAT-ADJ-${employee.employeeNumber}-${id.slice(0, 8)}`,
        referenceId: `gratuity-adjustment:${id}`,
        entryDate: new Date(),
        description: `End-of-service provision adjustment for ${employee.firstName} ${employee.lastName}: ${input.note}`,
      });
      const repo = manager.getRepository(GratuityLedgerEntry);
      const saved = await repo.save(
        repo.create({
          id,
          tenantId,
          employeeId,
          kind: 'ADJUSTMENT',
          amount,
          asOf: today(),
          runLineId: null,
          journalEntryId: entry.id,
          note: input.note,
        }),
      );
      return toEntryDto(saved);
    });
  }

  /**
   * Posts a signed movement in the provision against opening balance equity.
   * Positive raises the provision (Dr equity / Cr provision); negative
   * lowers it.
   */
  private async post(
    manager: EntityManager,
    tenantId: string,
    p: {
      amount: number;
      entryNumber: string;
      referenceId: string;
      entryDate: Date;
      description: string;
    },
  ): Promise<JournalEntry> {
    const abs = round2(Math.abs(p.amount));
    const equity: JournalLineInput = {
      role: LEDGER_ROLES.OPENING_BALANCE_EQUITY,
      accountName: 'Opening balance equity',
      debit: 0,
      credit: 0,
      description: p.description,
    };
    const provision: JournalLineInput = {
      role: LEDGER_ROLES.GRATUITY_PROVISION,
      accountName: 'End-of-service provision',
      debit: 0,
      credit: 0,
      description: p.description,
    };
    const input =
      p.amount > 0
        ? [
            { ...equity, debit: abs },
            { ...provision, credit: abs },
          ]
        : [
            { ...provision, debit: abs },
            { ...equity, credit: abs },
          ];
    const lines = await this.ledger.resolveLines(tenantId, input, manager);
    const repo = manager.getRepository(JournalEntry);
    return repo.save(
      repo.create({
        tenantId,
        entryNumber: p.entryNumber,
        referenceType: 'PAYROLL',
        referenceId: p.referenceId,
        entryDate: p.entryDate,
        totalAmount: abs,
        currency: await baseCurrencyFor(manager, tenantId),
        fxRate: 1,
        lines,
      }),
    );
  }

  /**
   * Last day of the month before the earliest non-voided run; with no runs,
   * the last day of last month (UTC).
   */
  private async defaultCutover(
    manager: EntityManager,
    tenantId: string,
  ): Promise<string> {
    const runs = await manager
      .getRepository(PayrollRun)
      .find({ where: { tenantId } });
    let earliest: string | null = null;
    for (const r of runs) {
      if (r.status === 'VOIDED') continue;
      if (!earliest || r.period < earliest) earliest = r.period;
    }
    return periodBounds(previousPeriod(earliest ?? today().slice(0, 7))).last;
  }

  private async eligibleForOpening(
    manager: EntityManager,
    tenantId: string,
    cutover: string,
  ): Promise<Employee[]> {
    const opened = new Set(
      (
        await manager
          .getRepository(GratuityLedgerEntry)
          .find({ where: { tenantId, kind: 'OPENING' } })
      ).map((r) => r.employeeId),
    );
    const rows = await manager
      .getRepository(Employee)
      .find({ where: { tenantId } });
    return rows
      .filter(
        (e) =>
          e.status !== 'LEFT' && e.joiningDate <= cutover && !opened.has(e.id),
      )
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
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
