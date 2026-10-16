import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TimesheetsService } from './timesheets.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

/**
 * In-memory stand-in for the repositories the service touches, plus a
 * `manager.query` that records every statement and understands the few raw
 * SQL statements the service issues. `calls` records every repository call
 * and query in order, so a test can assert what ran first. A transaction
 * that throws restores the tables, as Postgres would roll back.
 */
function makeWorld() {
  let tables: Record<string, any[]> = {
    TimesheetEntry: [],
    WorkOrder: [],
    WorkOrderOperation: [],
    Employee: [],
  };
  const posted: { employeeId: string; period: string; runNumber: string }[] =
    [];
  const calls: string[] = [];
  let nextId = 1;

  const op = (v: any) =>
    v && typeof v === 'object' && '_type' in v ? v : null;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      const o = op(v);
      if (o?._type === 'in') return (o._value as unknown[]).includes(row[k]);
      if (o?._type === 'between')
        return row[k] >= o._value[0] && row[k] <= o._value[1];
      return row[k] === v;
    });
  const visible = (name: string, withDeleted = false) =>
    tables[name].filter((r) => withDeleted || !r.deletedAt);

  const repo = (name: string) => ({
    findOne: async ({ where, withDeleted }: any) => {
      calls.push(`${name}.findOne`);
      return visible(name, withDeleted).find((r) => matches(r, where)) ?? null;
    },
    find: async ({ where, withDeleted, order }: any = {}) => {
      calls.push(`${name}.find`);
      const keys = Object.keys(order ?? {});
      return visible(name, withDeleted)
        .filter((r) => matches(r, where))
        .sort((a, b) => {
          for (const k of keys) {
            if (a[k] < b[k]) return -1;
            if (a[k] > b[k]) return 1;
          }
          return 0;
        })
        .map((r) => ({ ...r }));
    },
    create: (dto: any) => ({ ...dto }),
    save: async (row: any) => {
      calls.push(`${name}.save`);
      row.id ??= `${name}-${nextId++}`;
      row.createdAt ??= new Date(Date.UTC(2026, 9, 1, 0, 0, nextId));
      tables[name].push({ ...row });
      return row;
    },
    update: async (where: any, patch: any) => {
      calls.push(`${name}.update`);
      tables[name]
        .filter((r) => matches(r, where))
        .forEach((r) => Object.assign(r, patch));
    },
    delete: async (where: any) => {
      calls.push(`${name}.delete`);
      tables[name] = tables[name].filter((r) => !matches(r, where));
    },
    createQueryBuilder: () => {
      const params: Record<string, any> = {};
      let locked = false;
      const qb: any = {
        setLock: () => ((locked = true), qb),
        where: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        andWhere: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        orderBy: () => qb,
        getMany: async () => {
          calls.push(`${name}.lock:${locked}:${params.ids.join(',')}`);
          return tables[name]
            .filter(
              (r) =>
                params.ids.includes(r.id) && r.tenantId === params.tenantId,
            )
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((r) => ({ ...r }));
        },
      };
      return qb;
    },
  });

  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) {
      calls.push(`lock:${params[0]}`);
      return [];
    }
    if (sql.includes('UPDATE "work_order_operations"')) {
      calls.push('minutes');
      const [delta, id] = params;
      const row = tables.WorkOrderOperation.find((r) => r.id === id);
      row.actualMinutes = Math.max(
        0,
        Math.round((row.actualMinutes + delta) * 100) / 100,
      );
      if (delta > 0) {
        if (row.status === 'PENDING') row.status = 'PAUSED';
        row.startedAt ??= new Date();
      }
      return [];
    }
    if (sql.includes('"payroll_run_lines"')) {
      calls.push('posted');
      const [, emp, period] = params;
      const emps: string[] = Array.isArray(emp) ? emp : [emp];
      const periods: string[] = Array.isArray(period) ? period : [period];
      return posted
        .filter(
          (p) => emps.includes(p.employeeId) && periods.includes(p.period),
        )
        .map((p) => ({
          employee_id: p.employeeId,
          period: p.period,
          run_number: p.runNumber,
        }));
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  const manager: any = {
    getRepository: (entity: { name: string }) => repo(entity.name),
    query,
  };
  const dataSource: any = {
    manager,
    transaction: async (cb: any) => {
      const snapshot = structuredClone(tables);
      try {
        return await cb(manager);
      } catch (e) {
        tables = snapshot;
        throw e;
      }
    },
  };
  const jobCost = { recompute: jest.fn(async () => undefined) };
  const service = new TimesheetsService(dataSource, jobCost);

  // A released job with a pending operation; a planned, a cancelled and a
  // completed job; two employees, one linked to a user.
  const wo = (id: string, status: string) =>
    tables.WorkOrder.push({ id, tenantId, woNumber: id.toUpperCase(), status });
  wo('wo-a', 'RELEASED');
  wo('wo-p', 'PLANNED');
  wo('wo-x', 'CANCELLED');
  wo('wo-c', 'COMPLETE');
  const opRow = (id: string, workOrderId: string, status = 'PENDING') =>
    tables.WorkOrderOperation.push({
      id,
      tenantId,
      workOrderId,
      label: `Op ${id}`,
      status,
      actualMinutes: 0,
      startedAt: null,
    });
  opRow('op-a', 'wo-a');
  opRow('op-a2', 'wo-a');
  opRow('op-s', 'wo-a', 'SKIPPED');
  opRow('op-p', 'wo-p');
  opRow('op-x', 'wo-x', 'PAUSED');
  opRow('op-c', 'wo-c', 'DONE');
  tables.Employee.push(
    {
      id: 'emp-1',
      tenantId,
      employeeNumber: 'E-001',
      firstName: 'Ravi',
      lastName: 'Kumar',
      userId: 'user-1',
      joiningDate: '2026-01-01',
      leavingDate: null,
      status: 'ACTIVE',
      deletedAt: null,
    },
    {
      id: 'emp-2',
      tenantId,
      employeeNumber: 'E-002',
      firstName: 'Maya',
      lastName: 'Shah',
      userId: null,
      joiningDate: '2026-10-10',
      leavingDate: '2026-12-31',
      status: 'ACTIVE',
      deletedAt: null,
    },
  );

  return {
    service,
    jobCost,
    manager,
    query,
    calls,
    posted,
    get tables() {
      return tables;
    },
    opRow: (id: string) => tables.WorkOrderOperation.find((r) => r.id === id),
    woRow: (id: string) => tables.WorkOrder.find((r) => r.id === id),
  };
}

