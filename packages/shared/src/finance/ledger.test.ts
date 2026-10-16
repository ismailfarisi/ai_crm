import { describe, expect, it } from 'vitest';
import { LEDGER_ROLES, SYSTEM_LEDGER_ACCOUNTS, OPERATING_EXPENSE_CHILD_ROLES } from './ledger';

describe('system chart of accounts', () => {
  it('has unique codes and unique roles', () => {
    const codes = SYSTEM_LEDGER_ACCOUNTS.map((a) => a.code);
    const roles = SYSTEM_LEDGER_ACCOUNTS.map((a) => a.role);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('lists every descendant of 6000 as an overhead role, and only those', () => {
    const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
    const under6000 = (code: string | undefined): boolean =>
      !!code && (code === '6000' || under6000(byCode.get(code)?.parentCode));
    const descendants = SYSTEM_LEDGER_ACCOUNTS.filter((a) => a.code !== '6000' && under6000(a.parentCode));
    expect(descendants.map((a) => a.role).sort()).toEqual([...OPERATING_EXPENSE_CHILD_ROLES].sort());
    for (const d of descendants) expect(d.type).toBe('EXPENSE');
  });

  it('lists a parent before its children so provisioning can link them in one pass', () => {
    const index = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a, i) => [a.code, i]));
    for (const a of SYSTEM_LEDGER_ACCOUNTS) {
      if (a.parentCode) expect(index.get(a.parentCode)!).toBeLessThan(index.get(a.code)!);
    }
  });

  it('adds prepaid expenses as an asset and renames 6000', () => {
    const prepaid = SYSTEM_LEDGER_ACCOUNTS.find((a) => a.role === LEDGER_ROLES.PREPAID_EXPENSES);
    expect(prepaid).toMatchObject({ code: '1400', type: 'ASSET' });
    expect(SYSTEM_LEDGER_ACCOUNTS.find((a) => a.code === '6000')!.name).toBe('Other operating expense');
  });
});

it('adds payroll accounts with the right types and parents', () => {
  const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
  expect(byCode.get('1450')).toMatchObject({ type: 'ASSET', role: 'EMPLOYEE_ADVANCES' });
  expect(byCode.get('2300')).toMatchObject({ type: 'LIABILITY', role: 'SALARIES_PAYABLE' });
  expect(byCode.get('2400')).toMatchObject({ type: 'LIABILITY', role: 'GRATUITY_PROVISION' });
  expect(byCode.get('6310')).toMatchObject({ type: 'EXPENSE', role: 'GRATUITY_EXPENSE', parentCode: '6000' });
  expect(OPERATING_EXPENSE_CHILD_ROLES).toContain('GRATUITY_EXPENSE');
});

it('adds the compliance accounts with the right types and parents', () => {
  const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
  expect(byCode.get('2410')).toMatchObject({ type: 'LIABILITY', role: 'LEAVE_PROVISION' });
  expect(byCode.get('2420')).toMatchObject({ type: 'LIABILITY', role: 'PENSION_PAYABLE' });
  expect(byCode.get('6320')).toMatchObject({ type: 'EXPENSE', role: 'LEAVE_EXPENSE', parentCode: '6000' });
  expect(byCode.get('6330')).toMatchObject({ type: 'EXPENSE', role: 'PENSION_EXPENSE', parentCode: '6000' });
  expect(OPERATING_EXPENSE_CHILD_ROLES).toEqual(expect.arrayContaining(['LEAVE_EXPENSE', 'PENSION_EXPENSE']));
});

it('adds Labour absorbed as a contra under Salaries & wages', () => {
  const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
  expect(byCode.get('6390')).toMatchObject({ type: 'EXPENSE', role: 'LABOUR_ABSORBED', parentCode: '6300' });
  expect(OPERATING_EXPENSE_CHILD_ROLES).toContain('LABOUR_ABSORBED');
});
