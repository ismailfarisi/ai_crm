import { BadRequestException, ConflictException } from '@nestjs/common';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { User } from '../users/entities/user.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';

const T = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const U1 = '44444444-4444-4444-8444-444444444444';
const IBAN = 'AE070331234567890123456';

function repo(rows: any[]) {
  let n = 0;
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (d: any) => ({ ...d }),
    find: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    findOne: jest.fn(async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null),
    save: jest.fn(async (e: any) => {
      if (!e.id) {
        e.id = `id-${++n}`;
        e.createdAt = new Date();
        rows.push(e);
      }
      e.updatedAt = new Date();
      return e;
    }),
  };
}

function setup() {
  const employees = repo([]);
  const packages = repo([]);
  const users = repo([{ id: U1, tenantId: T }]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [User, users],
  ]);
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async () => [{ current_value: employees.rows.length + 1 }]),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const crypto = new PayrollCryptoService({} as any);
  const service = new EmployeesService(dataSource, crypto);
  return { service, employees, packages, manager };
}

const input: any = {
  firstName: 'Ada', lastName: 'Okafor', jobTitle: 'Designer', department: null, userId: null,
  joiningDate: '2026-01-15', leavingDate: null, status: 'ACTIVE', nationality: null, isNational: false,
  paymentMethod: 'BANK', bankName: 'ENBD', iban: IBAN, email: null, phone: null,
};

describe('EmployeesService', () => {
  it('create numbers the employee and encrypts the IBAN', async () => {
    const { service, employees } = setup();
    const view = await service.create(T, ACTOR, input);
    expect(view.employeeNumber).toMatch(/^EMP-\d{4}-0001$/);
    expect(view.fullName).toBe('Ada Okafor');
    const row = employees.rows[0];
    expect(row.ibanEncrypted).toBeTruthy();
    expect(row.ibanEncrypted).not.toContain(IBAN);
    expect(row.ibanLast4).toBe('3456');
    expect(JSON.stringify(row)).not.toContain(IBAN);
    expect(view.iban).toBe(IBAN);
  });

  it('create refuses a userId already linked in the tenant', async () => {
    const { service } = setup();
    await service.create(T, ACTOR, { ...input, userId: U1 });
    await expect(service.create(T, ACTOR, { ...input, userId: U1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('create refuses a userId from another tenant or nonexistent', async () => {
    const { service } = setup();
    await expect(service.create(OTHER, ACTOR, { ...input, userId: U1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(T, ACTOR, { ...input, userId: '55555555-5555-4555-8555-555555555555' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('switching to CASH clears bank details', async () => {
    const { service, employees } = setup();
    const v = await service.create(T, ACTOR, input);
    await service.update(T, v.id, { paymentMethod: 'CASH' });
    const row = employees.rows[0];
    expect(row.ibanEncrypted).toBeNull();
    expect(row.ibanLast4).toBeNull();
    expect(row.bankName).toBeNull();
  });

  it('switching to BANK needs an IBAN', async () => {
    const { service } = setup();
    const v = await service.create(T, ACTOR, { ...input, paymentMethod: 'CASH', iban: null, bankName: null });
    await expect(service.update(T, v.id, { paymentMethod: 'BANK' })).rejects.toThrow('Bank payees need an IBAN');
    const ok = await service.update(T, v.id, { paymentMethod: 'BANK', iban: IBAN });
    expect(ok.iban).toBe(IBAN);
  });

  it('LEFT needs a leaving date', async () => {
    const { service } = setup();
    const v = await service.create(T, ACTOR, input);
    await expect(service.update(T, v.id, { status: 'LEFT' })).rejects.toBeInstanceOf(BadRequestException);
    const ok = await service.update(T, v.id, { status: 'LEFT', leavingDate: '2026-06-30' });
    expect(ok.status).toBe('LEFT');
  });

  it('addPackage refuses duplicates and dates before joining', async () => {
    const { service } = setup();
    const v = await service.create(T, ACTOR, input);
    const pkg = { effectiveFrom: '2026-01-15', basic: 6000, housing: 1000, transport: 500, otherAllowances: [] };
    const dto = await service.addPackage(T, v.id, ACTOR, pkg);
    expect(dto.gross).toBe(7500);
    await expect(service.addPackage(T, v.id, ACTOR, pkg)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.addPackage(T, v.id, ACTOR, { ...pkg, effectiveFrom: '2026-01-01' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('packageAt picks the latest effectiveFrom on or before the date', async () => {
    const { service, manager } = setup();
    const v = await service.create(T, ACTOR, input);
    const base = { otherAllowances: [], housing: 0, transport: 0 };
    await service.addPackage(T, v.id, ACTOR, { ...base, effectiveFrom: '2026-01-15', basic: 5000 });
    await service.addPackage(T, v.id, ACTOR, { ...base, effectiveFrom: '2026-07-01', basic: 6000 });
    expect((await service.packageAt(manager, T, v.id, '2026-06-30'))!.basic).toBe(5000);
    expect((await service.packageAt(manager, T, v.id, '2026-07-01'))!.basic).toBe(6000);
    expect(await service.packageAt(manager, T, v.id, '2026-01-14')).toBeNull();
  });

  it('list searches name, number and job title, scoped to the tenant', async () => {
    const { service, employees } = setup();
    await service.create(T, ACTOR, input);
    await service.create(T, ACTOR, { ...input, firstName: 'Bola', lastName: 'Ade', jobTitle: 'Welder', iban: null, paymentMethod: 'CASH' });
    employees.rows.push({ ...employees.rows[0], id: 'x', tenantId: OTHER, firstName: 'Ada' });
    expect((await service.list(T, { search: 'ADA' })).map((e) => e.firstName)).toEqual(['Ada']);
    expect((await service.list(T, { search: 'welder' })).length).toBe(1);
    expect((await service.list(T, { search: 'emp-' })).length).toBe(2);
    expect((await service.list(T, {})).length).toBe(2);
  });
});
