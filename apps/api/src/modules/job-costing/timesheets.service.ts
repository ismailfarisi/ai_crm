import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Between, DataSource, EntityManager, In } from 'typeorm';
import {
  round2,
  type BulkTimesheetPayload,
  type CrewQueryPayload,
  type TimesheetEmployeeDto,
  type TimesheetEntryDto,
  type TimesheetEntryPayload,
  type TimesheetOperationOptionDto,
  type TimesheetQueryPayload,
  type UpdateTimesheetEntryPayload,
} from '@saas/shared';
import { POSTED_RUN_STATUSES } from '../payroll/advances.service';
import { periodLabel } from '../payroll/payroll-runs.service';
import { Employee } from '../payroll/entities/employee.entity';
import {
  WorkOrder,
  WorkOrderOperation,
} from '../production/entities/work-order.entity';
import { TimesheetEntry } from './entities/timesheet-entry.entity';
import { JobCostService } from './job-cost.service';
import { lockJobCosting } from './job-costing.lock';

/** The fields of an entry a user sets; the work order follows the operation. */
type EntryFields = Pick<
  TimesheetEntryPayload,
  | 'employeeId'
  | 'workDate'
  | 'hours'
  | 'operationId'
  | 'indirectCategory'
  | 'note'
>;
const ENTRY_FIELDS = [
  'employeeId',
  'workDate',
  'hours',
  'operationId',
  'indirectCategory',
  'note',
] as const satisfies readonly (keyof EntryFields)[];

interface Changes {
  creates: EntryFields[];
  updates: { id: string; patch: Partial<EntryFields> }[];
  deletes: string[];
}

/** How long a completed job stays on the timesheet operation picker. */
const COMPLETE_PICKABLE_DAYS = 62;
const MAX_DAY_HOURS = 24;

const employeeName = (e: Pick<Employee, 'firstName' | 'lastName'>) =>
  `${e.firstName} ${e.lastName}`;
const employedOn = (e: Employee, day: string) =>
  e.joiningDate <= day && (e.leavingDate == null || day <= e.leavingDate);
const postedKey = (employeeId: string, period: string) =>
  `${employeeId}|${period}`;

/**
 * Timesheets: hours per employee per day on a job operation or an indirect
 * category.
 *
 * An operation's `actual_minutes` stays the single total of time on it, so
 * every manual write moves it by the entry's hours. Hours are locked once the
 * employee's month has posted payroll (void the run to change them), refused
 * on cancelled or unreleased jobs, and capped at 24 a day per employee. Late
 * hours on a completed job rewrite its actual cost.
 */
