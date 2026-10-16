import { Injectable } from '@nestjs/common';
import { Between, In, IsNull, type EntityManager } from 'typeorm';
import {
  allocateAbsorption,
  labourCost,
  labourRate,
  LEDGER_ROLES,
  periodBounds,
  round2,
  standardHours,
  type JournalLineInput,
} from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { PayrollSettings } from '../payroll/entities/payroll-settings.entity';
import {
  PayrollRun,
  PayrollRunLine,
} from '../payroll/entities/payroll-run.entity';
import { periodLabel } from '../payroll/payroll-runs.service';
import { WorkOrder } from '../production/entities/work-order.entity';
import { TimesheetEntry } from './entities/timesheet-entry.entity';
import { WorkOrderLabour } from './entities/work-order-labour.entity';
import { JobCostService } from './job-cost.service';

/** `payroll_settings.monthly_standard_hours` when a tenant has no row (PayrollSettingsService DEFAULTS). */
const DEFAULT_MONTHLY_STANDARD_HOURS = 208;

/** A line whose direct hours were not (fully) charged to jobs: cost ≤ 0, or hours on a cancelled job. */
export const LABOUR_NOT_ABSORBED_FLAG = 'LABOUR_NOT_ABSORBED';

export interface PreparedAbsorption {
  total: number;
  journal: {
    workOrderId: string;
    woNumber: string;
    account: 'WIP' | 'COGS';
    amount: number;
  }[];
  rows: Omit<
    WorkOrderLabour,
    'id' | 'createdAt' | 'journalEntryId' | 'clearedTo' | 'clearedAt'
  >[];
  /** Entry id → the run line that absorbs it. */
  stampEntryIds: Map<string, string>;
  /** COMPLETE work orders whose entries this approval stamps (J7: even at 0). */
  completedWorkOrderIds: string[];
}

const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const todayUtc = () => dayToDate(new Date().toISOString().slice(0, 10));
const unique = <T>(xs: T[]) => [...new Set(xs)];

/**
 * Payroll's approval charges each employee's timesheet hours to jobs at what
 * the month actually cost (Dr WIP for an open job, Dr COGS for a completed
 * one / Cr 6390 Labour absorbed); the void takes each amount back from where
 * it sits now.
 *
 * Callers hold the run row, `lockGratuityOpening` and `lockJobCosting`, in
 * that order; this locks the touched work order rows (sorted by id) and reads
 * the timesheet entries only under those locks.
 */
