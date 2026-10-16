import { PayrollSettingsService } from './payroll-settings.service';

const T = '11111111-1111-4111-8111-111111111111';

function setup() {
  const rows: any[] = [];
  const manager: any = {
    getRepository: () => ({
      findOne: async ({ where }: any) => rows.find((r) => r.tenantId === where.tenantId) ?? null,
    }),
    // Stands in for INSERT ... ON CONFLICT ("tenant_id") DO UPDATE.
    query: jest.fn(async (_sql: string, p: any[]) => {
      const row = { tenantId: p[0], wpsEnabled: p[1], employerIdType: p[2], employerId: p[3], payerRoutingCode: p[4], annualLeaveDays: p[5], monthlyStandardHours: p[6] };
      const i = rows.findIndex((r) => r.tenantId === p[0]);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    }),
  };
  return { service: new PayrollSettingsService({ manager } as any), manager };
}

describe('PayrollSettingsService', () => {
  it('get returns the defaults when no row exists', async () => {
    const { service } = setup();
    expect(await service.get(T)).toEqual({ wpsEnabled: false, employerIdType: null, employerId: null, payerRoutingCode: null, annualLeaveDays: 30, monthlyStandardHours: 208 });
  });

  it('put upserts and get returns what was saved', async () => {
    const { service, manager } = setup();
    const saved = { wpsEnabled: true, employerIdType: 'MOHRE' as const, employerId: '1234567890123', payerRoutingCode: '803320101', annualLeaveDays: 35, monthlyStandardHours: 208 };
    expect(await service.put(T, saved)).toEqual(saved);
    await service.put(T, { ...saved, annualLeaveDays: 40 });
    expect((await service.get(T)).annualLeaveDays).toBe(40);
    expect(manager.query.mock.calls[0][0]).toContain('ON CONFLICT ("tenant_id") DO UPDATE');
  });

  it('put stores the monthly standard hours and get returns them', async () => {
    const { service, manager } = setup();
    const saved = { wpsEnabled: false, employerIdType: null, employerId: null, payerRoutingCode: null, annualLeaveDays: 30, monthlyStandardHours: 180 };
    expect(await service.put(T, saved)).toEqual(saved);
    expect((await service.get(T)).monthlyStandardHours).toBe(180);
    expect(manager.query.mock.calls[0][0]).toContain('"monthly_standard_hours" = EXCLUDED."monthly_standard_hours"');
  });

  it('annualDaysFor prefers the employee override, else the tenant value', async () => {
    const { service, manager } = setup();
    await service.put(T, { wpsEnabled: false, employerIdType: null, employerId: null, payerRoutingCode: null, annualLeaveDays: 36, monthlyStandardHours: 208 });
    expect(await service.annualDaysFor(manager, T, { annualLeaveDaysOverride: 45 } as any)).toBe(45);
    expect(await service.annualDaysFor(manager, T, { annualLeaveDaysOverride: null } as any)).toBe(36);
  });
});