@Injectable()
export class TimesheetsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobCost: JobCostService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Reads
   * ------------------------------------------------------------------ */

  async list(
    tenantId: string,
    q: TimesheetQueryPayload,
  ): Promise<TimesheetEntryDto[]> {
    const manager = this.dataSource.manager;
    const entries = await manager.getRepository(TimesheetEntry).find({
      where: {
        tenantId,
        workDate: Between(q.from, q.to),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      },
      order: { workDate: 'ASC', createdAt: 'ASC' },
    });
    return this.toDtos(manager, tenantId, entries);
  }

  /** Every entry on one work order on one day: the crew view. */
  async crew(
    tenantId: string,
    q: CrewQueryPayload,
  ): Promise<TimesheetEntryDto[]> {
    const manager = this.dataSource.manager;
    const entries = await manager.getRepository(TimesheetEntry).find({
      where: { tenantId, workOrderId: q.workOrderId, workDate: q.workDate },
      order: { createdAt: 'ASC' },
    });
    return this.toDtos(manager, tenantId, entries);
  }

  /** Names and numbers only, so `timesheet:read` needs no `employee:read`. */
  async employees(tenantId: string): Promise<TimesheetEmployeeDto[]> {
    const rows = await this.dataSource.manager.getRepository(Employee).find({
      where: { tenantId },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
    return rows.map((e) => ({
      id: e.id,
      employeeNumber: e.employeeNumber,
      name: employeeName(e),
      status: e.status,
      joiningDate: e.joiningDate,
      leavingDate: e.leavingDate,
      userId: e.userId,
    }));
  }

  /**
   * Operations hours can be booked to: on released and in-progress jobs, and
   * on jobs completed recently enough for a late timesheet. Skipped
   * operations never take hours.
   */
  async operations(tenantId: string): Promise<TimesheetOperationOptionDto[]> {
    const rows: {
      work_order_id: string;
      wo_number: string;
      wo_status: TimesheetOperationOptionDto['workOrderStatus'];
      description: string;
      operation_id: string;
      label: string;
      op_status: TimesheetOperationOptionDto['operationStatus'];
    }[] = await this.dataSource.manager.query(
      `SELECT wo."id" AS "work_order_id", wo."wo_number", wo."status" AS "wo_status",
              wo."description", op."id" AS "operation_id", op."label",
              op."status" AS "op_status"
         FROM "work_order_operations" op
         JOIN "work_orders" wo ON wo."id" = op."work_order_id"
        WHERE wo."tenant_id" = $1
          AND op."status" <> 'SKIPPED'
          AND (wo."status" IN ('RELEASED', 'IN_PROGRESS')
               OR (wo."status" = 'COMPLETE'
                   AND wo."completed_at" >= now() - make_interval(days => $2::int)))
        ORDER BY wo."wo_number", op."sequence"`,
      [tenantId, COMPLETE_PICKABLE_DAYS],
    );
    return rows.map((r) => ({
      workOrderId: r.work_order_id,
      woNumber: r.wo_number,
      workOrderStatus: r.wo_status,
      description: r.description,
      operationId: r.operation_id,
      operationLabel: r.label,
      operationStatus: r.op_status,
    }));
  }

  /* ------------------------------------------------------------------ *
   * Writes
   * ------------------------------------------------------------------ */

  async create(
    tenantId: string,
    actorId: string,
    input: TimesheetEntryPayload,
  ): Promise<TimesheetEntryDto> {
    return this.dataSource.transaction(async (manager) => {
      const { created } = await this.apply(manager, tenantId, actorId, {
        creates: [input],
        updates: [],
        deletes: [],
      });
      const [dto] = await this.toDtos(manager, tenantId, created);
      return dto;
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateTimesheetEntryPayload,
  ): Promise<TimesheetEntryDto> {
    return this.dataSource.transaction(async (manager) => {
      const { updated } = await this.apply(manager, tenantId, null, {
        creates: [],
        updates: [{ id, patch: input }],
        deletes: [],
      });
      const [dto] = await this.toDtos(manager, tenantId, updated);
      return dto;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.apply(manager, tenantId, null, {
        creates: [],
        updates: [],
        deletes: [id],
      }),
    );
  }

  /**
   * The grid and crew save: upserts (with `id` an edit, without a new entry)
   * and deletes in one transaction. Returns the upserts in the order sent.
   */
  async bulk(
    tenantId: string,
    actorId: string,
    input: BulkTimesheetPayload,
  ): Promise<TimesheetEntryDto[]> {
    const ids = [
      ...input.upserts.flatMap((u) => (u.id ? [u.id] : [])),
      ...input.deletes,
    ];
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'An entry appears more than once in this save',
      );
    }
    const pick = (u: BulkTimesheetPayload['upserts'][number]): EntryFields => ({
      employeeId: u.employeeId,
      workDate: u.workDate,
      hours: u.hours,
      operationId: u.operationId,
      indirectCategory: u.indirectCategory,
      note: u.note,
    });
    return this.dataSource.transaction(async (manager) => {
      const { created, updated } = await this.apply(
        manager,
        tenantId,
        actorId,
        {
          creates: input.upserts.filter((u) => !u.id).map(pick),
          updates: input.upserts
            .filter((u) => u.id)
            .map((u) => ({ id: u.id!, patch: pick(u) })),
          deletes: input.deletes,
        },
      );
      const byId = new Map(updated.map((e) => [e.id, e]));
      let next = 0;
      const ordered = input.upserts.map((u) =>
        u.id ? byId.get(u.id)! : created[next++],
      );
      return this.toDtos(manager, tenantId, ordered);
    });
  }

  /**
   * The shop-floor clock's entry for minutes it has just added to an
   * operation (`stopOperation`, `logTime`). Callers hold `lockJobCosting` and
   * the work order row.
   *
   * The floor is never blocked by accounting: when the entry cannot be written
   * (no linked employee, a posted month, a day outside employment, a full
   * day) this returns null and the minutes stay on the operation, unlinked.
   * The minutes are already on the operation, so they are not added again.
   */
  async recordClock(
    manager: EntityManager,
    tenantId: string,
    a: {
      userId: string;
      workOrderId: string;
      operationId: string;
      minutes: number;
      workDate: string;
    },
  ): Promise<TimesheetEntry | null> {
    const employee = await manager
      .getRepository(Employee)
      .findOne({ where: { tenantId, userId: a.userId } });
    if (!employee) return null;
    const hours = round2(a.minutes / 60);
    if (hours <= 0 || !employedOn(employee, a.workDate)) return null;
    if (
      await this.isPosted(
        manager,
        tenantId,
        employee.id,
        a.workDate.slice(0, 7),
      )
    ) {
      return null;
    }
    const day = await this.dayHours(manager, tenantId, employee.id, a.workDate);
    if (round2(day + hours) > MAX_DAY_HOURS) return null;

    const repo = manager.getRepository(TimesheetEntry);
    return repo.save(
      repo.create({
        tenantId,
        employeeId: employee.id,
        workDate: a.workDate,
        hours,
        workOrderId: a.workOrderId,
        operationId: a.operationId,
        indirectCategory: null,
        source: 'CLOCK',
        note: null,
        runLineId: null,
        createdById: a.userId,
      }),
    );
  }

  /** The posted (approved, not voided) run covering an employee's month. */
  async isPosted(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    period: string,
  ): Promise<{ runNumber: string } | null> {
    const rows: { run_number: string }[] = await manager.query(
      `SELECT r."run_number" FROM "payroll_run_lines" l
         JOIN "payroll_runs" r ON r."id" = l."run_id"
        WHERE l."tenant_id" = $1 AND l."employee_id" = $2
          AND r."period" = $3 AND r."status" = ANY($4)`,
      [tenantId, employeeId, period, [...POSTED_RUN_STATUSES]],
    );
    return rows.length ? { runNumber: rows[0].run_number } : null;
  }

  /* ------------------------------------------------------------------ *
   * The one write path
   * ------------------------------------------------------------------ */

  /**
   * Applies deletes, updates and creates, moving operation minutes with them.
   * Any refusal throws and the caller's transaction rolls everything back.
   *
   * Lock order: `lockJobCosting` (first statement, which also serialises
   * every timesheet write of the tenant, so the daily cap cannot race) →
   * the touched work order rows, sorted by id.
   */
  private async apply(
    manager: EntityManager,
    tenantId: string,
    actorId: string | null,
    changes: Changes,
  ): Promise<{ created: TimesheetEntry[]; updated: TimesheetEntry[] }> {
    await lockJobCosting(manager, tenantId);
    const entryRepo = manager.getRepository(TimesheetEntry);

    // 1. The entries being edited or deleted.
    const touchedIds = [
      ...changes.updates.map((u) => u.id),
      ...changes.deletes,
    ];
    const existing = touchedIds.length
      ? await entryRepo.find({ where: { tenantId, id: In(touchedIds) } })
      : [];
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const id of touchedIds) {
      if (!byId.has(id))
        throw new NotFoundException('Timesheet entry not found');
    }
    // An edit that changes nothing is not a write: a grid save resending a
    // locked cell unchanged must not be refused.
    const updates = changes.updates
      .map((u) => {
        const before = byId.get(u.id)!;
        const prev = pickFields(before);
        const after: EntryFields = { ...prev, ...u.patch };
        return { before, prev, after };
      })
      .filter(({ prev, after }) =>
        ENTRY_FIELDS.some((k) => prev[k] !== after[k]),
      );
    const deletes = changes.deletes.map((id) => byId.get(id)!);

    // 2. The operations hours go to, and every work order touched.
    const afters = [...updates.map((u) => u.after), ...changes.creates];
    const opIds = unique(
      afters.flatMap((a) => (a.operationId ? [a.operationId] : [])),
    );
    const ops = opIds.length
      ? await manager
          .getRepository(WorkOrderOperation)
          .find({ where: { tenantId, id: In(opIds) } })
      : [];
    let opById = new Map(ops.map((o) => [o.id, o]));
    for (const id of opIds) {
      if (!opById.has(id)) {
        throw new NotFoundException('That operation is not on a work order');
      }
    }
    const workOrderOf = (a: EntryFields) =>
      a.operationId ? opById.get(a.operationId)!.workOrderId : null;
    const woIds = unique([
      ...afters.flatMap((a) => workOrderOf(a) ?? []),
      ...[...updates.map((u) => u.before), ...deletes].flatMap(
        (e) => e.workOrderId ?? [],
      ),
    ]).sort();
    const workOrders = woIds.length
      ? await manager
          .getRepository(WorkOrder)
          .createQueryBuilder('wo')
          .setLock('pessimistic_write')
          .where('wo.id IN (:...ids)', { ids: woIds })
          .andWhere('wo.tenant_id = :tenantId', { tenantId })
          .orderBy('wo.id')
          .getMany()
      : [];
    const woById = new Map(workOrders.map((w) => [w.id, w]));
    // Re-read the operations under the work order locks: a concurrent skip
    // must not let this write add minutes to a SKIPPED operation.
    if (opIds.length) {
      const locked = await manager
        .getRepository(WorkOrderOperation)
        .find({ where: { tenantId, id: In(opIds) } });
      opById = new Map(locked.map((o) => [o.id, o]));
    }

    // 3. Refusals: the hours taken away, then the hours written.
    const posted = new Map<string, { runNumber: string } | null>();
    const assertOpen = async (employeeId: string, day: string) => {
      const period = day.slice(0, 7);
      const key = postedKey(employeeId, period);
      if (!posted.has(key)) {
        posted.set(
          key,
          await this.isPosted(manager, tenantId, employeeId, period),
        );
      }
      const run = posted.get(key);
      if (run) {
        throw new ConflictException(
          `Payroll for ${periodLabel(period)} is posted (${run.runNumber}); void the run to change this entry`,
        );
      }
    };
    for (const e of [...deletes, ...updates.map((u) => u.before)]) {
      await assertOpen(e.employeeId, e.workDate);
      const wo = e.workOrderId ? woById.get(e.workOrderId) : null;
      if (wo?.status === 'CANCELLED') {
        throw new ConflictException(`${wo.woNumber} is cancelled`);
      }
    }
    const empIds = unique(afters.map((a) => a.employeeId));
    const employees = empIds.length
      ? await manager
          .getRepository(Employee)
          .find({ where: { tenantId, id: In(empIds) } })
      : [];
    const empById = new Map(employees.map((e) => [e.id, e]));
    for (const a of afters) {
      const employee = empById.get(a.employeeId);
      if (!employee) throw new NotFoundException('Employee not found');
      if (!employedOn(employee, a.workDate)) {
        throw new BadRequestException(
          `${employeeName(employee)} was not employed on ${a.workDate}`,
        );
      }
      await assertOpen(a.employeeId, a.workDate);
      if (!a.operationId) continue;
      const op = opById.get(a.operationId)!;
      const wo = woById.get(op.workOrderId);
      if (!wo)
        throw new NotFoundException('That operation is not on a work order');
      if (wo.status === 'PLANNED') {
        throw new BadRequestException(
          `${wo.woNumber} has not been released to the floor yet`,
        );
      }
      if (wo.status === 'CANCELLED') {
        throw new ConflictException(`${wo.woNumber} is cancelled`);
      }
      if (op.status === 'SKIPPED') {
        throw new BadRequestException(`"${op.label}" was skipped`);
      }
    }

    // 4. Write the entries, owned columns only.
    if (deletes.length) {
      await entryRepo.delete({ tenantId, id: In(deletes.map((e) => e.id)) });
    }
    const changed = new Map<string, TimesheetEntry>();
    // An edit keeps the entry's creator and source (a CLOCK entry stays one).
    for (const { before, prev, after } of updates) {
      const patch: Partial<TimesheetEntry> = {};
      for (const k of ENTRY_FIELDS) {
        if (prev[k] !== after[k]) Object.assign(patch, { [k]: after[k] });
      }
      const workOrderId = workOrderOf(after);
      if (workOrderId !== before.workOrderId) patch.workOrderId = workOrderId;
      await entryRepo.update({ tenantId, id: before.id }, patch);
      // A copy: `before` still drives the minute deltas below.
      changed.set(before.id, { ...before, ...patch });
    }
    const created: TimesheetEntry[] = [];
    for (const a of changes.creates) {
      created.push(
        await entryRepo.save(
          entryRepo.create({
            tenantId,
            ...a,
            workOrderId: workOrderOf(a),
            source: 'MANUAL',
            runLineId: null,
            createdById: actorId,
          }),
        ),
      );
    }

    // 5. Move the operations' minutes by the hours moved.
    const deltas = new Map<string, number>();
    const add = (opId: string | null, hours: number) => {
      if (opId) deltas.set(opId, (deltas.get(opId) ?? 0) + hours * 60);
    };
    for (const e of deletes) add(e.operationId, -Number(e.hours));
    for (const { before, prev, after } of updates) {
      add(before.operationId, -prev.hours);
      add(after.operationId, after.hours);
    }
    for (const a of changes.creates) add(a.operationId, a.hours);
    const started = new Set<string>();
    for (const [opId, raw] of [...deltas].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const delta = round2(raw);
      if (delta === 0) continue;
      await this.moveMinutes(manager, tenantId, opId, delta);
      if (delta > 0) {
        const woId = opById.get(opId)?.workOrderId;
        if (woId) started.add(woId);
      }
    }
    // Mirrors ProductionService.logTime/markInProgress (job costing cannot
    // import production): a released job receiving time is in progress.
    for (const woId of [...started].sort()) {
      const wo = woById.get(woId)!;
      if (wo.status !== 'RELEASED') continue;
      await manager
        .getRepository(WorkOrder)
        .update(
          { tenantId, id: woId, status: 'RELEASED' },
          { status: 'IN_PROGRESS' },
        );
      wo.status = 'IN_PROGRESS';
    }

    // 6. The daily cap, on everything now saved.
    const days = new Map<string, EntryFields>();
    for (const a of afters) days.set(`${a.employeeId}|${a.workDate}`, a);
    for (const a of days.values()) {
      const total = await this.dayHours(
        manager,
        tenantId,
        a.employeeId,
        a.workDate,
      );
      if (total > MAX_DAY_HOURS) {
        throw new UnprocessableEntityException(
          `${employeeName(empById.get(a.employeeId)!)} has more than ${MAX_DAY_HOURS} hours on ${a.workDate}`,
        );
      }
    }

    // 7. Late hours on a completed job rewrite its actual cost.
    const complete = workOrders
      .filter((w) => w.status === 'COMPLETE')
      .map((w) => w.id);
    if (complete.length)
      await this.jobCost.recompute(manager, tenantId, complete);

    // Every edit sent, in order: an edit that changed nothing returns the
    // entry as it stands.
    const updated = changes.updates.map(
      (u) => changed.get(u.id) ?? byId.get(u.id)!,
    );
    return { created, updated };
  }

  /**
   * Adds `delta` minutes to an operation (never below zero) in one atomic
   * statement: the floor may be writing the same row's other columns. A
   * PENDING operation receiving time is PAUSED, as `ProductionService.logTime`
   * does.
   */
  private async moveMinutes(
    manager: EntityManager,
    tenantId: string,
    operationId: string,
    delta: number,
  ): Promise<void> {
    await manager.query(
      `UPDATE "work_order_operations"
          SET "actual_minutes" = GREATEST(0, ROUND(("actual_minutes" + $1::numeric)::numeric, 2)),
              "status" = CASE WHEN $1::numeric > 0 AND "status" = 'PENDING' THEN 'PAUSED' ELSE "status" END,
              "started_at" = CASE WHEN $1::numeric > 0 THEN COALESCE("started_at", now()) ELSE "started_at" END,
              "updatedAt" = now()
        WHERE "id" = $2 AND "tenant_id" = $3`,
      [delta, operationId, tenantId],
    );
  }

  private async dayHours(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    workDate: string,
  ): Promise<number> {
    const entries = await manager
      .getRepository(TimesheetEntry)
      .find({ where: { tenantId, employeeId, workDate } });
    return round2(entries.reduce((sum, e) => sum + Number(e.hours), 0));
  }

  /* ------------------------------------------------------------------ *
   * Mapping
   * ------------------------------------------------------------------ */

  private async toDtos(
    manager: EntityManager,
    tenantId: string,
    entries: TimesheetEntry[],
  ): Promise<TimesheetEntryDto[]> {
    if (!entries.length) return [];
    const empIds = unique(entries.map((e) => e.employeeId));
    const woIds = unique(entries.flatMap((e) => e.workOrderId ?? []));
    const opIds = unique(entries.flatMap((e) => e.operationId ?? []));
    const periods = unique(entries.map((e) => e.workDate.slice(0, 7)));
    // Past entries keep the names of employees deleted since.
    const employees = await manager
      .getRepository(Employee)
      .find({ where: { tenantId, id: In(empIds) }, withDeleted: true });
    const workOrders = woIds.length
      ? await manager
          .getRepository(WorkOrder)
          .find({ where: { tenantId, id: In(woIds) } })
      : [];
    const ops = opIds.length
      ? await manager
          .getRepository(WorkOrderOperation)
          .find({ where: { tenantId, id: In(opIds) } })
      : [];
    const runs: { employee_id: string; period: string }[] = await manager.query(
      `SELECT l."employee_id", r."period", r."run_number" FROM "payroll_run_lines" l
           JOIN "payroll_runs" r ON r."id" = l."run_id"
          WHERE l."tenant_id" = $1 AND l."employee_id" = ANY($2)
            AND r."period" = ANY($3) AND r."status" = ANY($4)`,
      [tenantId, empIds, periods, [...POSTED_RUN_STATUSES]],
    );
    const empById = new Map(employees.map((e) => [e.id, e]));
    const woById = new Map(workOrders.map((w) => [w.id, w]));
    const opById = new Map(ops.map((o) => [o.id, o]));
    const locked = new Set(runs.map((r) => postedKey(r.employee_id, r.period)));
    return entries.map((e) => {
      const emp = empById.get(e.employeeId);
      return {
        id: e.id,
        employeeId: e.employeeId,
        employeeName: emp ? employeeName(emp) : '',
        employeeNumber: emp?.employeeNumber ?? '',
        workDate: e.workDate,
        hours: Number(e.hours),
        workOrderId: e.workOrderId,
        woNumber: e.workOrderId
          ? (woById.get(e.workOrderId)?.woNumber ?? null)
          : null,
        operationId: e.operationId,
        operationLabel: e.operationId
          ? (opById.get(e.operationId)?.label ?? null)
          : null,
        indirectCategory: e.indirectCategory,
        source: e.source,
        note: e.note,
        locked: locked.has(postedKey(e.employeeId, e.workDate.slice(0, 7))),
        absorbed: e.runLineId != null,
      };
    });
  }
}

function pickFields(e: TimesheetEntry): EntryFields {
  return {
    employeeId: e.employeeId,
    workDate: e.workDate,
    hours: Number(e.hours),
    operationId: e.operationId,
    indirectCategory: e.indirectCategory,
    note: e.note,
  };
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
