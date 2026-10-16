import { BadRequestException, ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { PENSION_SCHEME_PRESETS } from '@saas/shared';
import { Employee } from './entities/employee.entity';
import { PensionScheme } from './entities/pension-scheme.entity';
import { PensionService } from './pension.service';

const T = '11111111-1111-4111-8111-111111111111';

function setup() {
  const schemes: any[] = [];
  const employees: any[] = [];
  let n = 0;
  const deleteFails = { value: false };
  const schemeRepo = {
    create: (d: any) => ({ ...d }),
    find: async ({ where }: any) => schemes.filter((s) => s.tenantId === where.tenantId),
    findOne: async ({ where }: any) => schemes.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null,
    save: async (e: any) => {
      if (!e.id) {
        e.id = `s-${++n}`;
        e.createdAt = new Date();
        schemes.push(e);
      }
      return e;
    },
    delete: async ({ id }: any) => {
      if (deleteFails.value) {
        throw new QueryFailedError('delete', [], Object.assign(new Error('fk'), { code: '23503' }) as any);
      }
      schemes.splice(schemes.findIndex((s) => s.id === id), 1);
    },
  };
  const employeeRepo = {
    find: async ({ where }: any) => employees.filter((e) => e.tenantId === where.tenantId && !e.deleted),
    count: async ({ where, withDeleted }: any) =>
      employees.filter((e) => e.tenantId === where.tenantId && e.pensionSchemeId === where.pensionSchemeId && (withDeleted || !e.deleted)).length,
  };
  const manager: any = {
    getRepository: (e: any) => (e === PensionScheme ? schemeRepo : e === Employee ? employeeRepo : null),
    // Stands in for INSERT ... ON CONFLICT DO NOTHING on (tenant_id, preset_key).
    query: jest.fn(async (_sql: string, p: any[]) => {
      if (schemes.some((s) => s.tenantId === p[0] && s.presetKey === p[2])) return;
      schemes.push({ id: `s-${++n}`, tenantId: p[0], name: p[1], presetKey: p[2], employeePct: p[3], employerPct: p[4], base: p[5], minSalary: p[6], maxSalary: p[7], isActive: false, createdAt: new Date() });
    }),
  };
  return { service: new PensionService({ manager } as any), schemes, employees, deleteFails };
}

const payload = { name: 'Custom', employeePct: 5, employerPct: 10, base: 'BASIC' as const, minSalary: null, maxSalary: null };

describe('PensionService', () => {
  it('the first list creates the presets inactive, a second creates none', async () => {
    const { service, schemes } = setup();
    const first = await service.list(T);
    expect(first).toHaveLength(PENSION_SCHEME_PRESETS.length);
    expect(first.every((s) => !s.isActive && s.presetKey)).toBe(true);
    await service.list(T);
    expect(schemes).toHaveLength(PENSION_SCHEME_PRESETS.length);
  });

  it('create is active and update can activate a preset', async () => {
    const { service } = setup();
    expect((await service.create(T, payload)).isActive).toBe(true);
    const preset = (await service.list(T)).find((s) => s.presetKey)!;
    expect((await service.update(T, preset.id, { isActive: true })).isActive).toBe(true);
  });

  it('update validates the merged min/max against the stored values', async () => {
    const { service } = setup();
    const s = await service.create(T, { ...payload, minSalary: 3000, maxSalary: 70000 });
    await expect(service.update(T, s.id, { maxSalary: 1000 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(T, s.id, { minSalary: 80000 })).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.update(T, s.id, { maxSalary: 90000 })).maxSalary).toBe(90000);
  });

  it('list counts non-deleted assignees only', async () => {
    const { service, employees } = setup();
    const s = await service.create(T, payload);
    employees.push({ tenantId: T, pensionSchemeId: s.id }, { tenantId: T, pensionSchemeId: s.id, deleted: true });
    expect((await service.list(T)).find((x) => x.id === s.id)!.assignedCount).toBe(1);
  });

  it('remove refuses an assigned scheme (soft-deleted assignees count) and deletes an unassigned one', async () => {
    const { service, employees, schemes } = setup();
    const used = await service.create(T, payload);
    const free = await service.create(T, { ...payload, name: 'Free' });
    employees.push({ tenantId: T, pensionSchemeId: used.id, deleted: true });
    await expect(service.remove(T, used.id)).rejects.toThrow('Custom is assigned to 1 employees; deactivate it instead');
    await service.remove(T, free.id);
    expect(schemes.map((s) => s.id)).toEqual([used.id]);
  });

  it('remove maps an FK violation to a 409', async () => {
    const { service, deleteFails } = setup();
    const s = await service.create(T, payload);
    deleteFails.value = true;
    await expect(service.remove(T, s.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('activeSchemeFor returns only an active scheme, and ratesOf copies its rates', async () => {
    const { service, schemes } = setup();
    const s = await service.create(T, payload);
    const m: any = { getRepository: () => ({ findOne: async () => schemes[0] }) };
    expect((await service.activeSchemeFor(m, T, { pensionSchemeId: s.id } as any))?.id).toBe(s.id);
    expect(await service.activeSchemeFor(m, T, { pensionSchemeId: null } as any)).toBeNull();
    schemes[0].isActive = false;
    expect(await service.activeSchemeFor(m, T, { pensionSchemeId: s.id } as any)).toBeNull();
    expect(service.ratesOf(schemes[0])).toEqual({ employeePct: 5, employerPct: 10, base: 'BASIC', minSalary: null, maxSalary: null });
  });
});
