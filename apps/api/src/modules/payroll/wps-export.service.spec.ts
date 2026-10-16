import {
  ConflictException,
  ForbiddenException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { Organization } from '../organizations/entities/organization.entity';
import { Employee } from './entities/employee.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { Settlement } from './entities/settlement.entity';
import { WpsExportService } from './wps-export.service';

const T = '11111111-1111-4111-8111-111111111111';
const PAYER = { userId: 'u1', permissions: [PERMISSIONS.PAYROLL_PAY] };
const WPS = {
  wpsEnabled: true,
  employerIdType: 'MOHRE',
  employerId: '1234567',
  payerRoutingCode: '803320101',
  annualLeaveDays: 30,
};

const emp = (id: string, extra: any = {}) => ({
  id,
  tenantId: T,
  joiningDate: '2020-01-01',
  leavingDate: null,
  wpsPersonId: `P${id}`,
  bankRoutingCode: '012345678',
  ibanEncrypted: `enc:AE07033${id}`,
  ...extra,
});
const line = (id: string, number: string, extra: any = {}) => ({
  runId: 'run1',
  tenantId: T,
  employeeId: id,
  employeeName: `Emp ${id}`,
  employeeNumber: number,
  paymentMethod: 'BANK',
  daysEmployed: 31,
  netPay: 5000,
  overtimeAmount: 200,
  bonusAmount: 100,
  leaveDaysInPeriod: 2,
  ...extra,
});

function setup(
  o: {
    settings?: any;
    base?: string;
    run?: any;
    lines?: any[];
    employees?: any[];
    settlement?: any;
  } = {},
) {
  const repos = new Map<any, any>([
    [Organization, { findOne: async () => ({ baseCurrency: o.base ?? 'AED' }) }],
    [PayrollRun, { findOne: async () => o.run ?? null }],
    [PayrollRunLine, { find: async () => o.lines ?? [] }],
    [Employee, { find: async () => o.employees ?? [] }],
    [Settlement, { findOne: async () => o.settlement ?? null }],
  ]);
  const manager = { getRepository: (e: any) => repos.get(e) };
  const settings = { get: jest.fn(async () => o.settings ?? WPS) };
  const crypto = {
    decrypt: (s: string) => {
      if (!s.startsWith('enc:')) throw new Error('bad');
      return s.slice(4);
    },
  };
  return new WpsExportService({ manager } as any, settings as any, crypto as any);
}

const APPROVED_RUN = {
  id: 'run1',
  runNumber: 'PR-2026-10',
  period: '2026-10',
  status: 'APPROVED',
};
const SETTLEMENT = {
  id: 's1',
  settlementNumber: 'FS-2026-0001',
  employeeId: 'a',
  employeeName: 'Emp a',
  leavingDate: '2026-10-20',
  status: 'APPROVED',
  paymentMethod: 'BANK',
  netPay: 12345.5,
};

describe('WpsExportService.forRun', () => {
  it('writes an EDR per bank line, an SCR total and a cash warning', async () => {
    const svc = setup({
      run: APPROVED_RUN,
      lines: [
        line('b', 'E2'),
        line('a', 'E1'),
        line('c', 'E3', { paymentMethod: 'CASH' }),
      ],
      employees: [emp('a'), emp('b'), emp('c')],
    });
    const out = await svc.forRun(T, 'run1', PAYER);
    const rows = out.content.trim().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(
      'EDR,Pa,012345678,AE07033a,2026-10-01,2026-10-31,31,4700.00,300.00,2',
    );
    expect(rows[1].startsWith('EDR,Pb,')).toBe(true);
    expect(rows[2]).toContain(',2,10000.00,AED,PR-2026-10');
    expect(out.warnings).toEqual(['Emp c is paid in cash and is not in the file']);
    expect(out.fileName).toMatch(/\.SIF$/);
  });

  it('clips the pay period to joining and leaving dates', async () => {
    const svc = setup({
      run: APPROVED_RUN,
      lines: [line('a', 'E1')],
      employees: [emp('a', { joiningDate: '2026-10-10', leavingDate: '2026-10-20' })],
    });
    const out = await svc.forRun(T, 'run1', PAYER);
    expect(out.content).toContain(',2026-10-10,2026-10-20,');
  });

  it('refuses with 422 naming an employee without a person ID', async () => {
    const svc = setup({
      run: APPROVED_RUN,
      lines: [line('a', 'E1'), line('b', 'E2')],
      employees: [emp('a', { wpsPersonId: null }), emp('b')],
    });
    const err: any = await svc.forRun(T, 'run1', PAYER).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.message).toBe('Fix before exporting: Emp a: WPS person ID missing');
  });

  it('refuses with 422 when an IBAN cannot be decrypted, without leaking it', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const svc = setup({
      run: APPROVED_RUN,
      lines: [line('a', 'E1')],
      employees: [emp('a', { ibanEncrypted: 'garbled' })],
    });
    const err: any = await svc.forRun(T, 'run1', PAYER).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.message).toContain('Emp a: IBAN could not be read');
    expect(err.message).not.toContain('garbled');
  });

  it('refuses a negative net pay with 422', async () => {
    const svc = setup({
      run: APPROVED_RUN,
      lines: [line('a', 'E1', { netPay: -50 })],
      employees: [emp('a')],
    });
    const err: any = await svc.forRun(T, 'run1', PAYER).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.message).toContain('Emp a: net pay is negative');
  });

  it('409 when WPS is switched off', async () => {
    const svc = setup({ settings: { ...WPS, wpsEnabled: false }, run: APPROVED_RUN });
    await expect(svc.forRun(T, 'run1', PAYER)).rejects.toThrow(
      new ConflictException('WPS is switched off in payroll settings'),
    );
  });

  it('409 when the base currency is not AED', async () => {
    const svc = setup({ base: 'USD', run: APPROVED_RUN });
    await expect(svc.forRun(T, 'run1', PAYER)).rejects.toThrow(
      "WPS salary files are in AED; this organisation's base currency is USD",
    );
  });

  it('409 for a DRAFT run', async () => {
    const svc = setup({ run: { ...APPROVED_RUN, status: 'DRAFT' } });
    await expect(svc.forRun(T, 'run1', PAYER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('re-checks payroll:pay in the service', async () => {
    const svc = setup({ run: APPROVED_RUN });
    await expect(
      svc.forRun(T, 'run1', { userId: 'u', permissions: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('WpsExportService.forSettlement', () => {
  it('writes one row whose variable is the net pay', async () => {
    const svc = setup({ settlement: SETTLEMENT, employees: [emp('a')] });
    const out = await svc.forSettlement(T, 's1', PAYER);
    const rows = out.content.trim().split('\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(
      'EDR,Pa,012345678,AE07033a,2026-10-20,2026-10-20,0,0.00,12345.50,0',
    );
    expect(rows[1]).toContain(',1,12345.50,AED,FS-2026-0001');
  });

  it('409 for a cash settlement', async () => {
    const svc = setup({
      settlement: { ...SETTLEMENT, paymentMethod: 'CASH' },
      employees: [emp('a')],
    });
    await expect(svc.forSettlement(T, 's1', PAYER)).rejects.toThrow(
      'FS-2026-0001 is paid in cash',
    );
  });

  it('409 for a draft settlement', async () => {
    const svc = setup({ settlement: { ...SETTLEMENT, status: 'DRAFT' } });
    await expect(svc.forSettlement(T, 's1', PAYER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('422 for a negative net', async () => {
    const svc = setup({
      settlement: { ...SETTLEMENT, netPay: -1 },
      employees: [emp('a')],
    });
    await expect(svc.forSettlement(T, 's1', PAYER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