@Injectable()
export class LabourAbsorptionService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly jobCost: JobCostService,
  ) {}

  /**
   * Works out the absorption and writes each line's `standardHours`,
   * `loggedHours`, `directHours`, `labourRate`, `labourAbsorbed` (and the
   * not-absorbed flag) in memory; the caller persists the lines.
   */
  async prepare(
    manager: EntityManager,
    tenantId: string,
    run: PayrollRun,
    lines: PayrollRunLine[],
  ): Promise<PreparedAbsorption> {
    const { first, last } = periodBounds(run.period);
    const settings = await manager
      .getRepository(PayrollSettings)
      .findOne({ where: { tenantId } });
    const monthlyStandardHours =
      settings?.monthlyStandardHours ?? DEFAULT_MONTHLY_STANDARD_HOURS;

    const employeeIds = unique(lines.map((l) => l.employeeId));
    // Entries another posted run already absorbed are not this run's.
    const entries = employeeIds.length
      ? (
          await manager.getRepository(TimesheetEntry).find({
            where: {
              tenantId,
              employeeId: In(employeeIds),
              workDate: Between(first, last),
            },
          })
        ).filter((e) => e.runLineId == null)
      : [];

    const workOrders = await this.lockWorkOrders(
      manager,
      tenantId,
      entries.flatMap((e) =>
        e.operationId && e.workOrderId ? [e.workOrderId] : [],
      ),
    );
    const woById = new Map(workOrders.map((w) => [w.id, w]));
    const absorbable = (e: TimesheetEntry) => {
      if (!e.operationId || !e.workOrderId) return false;
      const wo = woById.get(e.workOrderId);
      return !!wo && wo.status !== 'CANCELLED';
    };

    const prepared: PreparedAbsorption = {
      total: 0,
      journal: [],
      rows: [],
      stampEntryIds: new Map(),
      completedWorkOrderIds: [],
    };
    const byWorkOrder = new Map<string, number>();
    const completed = new Set<string>();

    for (const line of lines) {
      const mine = entries.filter((e) => e.employeeId === line.employeeId);
      const direct = mine.filter((e) => e.operationId);
      const logged = round2(mine.reduce((s, e) => s + e.hours, 0));
      const directHours = round2(direct.reduce((s, e) => s + e.hours, 0));
      const std = standardHours({
        daysEmployed: line.daysEmployed,
        daysInMonth: line.daysInMonth,
        monthlyStandardHours,
        overtimeHours: line.overtimeHours ?? 0,
        overtimeHoursPremium: line.overtimeHoursPremium ?? 0,
      });
      const cost = labourCost({
        salaryCost: line.salaryCost,
        pensionEmployer: line.pensionEmployer ?? 0,
        gratuityAccrual: line.gratuityAccrual ?? 0,
        leaveProvisionChange: line.leaveProvisionChange ?? 0,
      });
      const rate = labourRate({
        cost,
        standardHours: std,
        loggedHours: logged,
      });
      const charged = direct.filter(absorbable);
      const amounts = allocateAbsorption(charged, rate, Math.max(cost, 0));
      const absorbed = round2([...amounts.values()].reduce((s, a) => s + a, 0));

      line.standardHours = std;
      line.loggedHours = logged;
      line.directHours = directHours;
      line.labourRate = rate;
      line.labourAbsorbed = absorbed;
      const flags = (line.flags ?? []).filter(
        (f) => f !== LABOUR_NOT_ABSORBED_FLAG,
      );
      if (directHours > 0 && (cost <= 0 || charged.length < direct.length)) {
        flags.push(LABOUR_NOT_ABSORBED_FLAG);
      }
      line.flags = flags;

      // One row per (work order, employee): this line is one employee.
      const perWorkOrder = new Map<string, { hours: number; amount: number }>();
      for (const e of charged) {
        const g = perWorkOrder.get(e.workOrderId!) ?? { hours: 0, amount: 0 };
        g.hours = round2(g.hours + e.hours);
        g.amount = round2(g.amount + (amounts.get(e.id) ?? 0));
        perWorkOrder.set(e.workOrderId!, g);
      }
      for (const [workOrderId, g] of perWorkOrder) {
        if (g.amount === 0) continue;
        const wo = woById.get(workOrderId)!;
        prepared.rows.push({
          tenantId,
          workOrderId,
          employeeId: line.employeeId,
          runId: run.id,
          runLineId: line.id,
          period: run.period,
          hours: g.hours,
          rate,
          amount: g.amount,
          account: wo.status === 'COMPLETE' ? 'COGS' : 'WIP',
        });
        byWorkOrder.set(
          workOrderId,
          round2((byWorkOrder.get(workOrderId) ?? 0) + g.amount),
        );
      }

      // Direct and indirect alike; hours on a cancelled job stay unstamped.
      for (const e of mine) {
        if (e.operationId && !absorbable(e)) continue;
        prepared.stampEntryIds.set(e.id, line.id);
        const wo = e.workOrderId ? woById.get(e.workOrderId) : undefined;
        if (wo?.status === 'COMPLETE') completed.add(wo.id);
      }
    }

    for (const [workOrderId, amount] of [...byWorkOrder].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const wo = woById.get(workOrderId)!;
      prepared.journal.push({
        workOrderId,
        woNumber: wo.woNumber,
        account: wo.status === 'COMPLETE' ? 'COGS' : 'WIP',
        amount,
      });
    }
    prepared.total = round2(prepared.journal.reduce((s, j) => s + j.amount, 0));
    prepared.completedWorkOrderIds = [...completed].sort();
    return prepared;
  }

  /**
   * Posts `JE-<run>-LAB`, writes the `work_order_labour` rows, stamps the
   * entries and recomputes the completed jobs they sit on. The journal and
   * rows are skipped when nothing was absorbed; the stamps never are.
   */
  async post(
    manager: EntityManager,
    tenantId: string,
    run: PayrollRun,
    prepared: PreparedAbsorption,
    entryDate: Date,
  ): Promise<string | null> {
    let journalEntryId: string | null = null;
    if (prepared.total > 0) {
      const label = periodLabel(run.period);
      const input: JournalLineInput[] = [
        ...prepared.journal.map((j): JournalLineInput => ({
          role: j.account === 'COGS' ? LEDGER_ROLES.COGS : LEDGER_ROLES.WIP,
          accountName:
            j.account === 'COGS' ? 'Cost of goods sold' : 'Work in progress',
          debit: j.amount,
          credit: 0,
          description: `${j.woNumber} labour ${label}`,
        })),
        {
          role: LEDGER_ROLES.LABOUR_ABSORBED,
          accountName: 'Labour absorbed',
          debit: 0,
          credit: prepared.total,
          description: `Payroll ${run.runNumber} labour charged to jobs`,
        },
      ];
      const resolved = await this.ledger.resolveLines(tenantId, input, manager);
      const entries = manager.getRepository(JournalEntry);
      const entry = await entries.save(
        entries.create({
          tenantId,
          entryNumber: `JE-${run.runNumber}-LAB`,
          referenceType: 'PAYROLL',
          referenceId: run.id,
          entryDate,
          totalAmount: prepared.total,
          currency: await baseCurrencyFor(manager, tenantId),
          fxRate: 1,
          lines: resolved,
        }),
      );
      journalEntryId = entry.id;

      const rowRepo = manager.getRepository(WorkOrderLabour);
      await rowRepo.save(
        prepared.rows.map((r) =>
          rowRepo.create({
            ...r,
            journalEntryId: entry.id,
            clearedTo: null,
            clearedAt: null,
          }),
        ),
      );
    }

    const byLine = new Map<string, string[]>();
    for (const [entryId, lineId] of prepared.stampEntryIds) {
      byLine.set(lineId, [...(byLine.get(lineId) ?? []), entryId]);
    }
    for (const [runLineId, ids] of byLine) {
      await manager
        .getRepository(TimesheetEntry)
        .update({ tenantId, id: In(ids) }, { runLineId });
    }

    await this.jobCost.recompute(
      manager,
      tenantId,
      prepared.completedWorkOrderIds,
    );
    return journalEntryId;
  }

  /**
   * Takes each absorbed amount back from where it sits now (J10:
   * `JE-<run>-LAB-VOID`, beside the payroll's exact reversal): WIP while the
   * job is open, COGS once booked or cleared there. Rows a cancel already
   * returned to 6390 are skipped. Then deletes the rows, unstamps the
   * entries and recomputes the completed jobs they touched.
   */
  async reverse(
    manager: EntityManager,
    tenantId: string,
    run: PayrollRun,
  ): Promise<string | null> {
    const lineIds = (
      await manager
        .getRepository(PayrollRunLine)
        .find({ where: { tenantId, runId: run.id } })
    ).map((l) => l.id);
    const rowRepo = manager.getRepository(WorkOrderLabour);
    const rows = await rowRepo.find({ where: { tenantId, runId: run.id } });
    const stamped = lineIds.length
      ? await manager
          .getRepository(TimesheetEntry)
          .find({ where: { tenantId, runLineId: In(lineIds) } })
      : [];
    const workOrders = await this.lockWorkOrders(manager, tenantId, [
      ...rows.map((r) => r.workOrderId),
      ...stamped.flatMap((e) => e.workOrderId ?? []),
    ]);
    const woById = new Map(workOrders.map((w) => [w.id, w]));

    // Per (work order, account): the credits that take the labour back.
    const credits = new Map<
      string,
      { woId: string; cogs: boolean; amount: number }
    >();
    for (const r of rows) {
      if (r.clearedTo === 'EXPENSE') continue;
      const cogs = r.account === 'COGS' || r.clearedTo === 'COGS';
      const key = `${r.workOrderId}:${cogs ? 'COGS' : 'WIP'}`;
      const c = credits.get(key) ?? { woId: r.workOrderId, cogs, amount: 0 };
      c.amount = round2(c.amount + r.amount);
      credits.set(key, c);
    }
    const total = round2(
      [...credits.values()].reduce((s, c) => s + c.amount, 0),
    );

    let voidEntryId: string | null = null;
    if (total > 0) {
      const entries = manager.getRepository(JournalEntry);
      const original = run.labourJournalEntryId
        ? await entries.findOne({
            where: { id: run.labourJournalEntryId, tenantId },
          })
        : null;
      const label = periodLabel(run.period);
      const input: JournalLineInput[] = [
        {
          role: LEDGER_ROLES.LABOUR_ABSORBED,
          accountName: 'Labour absorbed',
          debit: total,
          credit: 0,
          description: `Void of payroll ${run.runNumber} labour charged to jobs`,
        },
        ...[...credits.values()]
          .sort(
            (a, b) =>
              a.woId.localeCompare(b.woId) || Number(a.cogs) - Number(b.cogs),
          )
          .map((c): JournalLineInput => ({
            role: c.cogs ? LEDGER_ROLES.COGS : LEDGER_ROLES.WIP,
            accountName: c.cogs ? 'Cost of goods sold' : 'Work in progress',
            debit: 0,
            credit: c.amount,
            description: `${woById.get(c.woId)?.woNumber ?? 'Work order'} labour ${label} voided`,
          })),
      ];
      const resolved = await this.ledger.resolveLines(tenantId, input, manager);
      const reversal = await entries.save(
        entries.create({
          tenantId,
          entryNumber: `JE-${run.runNumber}-LAB-VOID`,
          referenceType: 'PAYROLL',
          referenceId: run.id,
          // Never before the entry it reverses.
          entryDate: new Date(
            Math.max(
              todayUtc().getTime(),
              original ? new Date(original.entryDate).getTime() : 0,
            ),
          ),
          totalAmount: total,
          currency:
            original?.currency ?? (await baseCurrencyFor(manager, tenantId)),
          fxRate: 1,
          lines: resolved,
        }),
      );
      voidEntryId = reversal.id;
    }

    if (rows.length) await rowRepo.delete({ tenantId, runId: run.id });
    if (stamped.length) {
      await manager
        .getRepository(TimesheetEntry)
        .update({ tenantId, runLineId: In(lineIds) }, { runLineId: null });
    }
    // recompute leaves anything not COMPLETE alone.
    await this.jobCost.recompute(
      manager,
      tenantId,
      workOrders.map((w) => w.id),
    );
    return voidEntryId;
  }

  /**
   * The labour absorbed into WIP for a work order and not moved on yet: what
   * completion takes to COGS and cancellation returns to 6390. Callers hold
   * `lockJobCosting` and the work order row.
   */
  async wipLabour(
    manager: EntityManager,
    tenantId: string,
    workOrderId: string,
  ): Promise<{ ids: string[]; amount: number }> {
    const rows = await manager.getRepository(WorkOrderLabour).find({
      where: { tenantId, workOrderId, account: 'WIP', clearedTo: IsNull() },
    });
    return {
      ids: rows.map((r) => r.id).sort(),
      amount: round2(rows.reduce((s, r) => s + r.amount, 0)),
    };
  }

  /** Records where the rows' WIP labour went; writes only those two columns. */
  async clear(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
    to: 'COGS' | 'EXPENSE',
  ): Promise<void> {
    if (!ids.length) return;
    await manager
      .getRepository(WorkOrderLabour)
      .update(
        { tenantId, id: In(ids) },
        { clearedTo: to, clearedAt: new Date() },
      );
  }

  /** The work order rows, `FOR UPDATE`, in id order. */
  private async lockWorkOrders(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<WorkOrder[]> {
    const sorted = unique(ids).sort();
    if (!sorted.length) return [];
    return manager.getRepository(WorkOrder).find({
      where: { tenantId, id: In(sorted) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }
}