const entry = (over: Record<string, unknown> = {}) => ({
  employeeId: 'emp-1',
  workDate: '2026-10-14',
  hours: 2,
  operationId: 'op-a' as string | null,
  indirectCategory: null as any,
  note: null,
  ...over,
});

describe('TimesheetsService', () => {
  describe('operation minutes', () => {
    it('create adds hours × 60, turns a PENDING operation PAUSED and a RELEASED work order IN_PROGRESS', async () => {
      const w = makeWorld();
      const dto = await w.service.create(
        tenantId,
        'actor',
        entry({ hours: 1.5 }),
      );
      expect(w.opRow('op-a')).toMatchObject({
        actualMinutes: 90,
        status: 'PAUSED',
      });
      expect(w.opRow('op-a').startedAt).toBeInstanceOf(Date);
      expect(w.woRow('wo-a').status).toBe('IN_PROGRESS');
      expect(dto).toMatchObject({
        employeeName: 'Ravi Kumar',
        employeeNumber: 'E-001',
        workOrderId: 'wo-a',
        woNumber: 'WO-A',
        operationLabel: 'Op op-a',
        source: 'MANUAL',
        locked: false,
        absorbed: false,
      });
      expect(w.tables.TimesheetEntry[0]).toMatchObject({
        createdById: 'actor',
        source: 'MANUAL',
      });
    });

    it('update applies the difference; delete subtracts; minutes never go below zero', async () => {
      const w = makeWorld();
      const dto = await w.service.create(
        tenantId,
        'actor',
        entry({ hours: 2 }),
      );
      await w.service.update(tenantId, dto.id, { hours: 3.25 });
      expect(w.opRow('op-a').actualMinutes).toBe(195);
      await w.service.update(tenantId, dto.id, { hours: 1 });
      expect(w.opRow('op-a').actualMinutes).toBe(60);

      // Somebody trimmed the operation's minutes on the floor meanwhile.
      w.opRow('op-a').actualMinutes = 30;
      await w.service.remove(tenantId, dto.id);
      expect(w.opRow('op-a').actualMinutes).toBe(0);
      expect(w.tables.TimesheetEntry).toHaveLength(0);
    });

    it('an update that changes nothing does not touch minutes', async () => {
      const w = makeWorld();
      const dto = await w.service.create(
        tenantId,
        'actor',
        entry({ hours: 2 }),
      );
      w.query.mockClear();
      await w.service.update(tenantId, dto.id, {});
      expect(
        w.query.mock.calls.some(([sql]) =>
          sql.includes('work_order_operations'),
        ),
      ).toBe(false);
      expect(w.opRow('op-a').actualMinutes).toBe(120);
    });

    it('editing a CLOCK entry applies its delta too', async () => {
      const w = makeWorld();
      w.opRow('op-a').actualMinutes = 120; // the clock added these
      w.tables.TimesheetEntry.push({
        id: 'clock-1',
        tenantId,
        employeeId: 'emp-1',
        workDate: '2026-10-14',
        hours: 2,
        workOrderId: 'wo-a',
        operationId: 'op-a',
        indirectCategory: null,
        source: 'CLOCK',
        note: null,
        runLineId: null,
      });
      await w.service.update(tenantId, 'clock-1', { hours: 1.5 });
      expect(w.opRow('op-a').actualMinutes).toBe(90);
      await w.service.remove(tenantId, 'clock-1');
      expect(w.opRow('op-a').actualMinutes).toBe(0);
    });

    it('moving an entry to another operation moves its minutes', async () => {
      const w = makeWorld();
      const dto = await w.service.create(
        tenantId,
        'actor',
        entry({ hours: 2 }),
      );
      await w.service.bulk(tenantId, 'actor', {
        upserts: [{ ...entry({ hours: 2, operationId: 'op-a2' }), id: dto.id }],
        deletes: [],
      });
      expect(w.opRow('op-a').actualMinutes).toBe(0);
      expect(w.opRow('op-a2').actualMinutes).toBe(120);
    });

    it('an indirect entry touches no operation', async () => {
      const w = makeWorld();
      const dto = await w.service.create(
        tenantId,
        'actor',
        entry({ operationId: null, indirectCategory: 'CLEANING' }),
      );
      expect(dto).toMatchObject({
        workOrderId: null,
        operationId: null,
        indirectCategory: 'CLEANING',
      });
      expect(
        w.query.mock.calls.some(([sql]) =>
          sql.includes('work_order_operations'),
        ),
      ).toBe(false);
    });
  });

  describe('posted months', () => {
    it('refuses hours in a posted month (409 naming the run); the same entry is editable once the run is voided', async () => {
      const w = makeWorld();
      const dto = await w.service.create(tenantId, 'actor', entry());
      w.posted.push({
        employeeId: 'emp-1',
        period: '2026-10',
        runNumber: 'PR-2026-0010',
      });

      const refused = w.service.update(tenantId, dto.id, { hours: 3 });
      await expect(refused).rejects.toBeInstanceOf(ConflictException);
      await expect(
        w.service.update(tenantId, dto.id, { hours: 3 }),
      ).rejects.toThrow(
        'Payroll for October 2026 is posted (PR-2026-0010); void it to change these hours',
      );
      await expect(w.service.remove(tenantId, dto.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        w.service.create(tenantId, 'actor', entry({ workDate: '2026-10-20' })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(w.opRow('op-a').actualMinutes).toBe(120);

      const [listed] = await w.service.list(tenantId, {
        employeeId: 'emp-1',
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(listed.locked).toBe(true);

      w.posted.length = 0; // voided
      await w.service.update(tenantId, dto.id, { hours: 3 });
      expect(w.opRow('op-a').actualMinutes).toBe(180);
    });

    it('moving an entry out of a posted month is refused too', async () => {
      const w = makeWorld();
      const dto = await w.service.create(tenantId, 'actor', entry());
      w.posted.push({
        employeeId: 'emp-1',
        period: '2026-10',
        runNumber: 'PR-2026-0010',
      });
      await expect(
        w.service.bulk(tenantId, 'actor', {
          upserts: [{ ...entry({ workDate: '2026-11-02' }), id: dto.id }],
          deletes: [],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('refusals', () => {
    it('outside employment → 400', async () => {
      const w = makeWorld();
      await expect(
        w.service.create(
          tenantId,
          'a',
          entry({ employeeId: 'emp-2', workDate: '2026-10-09' }),
        ),
      ).rejects.toThrow(
        new BadRequestException('Maya Shah was not employed on 2026-10-09'),
      );
      await expect(
        w.service.create(
          tenantId,
          'a',
          entry({ employeeId: 'emp-2', workDate: '2027-01-01' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a cancelled work order → 409; planned → 400; skipped operation → 400', async () => {
      const w = makeWorld();
      await expect(
        w.service.create(tenantId, 'a', entry({ operationId: 'op-x' })),
      ).rejects.toThrow(new ConflictException('WO-X is cancelled'));
      await expect(
        w.service.create(tenantId, 'a', entry({ operationId: 'op-p' })),
      ).rejects.toThrow(
        new BadRequestException('WO-P has not been released to the floor yet'),
      );
      await expect(
        w.service.create(tenantId, 'a', entry({ operationId: 'op-s' })),
      ).rejects.toThrow(new BadRequestException('"Op op-s" was skipped'));
    });

    it('an unknown operation, entry or employee → 404', async () => {
      const w = makeWorld();
      await expect(
        w.service.create(tenantId, 'a', entry({ operationId: 'op-nope' })),
      ).rejects.toThrow(
        new NotFoundException('That operation is not on a work order'),
      );
      await expect(
        w.service.update(tenantId, 'nope', { hours: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      w.tables.Employee[1].deletedAt = new Date();
      await expect(
        w.service.create(
          tenantId,
          'a',
          entry({ employeeId: 'emp-2', workDate: '2026-10-14' }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('more than 24 hours in a day across two entries → 422 and nothing saved', async () => {
      const w = makeWorld();
      await w.service.create(tenantId, 'a', entry({ hours: 16 }));
      await expect(
        w.service.create(
          tenantId,
          'a',
          entry({ hours: 9, operationId: null, indirectCategory: 'IDLE' }),
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException(
          'Ravi Kumar has more than 24 hours on 2026-10-14',
        ),
      );
      expect(w.tables.TimesheetEntry).toHaveLength(1);
      expect(w.opRow('op-a').actualMinutes).toBe(960);
    });
  });

  describe('bulk', () => {
    it('applies deletes, updates and creates in one transaction', async () => {
      const w = makeWorld();
      const keep = await w.service.create(tenantId, 'a', entry({ hours: 1 }));
      const drop = await w.service.create(
        tenantId,
        'a',
        entry({ hours: 2, workDate: '2026-10-15' }),
      );
      const saved = await w.service.bulk(tenantId, 'a', {
        upserts: [
          { ...entry({ hours: 4 }), id: keep.id },
          entry({ hours: 3, workDate: '2026-10-16', operationId: 'op-a2' }),
        ],
        deletes: [drop.id],
      });
      expect(saved.map((s) => s.hours)).toEqual([4, 3]);
      expect(saved[0].id).toBe(keep.id);
      expect(w.tables.TimesheetEntry.map((e) => e.hours).sort()).toEqual([
        3, 4,
      ]);
      expect(w.opRow('op-a').actualMinutes).toBe(240);
      expect(w.opRow('op-a2').actualMinutes).toBe(180);
    });

    it('a failure in one item saves none', async () => {
      const w = makeWorld();
      const keep = await w.service.create(tenantId, 'a', entry({ hours: 1 }));
      await expect(
        w.service.bulk(tenantId, 'a', {
          upserts: [
            { ...entry({ hours: 5 }), id: keep.id },
            entry({ operationId: 'op-x' }),
          ],
          deletes: [],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(w.tables.TimesheetEntry).toHaveLength(1);
      expect(w.tables.TimesheetEntry[0].hours).toBe(1);
      expect(w.opRow('op-a').actualMinutes).toBe(60);
    });

    it('refuses an entry both saved and deleted', async () => {
      const w = makeWorld();
      const e = await w.service.create(tenantId, 'a', entry());
      await expect(
        w.service.bulk(tenantId, 'a', {
          upserts: [{ ...entry(), id: e.id }],
          deletes: [e.id],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('late hours recompute a completed job', async () => {
    const w = makeWorld();
    await w.service.create(tenantId, 'a', entry({ operationId: 'op-c' }));
    expect(w.jobCost.recompute).toHaveBeenCalledWith(w.manager, tenantId, [
      'wo-c',
    ]);
    expect(w.opRow('op-c')).toMatchObject({
      actualMinutes: 120,
      status: 'DONE',
    });
    expect(w.woRow('wo-c').status).toBe('COMPLETE');

    w.jobCost.recompute.mockClear();
    await w.service.create(tenantId, 'a', entry({ workDate: '2026-10-15' }));
    expect(w.jobCost.recompute).not.toHaveBeenCalled();
  });

  it('lockJobCosting is the first query of every write, then the work orders are locked sorted by id', async () => {
    const w = makeWorld();
    const lock = `lock:job-costing:${tenantId}`;
    const first = await w.service.create(tenantId, 'a', entry());
    expect(w.calls[0]).toBe(lock);
    expect(w.calls).toContain('WorkOrder.lock:true:wo-a');

    w.calls.length = 0;
    await w.service.update(tenantId, first.id, { hours: 3 });
    expect(w.calls[0]).toBe(lock);

    w.calls.length = 0;
    await w.service.bulk(tenantId, 'a', {
      upserts: [entry({ operationId: 'op-c', workDate: '2026-10-20' })],
      deletes: [first.id],
    });
    expect(w.calls[0]).toBe(lock);
    expect(w.calls).toContain('WorkOrder.lock:true:wo-a,wo-c');

    w.calls.length = 0;
    const [left] = w.tables.TimesheetEntry;
    await w.service.remove(tenantId, left.id);
    expect(w.calls[0]).toBe(lock);
  });

  describe('recordClock', () => {
    const clock = {
      workOrderId: 'wo-a',
      operationId: 'op-a',
      minutes: 95,
      workDate: '2026-10-14',
    };

    it('an unlinked user gets no entry', async () => {
      const w = makeWorld();
      await expect(
        w.service.recordClock(w.manager, tenantId, {
          ...clock,
          userId: 'user-9',
        }),
      ).resolves.toBeNull();
      expect(w.tables.TimesheetEntry).toHaveLength(0);
    });

    it('a linked user gets one CLOCK entry and the minutes are untouched', async () => {
      const w = makeWorld();
      w.opRow('op-a').actualMinutes = 95;
      const saved = await w.service.recordClock(w.manager, tenantId, {
        ...clock,
        userId: 'user-1',
      });
      expect(saved).toMatchObject({
        employeeId: 'emp-1',
        hours: 1.58,
        source: 'CLOCK',
        createdById: 'user-1',
        workOrderId: 'wo-a',
        operationId: 'op-a',
        indirectCategory: null,
        note: null,
      });
      expect(w.tables.TimesheetEntry).toHaveLength(1);
      expect(w.opRow('op-a').actualMinutes).toBe(95);
      expect(w.calls).not.toContain(`lock:job-costing:${tenantId}`);
    });

    it('a posted month, a day outside employment or a full day → null without throwing', async () => {
      const w = makeWorld();
      w.posted.push({
        employeeId: 'emp-1',
        period: '2026-10',
        runNumber: 'PR-1',
      });
      await expect(
        w.service.recordClock(w.manager, tenantId, {
          ...clock,
          userId: 'user-1',
        }),
      ).resolves.toBeNull();
      w.posted.length = 0;

      await expect(
        w.service.recordClock(w.manager, tenantId, {
          ...clock,
          userId: 'user-1',
          workDate: '2025-12-31',
        }),
      ).resolves.toBeNull();

      w.tables.TimesheetEntry.push({
        id: 'e-23',
        tenantId,
        employeeId: 'emp-1',
        workDate: '2026-10-14',
        hours: 23,
        workOrderId: null,
        operationId: null,
        indirectCategory: 'IDLE',
        source: 'MANUAL',
        note: null,
        runLineId: null,
      });
      await expect(
        w.service.recordClock(w.manager, tenantId, {
          ...clock,
          userId: 'user-1',
        }),
      ).resolves.toBeNull();
      await expect(
        w.service.recordClock(w.manager, tenantId, {
          ...clock,
          userId: 'user-1',
          minutes: 0.2,
        }),
      ).resolves.toBeNull();
      expect(w.tables.TimesheetEntry).toHaveLength(1);
    });
  });

  describe('reads', () => {
    it('crew lists every entry on the work order that day; employees are ordered by name', async () => {
      const w = makeWorld();
      await w.service.create(tenantId, 'a', entry());
      await w.service.create(
        tenantId,
        'a',
        entry({ employeeId: 'emp-2', operationId: 'op-a2' }),
      );
      await w.service.create(tenantId, 'a', entry({ workDate: '2026-10-15' }));
      const crew = await w.service.crew(tenantId, {
        workOrderId: 'wo-a',
        workDate: '2026-10-14',
      });
      expect(crew.map((c) => c.employeeName).sort()).toEqual([
        'Maya Shah',
        'Ravi Kumar',
      ]);

      const employees = await w.service.employees(tenantId);
      expect(employees.map((e) => e.name)).toEqual(['Maya Shah', 'Ravi Kumar']);
      expect(employees[1]).toMatchObject({
        id: 'emp-1',
        employeeNumber: 'E-001',
        userId: 'user-1',
      });
    });

    it('absorbed follows runLineId', async () => {
      const w = makeWorld();
      await w.service.create(tenantId, 'a', entry());
      w.tables.TimesheetEntry[0].runLineId = 'line-1';
      const [dto] = await w.service.list(tenantId, {
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(dto.absorbed).toBe(true);
    });
  });
});
