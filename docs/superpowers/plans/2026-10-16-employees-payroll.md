# Employees and Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees with versioned salary packages, monthly payroll runs (fixed package + extras) that post salary cost, gratuity accrual and payments to the ledger, an end-of-service provision with go-live opening balances, and payroll in the cash forecast.

**Architecture:** All arithmetic (proration, overtime, unpaid leave, net pay, gratuity entitlement) is pure code in `packages/shared/src/payroll/` with vitest tests. The API gets a new `PayrollModule` (`apps/api/src/modules/payroll/`) with entities, one migration, an AES-GCM crypto service for IBANs, and services that post journals through the existing `LedgerService.resolveLines`, following `PayablesService.approve`/`recordPayment`. The web app gets a People section (Employees, Payroll) using the bills list/detail pattern.

**Tech Stack:** NestJS 11, TypeORM 1, Postgres 18 (FORCE RLS), zod 4, vitest (shared), jest (api), Next.js 16 + TanStack Query + react-hook-form (web).

**Spec:** `docs/superpowers/specs/2026-10-16-employees-payroll-design.md`

## Global Constraints

- Branch `feat/employees-payroll` (based on `feat/overheads-recurring-posting`; it uses 6300 SALARIES, `OPERATING_EXPENSE_CHILD_ROLES`, the cash forecast and `RecurringInterval` from that branch).
- Use `corepack pnpm` (pnpm is not on PATH). After editing `packages/shared`, run `corepack pnpm --filter @saas/shared build` before api/web tests.
- No database is available locally: migrations are hand-written to mirror entity decorators exactly (names, case, types, defaults, index names); CI's schema job runs `migration:run`, `check:drift`, `seed`, `check:books`.
- Permissions only from `PERMISSIONS` constants; check `req.user.permissions`; never a hand-written string.
- Every query tenant-scoped; new tables `ENABLE` + `FORCE ROW LEVEL SECURITY` with the exact `tenant_isolation_policy` text used in `1789900000001-RecurringBillingAndPrepaid.ts:244-255`; migrations touching tenant data start with `SELECT set_config('app.bypass_rls','on',true)`.
- Ledger append-only; every posting balanced; corrections post reversals.
- Money `numeric(14,2)`, rounded with a `round2` (cents) helper; base currency only.
- Daily rate ÷ 30; overtime hourly = basic ÷ 30 ÷ 8; ×1.25 normal, ×1.5 night/rest day.
- Gratuity: 21 days/yr for first 5 years, 30 days/yr after, part-years pro rata, on latest basic ÷ 30, capped at 24 × basic; nationals 0; accrual from day one; monthly true-up.
- Commit trailer: `Co-Authored-By:` naming the committing model `<noreply@anthropic.com>`.

## Review Focus

1. **Payroll run for a month on or before the opening-gratuity cut-over** would double-count gratuity already booked as opening → creating such a run is refused (409). Test: Task 8 "refuses a run at or before the gratuity cut-over".
2. **Joiner on the last day / leaver on the first day / joined after month end** → 1 day prorated, 1 day prorated, no line. Test: Task 2 `daysEmployed` cases and Task 8 eligibility.
3. **Raise effective mid-month** → the package in effect on the last day applies to the whole month (spec), and gratuity true-up uses the new basic. Test: Task 8 "uses the package in effect at month end" and Task 9 "true-up after a raise".
4. **Paying a method twice, or a method with no lines** → second pay refused, empty method skipped without a zero journal. Test: Task 10.
5. **Unpaid leave in the current run reduces service days for that same run's accrual** (not only later runs). Test: Task 9 "current run's unpaid leave counts".

---

## File Structure

**Shared (`packages/shared/src/`)**
- Create `rbac/permissions/payroll.ts`; modify `rbac/permissions/index.ts`.
- Modify `finance/ledger.ts` (4 accounts, 4 roles, `'PAYROLL'`), `platform/attachments.ts` (`'EMPLOYEE'`).
- Create `payroll/calc.ts`, `payroll/gratuity.ts`, `payroll/types.ts`, `schemas/payroll.ts` (+ tests); export from `index.ts`.
- Modify `finance/types.ts` (`CashForecastMonthDto.payrollOut`).

**API (`apps/api/src/`)**
- Create `database/migrations/1790000000000-EmployeesAndPayroll.ts`.
- Modify `database/tenant-sequence.util.ts` (`employee_number`, `payroll_run_number`).
- Create `modules/payroll/` — `payroll.module.ts`; `entities/` (`employee`, `salary-package`, `employee-advance`, `payroll-run` (+ line), `gratuity-ledger-entry`); `payroll-crypto.service.ts`; `employees.service.ts`, `employees.controller.ts`, `employee-mask.ts`; `gratuity.service.ts`; `payroll-runs.service.ts`, `payroll-posting.service.ts`, `payroll-runs.controller.ts`, `payroll.controller.ts` (opening gratuity); specs beside each.
- Modify `modules/finance/entities/journal-entry.entity.ts` (enum), `modules/storage/attachment-owners.ts`, `modules/audit/audit-subjects.ts`, `modules/audit/audit.service.ts` (snapshot exclusions), `modules/finance/finance.service.ts` (forecast/runway), `feature-modules.ts`, `database/seeds/run-seed.ts`.

**Web (`apps/web/src/`)**
- Modify `lib/nav.ts`, `lib/api/endpoints/` (new `payroll.ts`), hooks `use-payroll.ts`.
- Create pages `app/(app)/people/employees/page.tsx`, `.../[id]/page.tsx`, `app/(app)/people/payroll/page.tsx`, `.../[id]/page.tsx`, `.../[id]/payslips/[lineId]/page.tsx`, `.../opening-gratuity/page.tsx`; components under `components/people/`.
- Modify `components/finance/dashboard/cash-forecast-chart.tsx`.

**Docs:** `docs/FLAGS.md`.

---

### Task 1: Shared — permissions, ledger accounts, reference type, attachment owner

**Files:**
- Create: `packages/shared/src/rbac/permissions/payroll.ts`
- Modify: `packages/shared/src/rbac/permissions/index.ts`, `packages/shared/src/finance/ledger.ts`, `packages/shared/src/platform/attachments.ts`
- Test: `packages/shared/src/rbac/permissions/payroll.test.ts`, `packages/shared/src/finance/ledger.test.ts`

**Interfaces:**
- Produces: `PERMISSIONS.{EMPLOYEE_READ, EMPLOYEE_MANAGE, PAYROLL_READ, PAYROLL_MANAGE, PAYROLL_APPROVE, PAYROLL_PAY}`; `LEDGER_ROLES.{EMPLOYEE_ADVANCES, SALARIES_PAYABLE, GRATUITY_PROVISION, GRATUITY_EXPENSE}`; `JournalReferenceType` includes `'PAYROLL'`; `AttachmentOwnerType` includes `'EMPLOYEE'`.

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/rbac/permissions/payroll.test.ts
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_DOMAINS } from './index';
import { permissionsForSystemRole } from '../roles';

describe('payroll permissions', () => {
  it('registers the six permissions', () => {
    expect(PERMISSIONS.EMPLOYEE_READ).toBe('employee:read');
    expect(PERMISSIONS.EMPLOYEE_MANAGE).toBe('employee:manage');
    expect(PERMISSIONS.PAYROLL_READ).toBe('payroll:read');
    expect(PERMISSIONS.PAYROLL_MANAGE).toBe('payroll:manage');
    expect(PERMISSIONS.PAYROLL_APPROVE).toBe('payroll:approve');
    expect(PERMISSIONS.PAYROLL_PAY).toBe('payroll:pay');
    expect(PERMISSION_DOMAINS.some((d) => d.key === 'payroll')).toBe(true);
  });

  it('gives managers the directory only, and members/viewers nothing', () => {
    const manager = permissionsForSystemRole('manager') ?? [];
    expect(manager).toContain('employee:read');
    expect(manager.filter((p) => p.startsWith('payroll:'))).toEqual([]);
    for (const slug of ['member', 'viewer'] as const) {
      const perms = permissionsForSystemRole(slug) ?? [];
      expect(perms.filter((p) => p.startsWith('employee:') || p.startsWith('payroll:'))).toEqual([]);
    }
  });
});
```

(Check the real export name/signature of `permissionsForSystemRole` in `packages/shared/src/rbac/roles.ts` and its accepted slugs; adapt the import, not the assertions.)

Append to `finance/ledger.test.ts`:

```ts
it('adds payroll accounts with the right types and parents', () => {
  const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
  expect(byCode.get('1450')).toMatchObject({ type: 'ASSET', role: 'EMPLOYEE_ADVANCES' });
  expect(byCode.get('2300')).toMatchObject({ type: 'LIABILITY', role: 'SALARIES_PAYABLE' });
  expect(byCode.get('2400')).toMatchObject({ type: 'LIABILITY', role: 'GRATUITY_PROVISION' });
  expect(byCode.get('6310')).toMatchObject({ type: 'EXPENSE', role: 'GRATUITY_EXPENSE', parentCode: '6000' });
  expect(OPERATING_EXPENSE_CHILD_ROLES).toContain('GRATUITY_EXPENSE');
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/rbac/permissions/payroll.test.ts src/finance/ledger.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/rbac/permissions/payroll.ts
import type { PermissionDomain, PermissionValues } from './domain';

export const PAYROLL_PERMISSIONS = {
  EMPLOYEE_READ: 'employee:read',
  EMPLOYEE_MANAGE: 'employee:manage',
  PAYROLL_READ: 'payroll:read',
  PAYROLL_MANAGE: 'payroll:manage',
  PAYROLL_APPROVE: 'payroll:approve',
  PAYROLL_PAY: 'payroll:pay',
} as const;

type PayrollPermission = PermissionValues<typeof PAYROLL_PERMISSIONS>;

export const payrollDomain: PermissionDomain<PayrollPermission> = {
  key: 'payroll',
  label: 'People & payroll',
  permissions: PAYROLL_PERMISSIONS,
  descriptions: {
    [PAYROLL_PERMISSIONS.EMPLOYEE_READ]: 'View the staff directory: names, titles, departments and status — not pay',
    [PAYROLL_PERMISSIONS.EMPLOYEE_MANAGE]: 'Add and edit employees, their documents and bank details',
    [PAYROLL_PERMISSIONS.PAYROLL_READ]: 'View salaries, payroll runs, payslips, gratuity and advances',
    [PAYROLL_PERMISSIONS.PAYROLL_MANAGE]: 'Prepare payroll runs, enter monthly extras and record salary changes',
    [PAYROLL_PERMISSIONS.PAYROLL_APPROVE]: 'Approve or void payroll runs and post gratuity opening balances',
    [PAYROLL_PERMISSIONS.PAYROLL_PAY]: 'Pay approved payroll runs and record salary advances',
  },
  groupPermissions: Object.values(PAYROLL_PERMISSIONS),
  grants: {
    admin: Object.values(PAYROLL_PERMISSIONS),
    // Pay is private: managers see who works here, not what they earn.
    manager: [PAYROLL_PERMISSIONS.EMPLOYEE_READ],
    member: [],
    viewer: [],
  },
};
```

In `index.ts`: `import { payrollDomain, PAYROLL_PERMISSIONS } from './payroll';`, spread `...PAYROLL_PERMISSIONS` into `PERMISSIONS`, and add `payrollDomain` to `PERMISSION_DOMAINS` right after the finance domain.

In `ledger.ts` add roles `EMPLOYEE_ADVANCES`, `SALARIES_PAYABLE`, `GRATUITY_PROVISION`, `GRATUITY_EXPENSE`; add accounts in code order (1450 after 1400; 2300, 2400 after 2200; 6310 after 6300):

```ts
  { code: '1450', name: 'Employee advances', type: 'ASSET', role: LEDGER_ROLES.EMPLOYEE_ADVANCES, description: 'Salary advances paid to employees and not yet recovered through payroll' },
  { code: '2300', name: 'Salaries payable', type: 'LIABILITY', role: LEDGER_ROLES.SALARIES_PAYABLE, description: 'Net pay from approved payroll runs not yet paid' },
  { code: '2400', name: 'End-of-service provision', type: 'LIABILITY', role: LEDGER_ROLES.GRATUITY_PROVISION, description: 'End-of-service gratuity earned by employees to date' },
  { code: '6310', name: 'End-of-service gratuity', type: 'EXPENSE', role: LEDGER_ROLES.GRATUITY_EXPENSE, parentCode: '6000', description: 'Monthly change in the end-of-service provision' },
```

Add `| 'PAYROLL'` to `JournalReferenceType`. In `attachments.ts` add `'EMPLOYEE'` to `ATTACHMENT_OWNER_TYPES`.

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build` → PASS (the existing `ledger.test.ts` invariants — unique codes/roles, parent before child — must still pass).

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): payroll permissions, payroll ledger accounts, PAYROLL reference, EMPLOYEE attachments"`

---

### Task 2: Shared — pay and gratuity calculation

**Files:**
- Create: `packages/shared/src/payroll/calc.ts`, `packages/shared/src/payroll/gratuity.ts`
- Test: `packages/shared/src/payroll/calc.test.ts`, `packages/shared/src/payroll/gratuity.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `round2(n: number): number`
  - `periodBounds(period: string): { first: string; last: string; daysInMonth: number }` (period `'YYYY-MM'`, ISO dates)
  - `daysEmployed(args: { period: string; joiningDate: string; leavingDate: string | null }): number`
  - `packageGross(p: { basic: number; housing: number; transport: number; otherAllowances: { label: string; amount: number }[] }): number`
  - `computeLine(input: LineInput): LineAmounts` where
    `LineInput = { gross: number; basic: number; daysEmployed: number; daysInMonth: number; overtimeHours: number; overtimeHoursPremium: number; bonusAmount: number; unpaidLeaveDays: number; advanceRecovery: number; otherDeductionAmount: number }` and
    `LineAmounts = { proratedGross: number; overtimeAmount: number; unpaidLeaveAmount: number; netPay: number; salaryCost: number }` (`salaryCost = proratedGross + overtimeAmount + bonusAmount − unpaidLeaveAmount`)
  - `gratuityEntitlement(args: { joiningDate: string; asOf: string; basic: number; unpaidLeaveDays: number; isNational: boolean }): { serviceDays: number; gratuityDays: number; amount: number }`

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/payroll/calc.test.ts
import { describe, expect, it } from 'vitest';
import { computeLine, daysEmployed, packageGross, periodBounds } from './calc';

describe('periodBounds', () => {
  it('gives first, last and length', () => {
    expect(periodBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28', daysInMonth: 28 });
    expect(periodBounds('2028-02').daysInMonth).toBe(29);
  });
});

describe('daysEmployed', () => {
  it('full month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2020-01-01', leavingDate: null })).toBe(31));
  it('joined on the last day', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2026-10-31', leavingDate: null })).toBe(1));
  it('left on the first day', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2020-01-01', leavingDate: '2026-10-01' })).toBe(1));
  it('joined mid-month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2026-10-15', leavingDate: null })).toBe(17));
  it('joined after the month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2026-11-01', leavingDate: null })).toBe(0));
  it('left before the month', () => expect(daysEmployed({ period: '2026-10', joiningDate: '2020-01-01', leavingDate: '2026-09-30' })).toBe(0));
});

describe('computeLine', () => {
  const base = { gross: 9000, basic: 6000, daysEmployed: 31, daysInMonth: 31, overtimeHours: 0, overtimeHoursPremium: 0, bonusAmount: 0, unpaidLeaveDays: 0, advanceRecovery: 0, otherDeductionAmount: 0 };

  it('full month, no extras', () => {
    expect(computeLine(base)).toEqual({ proratedGross: 9000, overtimeAmount: 0, unpaidLeaveAmount: 0, netPay: 9000, salaryCost: 9000 });
  });

  it('prorates by calendar days', () => {
    expect(computeLine({ ...base, daysEmployed: 17 }).proratedGross).toBe(4935.48);
  });

  it('overtime on basic ÷ 30 ÷ 8 at 1.25 and 1.5', () => {
    // hourly = 25; 10 × 1.25 × 25 = 312.5; 4 × 1.5 × 25 = 150
    expect(computeLine({ ...base, overtimeHours: 10, overtimeHoursPremium: 4 }).overtimeAmount).toBe(462.5);
  });

  it('unpaid leave on gross ÷ 30', () => {
    const r = computeLine({ ...base, unpaidLeaveDays: 2 });
    expect(r.unpaidLeaveAmount).toBe(600);
    expect(r.salaryCost).toBe(8400);
  });

  it('net pay subtracts recoveries and deductions; salary cost does not', () => {
    const r = computeLine({ ...base, bonusAmount: 500, advanceRecovery: 1000, otherDeductionAmount: 200 });
    expect(r.netPay).toBe(8300);
    expect(r.salaryCost).toBe(9500);
  });
});

describe('packageGross', () => {
  it('sums the package', () => {
    expect(packageGross({ basic: 6000, housing: 2000, transport: 800, otherAllowances: [{ label: 'Phone', amount: 200 }] })).toBe(9000);
  });
});
```

```ts
// packages/shared/src/payroll/gratuity.test.ts
import { describe, expect, it } from 'vitest';
import { gratuityEntitlement } from './gratuity';

describe('gratuityEntitlement', () => {
  it('3 years at 6,000 → 63 days → 12,600', () => {
    const r = gratuityEntitlement({ joiningDate: '2023-10-01', asOf: '2026-09-30', basic: 6000, unpaidLeaveDays: 0, isNational: false });
    expect(r.serviceDays).toBe(1096); // includes a leap day
    expect(r.amount).toBeCloseTo(12611.51, 2); // 1096/365 years × 21 days × 200
  });

  it('exactly 365 × 3 service days at 6,000 → 12,600', () => {
    const r = gratuityEntitlement({ joiningDate: '2021-01-01', asOf: '2023-12-31', basic: 6000, unpaidLeaveDays: 0, isNational: false });
    expect(r.serviceDays).toBe(1095);
    expect(r.gratuityDays).toBe(63);
    expect(r.amount).toBe(12600);
  });

  it('7 years (2555 days) at 10,000 → 165 days → 55,000', () => {
    const r = gratuityEntitlement({ joiningDate: '2016-01-01', asOf: '2022-12-30', basic: 10000, unpaidLeaveDays: 0, isNational: false });
    // 2016-01-01..2022-12-30 inclusive = 2556 days incl. 2 leap days; subtract 1 unpaid day → 2555
    const r2 = gratuityEntitlement({ joiningDate: '2016-01-01', asOf: '2022-12-30', basic: 10000, unpaidLeaveDays: 1, isNational: false });
    expect(r2.serviceDays).toBe(2555);
    expect(r2.gratuityDays).toBe(165);
    expect(r2.amount).toBe(55000);
    expect(r.serviceDays).toBe(2556);
  });

  it('switches to 30 days a year after year five', () => {
    const at5 = gratuityEntitlement({ joiningDate: '2020-01-01', asOf: '2020-01-01', basic: 3000, unpaidLeaveDays: -1824, isNational: false });
    expect(at5.gratuityDays).toBe(105); // 1825 days = 5 years → 5 × 21
  });

  it('caps at two years of basic', () => {
    const r = gratuityEntitlement({ joiningDate: '1990-01-01', asOf: '2026-01-01', basic: 10000, unpaidLeaveDays: 0, isNational: false });
    expect(r.amount).toBe(240000);
  });

  it('unpaid leave reduces service', () => {
    const a = gratuityEntitlement({ joiningDate: '2025-01-01', asOf: '2025-12-31', basic: 6000, unpaidLeaveDays: 0, isNational: false });
    const b = gratuityEntitlement({ joiningDate: '2025-01-01', asOf: '2025-12-31', basic: 6000, unpaidLeaveDays: 10, isNational: false });
    expect(b.serviceDays).toBe(a.serviceDays - 10);
    expect(b.amount).toBeLessThan(a.amount);
  });

  it('nationals accrue nothing', () => {
    expect(gratuityEntitlement({ joiningDate: '2020-01-01', asOf: '2026-01-01', basic: 10000, unpaidLeaveDays: 0, isNational: true }).amount).toBe(0);
  });

  it('asOf before joining → zero', () => {
    expect(gratuityEntitlement({ joiningDate: '2026-02-01', asOf: '2026-01-31', basic: 5000, unpaidLeaveDays: 0, isNational: false }).amount).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/payroll` → FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/payroll/calc.ts
/** Pay arithmetic. Dates are ISO calendar dates (UTC); amounts in base currency. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Inclusive day count between two ISO dates (0 when end < start). */
export function daysBetweenInclusive(start: string, end: string): number {
  const diff = Math.round((utc(end) - utc(start)) / 86_400_000) + 1;
  return Math.max(0, diff);
}

export function periodBounds(period: string): { first: string; last: string; daysInMonth: number } {
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${String(daysInMonth).padStart(2, '0')}`, daysInMonth };
}

export function daysEmployed(args: { period: string; joiningDate: string; leavingDate: string | null }): number {
  const { first, last } = periodBounds(args.period);
  const start = args.joiningDate > first ? args.joiningDate : first;
  const end = args.leavingDate && args.leavingDate < last ? args.leavingDate : last;
  return daysBetweenInclusive(start, end);
}

export interface PackageAmounts {
  basic: number;
  housing: number;
  transport: number;
  otherAllowances: { label: string; amount: number }[];
}

export function packageGross(p: PackageAmounts): number {
  return round2(p.basic + p.housing + p.transport + p.otherAllowances.reduce((s, a) => s + a.amount, 0));
}

export interface LineInput {
  gross: number;
  basic: number;
  daysEmployed: number;
  daysInMonth: number;
  overtimeHours: number;
  overtimeHoursPremium: number;
  bonusAmount: number;
  unpaidLeaveDays: number;
  advanceRecovery: number;
  otherDeductionAmount: number;
}

export interface LineAmounts {
  proratedGross: number;
  overtimeAmount: number;
  unpaidLeaveAmount: number;
  /** What the employee receives. */
  netPay: number;
  /** What the business expenses as salary: before recoveries and deductions. */
  salaryCost: number;
}

/** Overtime and unpaid leave use the UAE ÷ 30 daily rate; overtime is on basic, 8-hour days. */
export function computeLine(i: LineInput): LineAmounts {
  const proratedGross = round2((i.gross * i.daysEmployed) / i.daysInMonth);
  const hourly = i.basic / 30 / 8;
  const overtimeAmount = round2(hourly * (1.25 * i.overtimeHours + 1.5 * i.overtimeHoursPremium));
  const unpaidLeaveAmount = round2((i.gross / 30) * i.unpaidLeaveDays);
  const salaryCost = round2(proratedGross + overtimeAmount + i.bonusAmount - unpaidLeaveAmount);
  const netPay = round2(salaryCost - i.advanceRecovery - i.otherDeductionAmount);
  return { proratedGross, overtimeAmount, unpaidLeaveAmount, netPay, salaryCost };
}
```

```ts
// packages/shared/src/payroll/gratuity.ts
import { daysBetweenInclusive, round2 } from './calc';

/**
 * End-of-service gratuity earned to `asOf` (UAE Labour Law): 21 days of basic
 * per year for the first five years, 30 days per year after, part-years pro
 * rata, on the latest basic ÷ 30, capped at two years' basic. Unpaid leave
 * does not count as service. UAE/GCC nationals are on pension instead: 0.
 */
export function gratuityEntitlement(args: {
  joiningDate: string;
  asOf: string;
  basic: number;
  unpaidLeaveDays: number;
  isNational: boolean;
}): { serviceDays: number; gratuityDays: number; amount: number } {
  if (args.isNational) return { serviceDays: 0, gratuityDays: 0, amount: 0 };
  const serviceDays = Math.max(0, daysBetweenInclusive(args.joiningDate, args.asOf) - args.unpaidLeaveDays);
  const years = serviceDays / 365;
  const gratuityDays = 21 * Math.min(years, 5) + 30 * Math.max(years - 5, 0);
  const amount = Math.min(round2((gratuityDays * args.basic) / 30), round2(24 * args.basic));
  return { serviceDays, gratuityDays: Math.round(gratuityDays * 10000) / 10000, amount };
}
```

Export both modules from `index.ts`: `export * from './payroll/calc'; export * from './payroll/gratuity';`.

Note on the `at5` test: it uses a negative `unpaidLeaveDays` as a convenience to reach exactly 1825 service days from a 1-day span; if the implementer finds that confusing, replace with joining `2020-01-01`, asOf `2024-12-30` (1826 inclusive days incl. leap day) and `unpaidLeaveDays: 1` → 1825 days → 105 gratuity days. Either way assert `gratuityDays === 105`.

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build` → PASS.

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): payroll line and gratuity calculations"`

---

### Task 3: Shared — payroll schemas and DTOs

**Files:**
- Create: `packages/shared/src/schemas/payroll.ts`, `packages/shared/src/payroll/types.ts`
- Test: `packages/shared/src/schemas/payroll.test.ts`
- Modify: `packages/shared/src/finance/types.ts` (`CashForecastMonthDto.payrollOut: number`), `packages/shared/src/index.ts`

**Interfaces:**
- Produces schemas (each with `z.input`/`z.output` types exported as `<Name>Input` / `<Name>Payload`):
  - `createEmployeeSchema`, `updateEmployeeSchema` (partial)
  - `createSalaryPackageSchema`
  - `createPayrollRunSchema` `{ period: 'YYYY-MM', payDate?: 'YYYY-MM-DD' }`
  - `updatePayrollLineSchema` `{ overtimeHours?, overtimeHoursPremium?, bonusAmount?, bonusLabel?, unpaidLeaveDays?, advanceRecovery?, otherDeductionAmount?, otherDeductionLabel? }`
  - `payPayrollRunSchema` `{ method: 'BANK' | 'CASH', financeAccountId: uuid, paidAt?: date }`
  - `recordAdvanceSchema` `{ amount, financeAccountId, issuedAt?, note? }`
  - `openingGratuityPreviewSchema` `{ cutoverDate?: 'YYYY-MM-DD' }`, `postOpeningGratuitySchema` `{ cutoverDate, lines: [{ employeeId, amount ≥ 0 }] (min 1) }`
  - `gratuityAdjustmentSchema` `{ amount (≠ 0), note (required) }`
- Produces DTOs in `payroll/types.ts`: `EmployeeDto`, `SalaryPackageDto`, `EmployeeAdvanceDto`, `GratuityLedgerEntryDto`, `EmployeeGratuityDto { balance, entitlementToday, entries }`, `PayrollRunDto`, `PayrollRunLineDto`, `OpeningGratuityPreviewDto { cutoverDate, lines: [{ employeeId, employeeName, joiningDate, basic, serviceDays, calculated }] }`, `PayslipDto` (line + employee + organization name/legalName/address).

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/schemas/payroll.test.ts
import { describe, expect, it } from 'vitest';
import {
  createEmployeeSchema, createPayrollRunSchema, createSalaryPackageSchema,
  payPayrollRunSchema, postOpeningGratuitySchema, updatePayrollLineSchema, gratuityAdjustmentSchema,
} from './payroll';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('payroll schemas', () => {
  it('employee: normalises empties, requires a joining date, iban only for bank', () => {
    const out = createEmployeeSchema.parse({ firstName: 'Ada', lastName: 'Okafor', joiningDate: '2024-03-01', paymentMethod: 'BANK', iban: ' ae07 0331 2345 6789 0123 456 ', jobTitle: '' });
    expect(out).toMatchObject({ jobTitle: null, iban: 'AE070331234567890123456', isNational: false, status: 'ACTIVE' });
    expect(() => createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', paymentMethod: 'CASH' })).toThrow();
    expect(createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', joiningDate: '2024-01-01', paymentMethod: 'CASH', iban: 'AE07' }).iban).toBeNull();
  });

  it('employee: accepts nulls from a loaded record', () => {
    expect(() => createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', joiningDate: '2024-01-01', paymentMethod: 'CASH', userId: null, leavingDate: null, nationality: null, email: null, phone: null, bankName: null, department: null })).not.toThrow();
  });

  it('employee: leaving date must not precede joining', () => {
    expect(() => createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', joiningDate: '2024-05-01', leavingDate: '2024-04-30', paymentMethod: 'CASH' })).toThrow();
  });

  it('salary package coerces and defaults', () => {
    expect(createSalaryPackageSchema.parse({ effectiveFrom: '2026-01-01', basic: '6000', housing: '2000' }))
      .toEqual({ effectiveFrom: '2026-01-01', basic: 6000, housing: 2000, transport: 0, otherAllowances: [] });
    expect(() => createSalaryPackageSchema.parse({ effectiveFrom: '2026-01-01', basic: 0 })).toThrow();
  });

  it('run period format', () => {
    expect(createPayrollRunSchema.parse({ period: '2026-10' })).toEqual({ period: '2026-10', payDate: null });
    expect(() => createPayrollRunSchema.parse({ period: '2026-13' })).toThrow();
  });

  it('line extras are non-negative numbers; labels trimmed', () => {
    expect(updatePayrollLineSchema.parse({ overtimeHours: '10', bonusLabel: ' Q3 ' })).toEqual({ overtimeHours: 10, bonusLabel: 'Q3' });
    expect(() => updatePayrollLineSchema.parse({ unpaidLeaveDays: -1 })).toThrow();
  });

  it('pay and opening gratuity', () => {
    expect(payPayrollRunSchema.parse({ method: 'BANK', financeAccountId: uuid }).method).toBe('BANK');
    expect(() => postOpeningGratuitySchema.parse({ cutoverDate: '2026-09-30', lines: [] })).toThrow();
    expect(() => gratuityAdjustmentSchema.parse({ amount: 0, note: 'x' })).toThrow();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `schemas/payroll.ts` (follow `schemas/bill.ts` style: `optionalText`, nullish → null):

```ts
import { z } from 'zod';

const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v == null || v === '' ? null : v));
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(0).transform((n) => Math.round(n * 100) / 100);

const employeeFields = {
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  jobTitle: optionalText(120),
  department: optionalText(120),
  userId: z.string().uuid().nullish().transform((v) => v ?? null),
  joiningDate: isoDay,
  leavingDate: isoDay.nullish().transform((v) => v ?? null),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'LEFT']).default('ACTIVE'),
  nationality: z.string().trim().length(2).toUpperCase().nullish().transform((v) => v ?? null),
  isNational: z.boolean().default(false),
  paymentMethod: z.enum(['BANK', 'CASH']),
  bankName: optionalText(120),
  iban: z.string().nullish().transform((v) => (v == null ? null : v.replace(/\s+/g, '').toUpperCase() || null)),
  email: z.string().trim().email().nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  phone: optionalText(40),
};

const employeeRules = <T extends z.ZodTypeAny>(s: T) => s;

export const createEmployeeSchema = z
  .object(employeeFields)
  .refine((v) => !v.leavingDate || v.leavingDate >= v.joiningDate, { message: 'Leaving date cannot be before joining', path: ['leavingDate'] })
  .refine((v) => !v.iban || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v.iban), { message: 'Enter a valid IBAN', path: ['iban'] })
  .transform((v) => ({ ...v, iban: v.paymentMethod === 'BANK' ? v.iban : null, bankName: v.paymentMethod === 'BANK' ? v.bankName : null }));

export const updateEmployeeSchema = z
  .object(Object.fromEntries(Object.entries(employeeFields).map(([k, f]) => [k, (f as z.ZodTypeAny).optional()])) as { [K in keyof typeof employeeFields]: z.ZodOptional<(typeof employeeFields)[K]> })
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<z.output<typeof createEmployeeSchema>>);

export const createSalaryPackageSchema = z.object({
  effectiveFrom: isoDay,
  basic: z.coerce.number().positive('Basic must be above zero').transform((n) => Math.round(n * 100) / 100),
  housing: money.default(0),
  transport: money.default(0),
  otherAllowances: z.array(z.object({ label: z.string().trim().min(1).max(60), amount: money })).max(10).default([]),
});

export const createPayrollRunSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  payDate: isoDay.nullish().transform((v) => v ?? null),
});

export const updatePayrollLineSchema = z
  .object({
    overtimeHours: z.coerce.number().min(0).max(300).optional(),
    overtimeHoursPremium: z.coerce.number().min(0).max(300).optional(),
    bonusAmount: money.optional(),
    bonusLabel: optionalText(80).optional(),
    unpaidLeaveDays: z.coerce.number().min(0).max(31).optional(),
    advanceRecovery: money.optional(),
    otherDeductionAmount: money.optional(),
    otherDeductionLabel: optionalText(80).optional(),
  })
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as typeof v);

export const payPayrollRunSchema = z.object({
  method: z.enum(['BANK', 'CASH']),
  financeAccountId: z.string().uuid(),
  paidAt: z.coerce.date().optional(),
});

export const recordAdvanceSchema = z.object({
  amount: z.coerce.number().positive().transform((n) => Math.round(n * 100) / 100),
  financeAccountId: z.string().uuid(),
  issuedAt: z.coerce.date().optional(),
  note: optionalText(200),
});

export const openingGratuityPreviewSchema = z.object({ cutoverDate: isoDay.optional() });

export const postOpeningGratuitySchema = z.object({
  cutoverDate: isoDay,
  lines: z.array(z.object({ employeeId: z.string().uuid(), amount: money })).min(1, 'Choose at least one employee'),
});

export const gratuityAdjustmentSchema = z.object({
  amount: z.coerce.number().refine((n) => n !== 0, 'Amount cannot be zero').transform((n) => Math.round(n * 100) / 100),
  note: z.string().trim().min(1, 'Say why').max(200),
});

export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;
export type CreateEmployeePayload = z.output<typeof createEmployeeSchema>;
export type UpdateEmployeePayload = z.output<typeof updateEmployeeSchema>;
export type CreateSalaryPackagePayload = z.output<typeof createSalaryPackageSchema>;
export type CreatePayrollRunPayload = z.output<typeof createPayrollRunSchema>;
export type UpdatePayrollLinePayload = z.output<typeof updatePayrollLineSchema>;
export type PayPayrollRunPayload = z.output<typeof payPayrollRunSchema>;
export type RecordAdvancePayload = z.output<typeof recordAdvanceSchema>;
export type PostOpeningGratuityPayload = z.output<typeof postOpeningGratuitySchema>;
export type GratuityAdjustmentPayload = z.output<typeof gratuityAdjustmentSchema>;
```

Remove the unused `employeeRules` helper if lint flags it (it is not required). The update schema's IBAN/payment-method interplay is enforced in the service (Task 6).

`payroll/types.ts` — DTOs with every field the spec lists (§1–§3), amounts as `number`, dates as ISO strings:

```ts
export type EmployeeStatus = 'ACTIVE' | 'ON_HOLD' | 'LEFT';
export type PaymentMethod = 'BANK' | 'CASH';

export interface EmployeeDto {
  id: string; employeeNumber: string; firstName: string; lastName: string; fullName: string;
  jobTitle: string | null; department: string | null; userId: string | null;
  joiningDate: string; leavingDate: string | null; status: EmployeeStatus;
  nationality: string | null; isNational: boolean; paymentMethod: PaymentMethod;
  bankName: string | null;
  /** Full IBAN — only for employee:manage holders. */
  iban?: string | null;
  ibanMasked: string | null;
  email: string | null; phone: string | null;
  /** Present only for payroll:read holders. */
  currentPackage?: SalaryPackageDto | null;
  createdAt: string; updatedAt: string;
}

export interface SalaryPackageDto { id: string; employeeId: string; effectiveFrom: string; basic: number; housing: number; transport: number; otherAllowances: { label: string; amount: number }[]; gross: number; createdAt: string; }
export interface EmployeeAdvanceDto { id: string; employeeId: string; amount: number; issuedAt: string; financeAccountId: string; note: string | null; createdAt: string; }
export interface EmployeeAdvancesDto { advances: EmployeeAdvanceDto[]; recovered: number; outstanding: number; }
export type GratuityEntryKind = 'OPENING' | 'ACCRUAL' | 'ADJUSTMENT' | 'REVERSAL';
export interface GratuityLedgerEntryDto { id: string; kind: GratuityEntryKind; amount: number; asOf: string; runLineId: string | null; note: string | null; createdAt: string; }
export interface EmployeeGratuityDto { balance: number; entitlementToday: number; serviceDaysToday: number; entries: GratuityLedgerEntryDto[]; }

export type PayrollRunStatus = 'DRAFT' | 'APPROVED' | 'PARTIALLY_PAID' | 'PAID' | 'VOIDED';
export interface PayrollRunLineDto {
  id: string; employeeId: string; employeeName: string; employeeNumber: string; paymentMethod: PaymentMethod; isNational: boolean;
  basic: number; housing: number; transport: number; otherAllowances: { label: string; amount: number }[]; gross: number;
  daysEmployed: number; daysInMonth: number; proratedGross: number;
  overtimeHours: number; overtimeHoursPremium: number; overtimeAmount: number;
  bonusAmount: number; bonusLabel: string | null;
  unpaidLeaveDays: number; unpaidLeaveAmount: number;
  advanceRecovery: number; otherDeductionAmount: number; otherDeductionLabel: string | null;
  salaryCost: number; netPay: number;
  gratuityBefore: number | null; gratuityAccrual: number | null; gratuityAfter: number | null;
  flags: string[]; paidAt: string | null;
}
export interface PayrollRunTotalsDto { salaryCost: number; overtime: number; bonus: number; unpaidLeave: number; advanceRecovery: number; otherDeductions: number; net: number; gratuityAccrual: number; bankNet: number; cashNet: number; }
export interface PayrollRunDto {
  id: string; runNumber: string; period: string; payDate: string; status: PayrollRunStatus;
  totals: PayrollRunTotalsDto; bankPaidAt: string | null; cashPaidAt: string | null;
  approvedAt: string | null; approvedById: string | null; journalEntryId: string | null;
  lines?: PayrollRunLineDto[]; createdAt: string; updatedAt: string;
}
export interface OpeningGratuityPreviewDto { cutoverDate: string; lines: { employeeId: string; employeeName: string; joiningDate: string; basic: number; serviceDays: number; calculated: number }[]; }
export interface PayslipDto { run: Pick<PayrollRunDto, 'id' | 'runNumber' | 'period' | 'payDate' | 'status'>; line: PayrollRunLineDto; employee: Pick<EmployeeDto, 'id' | 'employeeNumber' | 'fullName' | 'jobTitle' | 'department' | 'joiningDate' | 'paymentMethod' | 'bankName' | 'ibanMasked'>; organization: { name: string; legalName: string | null; address: string | null; baseCurrency: string }; }
```

Add `payrollOut: number` to `CashForecastMonthDto` (finance/types.ts). Export `schemas/payroll` and `payroll/types` from `index.ts`.

- [ ] **Step 4: Run** — shared test + build → PASS. Then `corepack pnpm --filter api exec tsc --noEmit -p tsconfig.json` and `corepack pnpm --filter web exec tsc --noEmit`: the new required `payrollOut` field breaks the forecast builder in `apps/api/src/modules/finance/finance.service.ts` and any web fixture — set `payrollOut: 0` there now (Task 11 fills it) so both compile.

- [ ] **Step 5: Commit** — `git add packages/shared/src apps && git commit -m "feat(shared): payroll schemas and DTOs"`

---

### Task 4: API — migration, entities, module skeleton

**Files:**
- Create: `apps/api/src/database/migrations/1790000000000-EmployeesAndPayroll.ts`
- Create: `apps/api/src/modules/payroll/entities/employee.entity.ts`, `salary-package.entity.ts`, `employee-advance.entity.ts`, `payroll-run.entity.ts` (`PayrollRun`, `PayrollRunLine`), `gratuity-ledger-entry.entity.ts`
- Create: `apps/api/src/modules/payroll/payroll.module.ts`
- Modify: `apps/api/src/feature-modules.ts`, `apps/api/src/database/tenant-sequence.util.ts`, `apps/api/src/modules/finance/entities/journal-entry.entity.ts`
- Test: `apps/api/src/database/payroll-migration.spec.ts`

**Interfaces:**
- Produces entities (snake_case column names via `name:` like `supplier-bill.entity.ts`; `numericTransformer` from `../../finance/entities/finance-account.entity`; dates as `type: 'date'` → `string`):
  - `Employee` (extends `SoftDeletableEntity` from `@/common/entities/base.entity`): `tenantId, employeeNumber, firstName, lastName, jobTitle|null, department|null, userId|null, joiningDate, leavingDate|null, status, nationality|null, isNational, paymentMethod, bankName|null, ibanEncrypted|null, ibanLast4|null, email|null, phone|null`. Indexes: `idx_employees_tenant` (tenant_id); unique `uq_employees_tenant_number` (tenant_id, employee_number) where `"deletedAt" IS NULL`; unique `uq_employees_tenant_user` (tenant_id, user_id) where `user_id IS NOT NULL AND "deletedAt" IS NULL`.
  - `SalaryPackage`: `id, tenantId, employeeId, effectiveFrom, basic, housing, transport, otherAllowances (jsonb), createdById|null, createdAt`. Unique `uq_salary_packages_employee_from` (employee_id, effective_from).
  - `EmployeeAdvance`: `id, tenantId, employeeId, amount, issuedAt (timestamptz), financeAccountId, journalEntryId, note|null, createdById|null, createdAt`.
  - `PayrollRun`: `id, tenantId, runNumber, period (char 7), payDate (date), status (varchar 20, default 'DRAFT'), totalSalaryCost, totalOvertime, totalBonus, totalUnpaidLeave, totalAdvanceRecovery, totalOtherDeductions, totalNet, totalGratuityAccrual (numeric 14,2 default 0), bankPaidAt|null, cashPaidAt|null, approvedById|null, approvedAt|null, journalEntryId|null, voidJournalEntryId|null, createdById|null, createdAt, updatedAt`; `lines: PayrollRunLine[]` (OneToMany, cascade insert, eager false). Unique `uq_payroll_runs_tenant_period` (tenant_id, period) where `status <> 'VOIDED'`.
  - `PayrollRunLine`: `id, tenantId, runId, employeeId, employeeName, employeeNumber, paymentMethod, isNational, packageId|null, basic, housing, transport, otherAllowances (jsonb), gross, daysEmployed (int), daysInMonth (int), proratedGross, overtimeHours (numeric 7,2), overtimeHoursPremium (numeric 7,2), overtimeAmount, bonusAmount, bonusLabel|null, unpaidLeaveDays (numeric 5,2), unpaidLeaveAmount, advanceRecovery, otherDeductionAmount, otherDeductionLabel|null, salaryCost, netPay, gratuityBefore|null, gratuityAccrual|null, gratuityAfter|null, flags (text[] default '{}'), paidAt|null`. Unique `uq_payroll_run_lines_run_employee` (run_id, employee_id).
  - `GratuityLedgerEntry`: `id, tenantId, employeeId, kind (varchar 20), amount (numeric 14,2, signed), asOf (date), runLineId|null, journalEntryId|null, note|null, createdAt`. Index `idx_gratuity_ledger_employee` (tenant_id, employee_id).
- `TenantSequenceName` gains `'employee_number' | 'payroll_run_number'`.
- `JournalEntry.referenceType` enum array gains `'PAYROLL'`.

- [ ] **Step 1: Entities** — write the five entity files with the decorators above (mirror `supplier-bill.entity.ts` for style, `numericTransformer` / `nullableNumericTransformer` from `../../catalog/entities/numeric.transformer`).

- [ ] **Step 2: Migration** — hand-write `EmployeesAndPayroll1790000000000` so it creates exactly that schema. Structure `up()`:
  1. `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'PAYROLL'`.
  2. `CREATE TABLE` for the six tables (uuid PK default `gen_random_uuid()`), every index from Step 1 with the exact names, FKs: `tenant_id → organizations(id) ON DELETE CASCADE` on all; `employees.user_id → users(id) ON DELETE SET NULL`; `salary_packages.employee_id → employees(id) ON DELETE CASCADE`; `employee_advances.employee_id → employees(id) ON DELETE RESTRICT`, `.finance_account_id → finance_accounts(id) ON DELETE RESTRICT`, `.journal_entry_id → journal_entries(id) ON DELETE RESTRICT`; `payroll_run_lines.run_id → payroll_runs(id) ON DELETE CASCADE`, `.employee_id → employees(id) ON DELETE RESTRICT`; `payroll_runs.journal_entry_id`/`void_journal_entry_id → journal_entries(id) ON DELETE RESTRICT`; `gratuity_ledger_entries.employee_id → employees(id) ON DELETE RESTRICT`, `.run_line_id → payroll_run_lines(id) ON DELETE SET NULL`, `.journal_entry_id → journal_entries(id) ON DELETE RESTRICT`. CHECKs: `payroll_runs.status IN ('DRAFT','APPROVED','PARTIALLY_PAID','PAID','VOIDED')`, `employees.status IN ('ACTIVE','ON_HOLD','LEFT')`, `employees.payment_method IN ('BANK','CASH')`, `gratuity_ledger_entries.kind IN ('OPENING','ACCRUAL','ADJUSTMENT','REVERSAL','SETTLEMENT')`.
  3. `SELECT set_config('app.bypass_rls','on',true)` then backfill the four ledger accounts exactly like `1789900000000-ExpenseAccountsAndPrepaid.ts` (code-or-role guard; 6310's parent is the tenant's OPERATING_EXPENSE 6000).
  4. RLS on all six tables with the policy loop copied from `1789900000001-RecurringBillingAndPrepaid.ts:244-255`.
  `down()`: drop tables (children first), soft-delete the four accounts by role (the enum value stays; comment why).

Check column naming against `check-drift.mjs` expectations by reading `scripts/check-drift.mjs` and the two #1 migrations before writing.

- [ ] **Step 3: Module skeleton** — `payroll.module.ts` registering the six entities with `TypeOrmModule.forFeature`, importing `FinanceModule` (for `LedgerService`), `NotificationsModule` not needed; add `PayrollModule` to `FEATURE_MODULES` in `feature-modules.ts`. Add sequence names and enum value.

- [ ] **Step 4: Migration test** — `apps/api/src/database/payroll-migration.spec.ts`: run `up()` against a recording `QueryRunner` mock (`{ query: jest.fn() }`) and assert: the ADD VALUE statement is first; every `CREATE TABLE` names one of the six tables; `FORCE ROW LEVEL SECURITY` is issued for each of the six; the backfill inserts codes `1450`, `2300`, `2400`, `6310`; `bypass_rls` precedes the first `INSERT`.

- [ ] **Step 5: Run** — `corepack pnpm --filter api exec jest src/database/payroll-migration.spec.ts` → PASS; `corepack pnpm --filter api test` → PASS; `corepack pnpm --filter api build` → OK.

- [ ] **Step 6: Commit** — `git add apps/api/src && git commit -m "feat(api): payroll schema, entities and module"`

---

### Task 5: API — IBAN encryption

**Files:**
- Create: `apps/api/src/modules/payroll/payroll-crypto.service.ts`
- Test: `apps/api/src/modules/payroll/payroll-crypto.service.spec.ts`
- Modify: `apps/api/src/modules/payroll/payroll.module.ts`, `apps/api/.env.example`, `.env.example`, `docs/DEPLOYMENT.md` (one line under environment variables)

**Interfaces:**
- Produces: `PayrollCryptoService.encrypt(plain: string): string`, `.decrypt(cipher: string): string`, constructor validates the key; static `PayrollCryptoService.keyFromEnv(env: NodeJS.ProcessEnv): Buffer` (throws in production when missing/invalid).

- [ ] **Step 1: Failing tests**

```ts
import { PayrollCryptoService } from './payroll-crypto.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('PayrollCryptoService', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const s = new PayrollCryptoService({ PAYROLL_DATA_KEY: KEY, NODE_ENV: 'test' } as any);
    const a = s.encrypt('AE070331234567890123456');
    const b = s.encrypt('AE070331234567890123456');
    expect(a).not.toBe(b);
    expect(s.decrypt(a)).toBe('AE070331234567890123456');
  });

  it('rejects tampered ciphertext', () => {
    const s = new PayrollCryptoService({ PAYROLL_DATA_KEY: KEY, NODE_ENV: 'test' } as any);
    const c = Buffer.from(s.encrypt('AE07'), 'base64');
    c[c.length - 1] ^= 1;
    expect(() => s.decrypt(c.toString('base64'))).toThrow();
  });

  it('refuses to start in production without a valid key', () => {
    expect(() => new PayrollCryptoService({ NODE_ENV: 'production' } as any)).toThrow(/PAYROLL_DATA_KEY/);
    expect(() => new PayrollCryptoService({ NODE_ENV: 'production', PAYROLL_DATA_KEY: 'short' } as any)).toThrow(/32 bytes/);
  });

  it('uses a dev key outside production', () => {
    expect(() => new PayrollCryptoService({ NODE_ENV: 'development' } as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const DEV_KEY = Buffer.alloc(32, 1); // never used in production

/** AES-256-GCM for employee bank details. Output: base64(iv[12] | tag[16] | data). */
@Injectable()
export class PayrollCryptoService {
  private readonly logger = new Logger(PayrollCryptoService.name);
  private readonly key: Buffer;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.key = PayrollCryptoService.keyFromEnv(env, this.logger);
  }

  static keyFromEnv(env: NodeJS.ProcessEnv, logger?: Logger): Buffer {
    const raw = env.PAYROLL_DATA_KEY;
    if (!raw) {
      if (env.NODE_ENV === 'production') {
        throw new Error('PAYROLL_DATA_KEY is required in production (32 bytes, base64). Employee bank details are encrypted with it.');
      }
      logger?.warn('PAYROLL_DATA_KEY not set; using a development key. Never run production like this.');
      return DEV_KEY;
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('PAYROLL_DATA_KEY must decode to 32 bytes (base64).');
    return key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }
}
```

Register as a provider with a factory so the env is injected: `{ provide: PayrollCryptoService, useFactory: () => new PayrollCryptoService(process.env) }`. Because the module is instantiated at boot, a missing production key fails boot. Add `PAYROLL_DATA_KEY=` with a comment (`openssl rand -base64 32`) to both `.env.example` files and one line to `docs/DEPLOYMENT.md`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(api): encrypt employee bank details at rest`

---

### Task 6: API — employees, salary packages, masking, documents, audit

**Files:**
- Create: `apps/api/src/modules/payroll/employees.service.ts`, `employees.controller.ts`, `employee-mask.ts`
- Test: `employees.service.spec.ts`, `employee-mask.spec.ts`
- Modify: `apps/api/src/modules/storage/attachment-owners.ts`, `apps/api/src/modules/audit/audit-subjects.ts`, `apps/api/src/modules/audit/audit.service.ts`, `payroll.module.ts`

**Interfaces:**
- Consumes: Task 3 schemas/DTOs, Task 4 entities, Task 5 crypto, `allocateNextSequenceValue`/`formatSequenceNumber` (`apps/api/src/database/tenant-sequence.util.ts`), `packageGross`.
- Produces (`EmployeesService`):
  - `list(tenantId, q: { status?: EmployeeStatus; search?: string }): Promise<EmployeeView[]>`
  - `get(tenantId, id): Promise<EmployeeView>`
  - `create(tenantId, actorId, input: CreateEmployeePayload): Promise<EmployeeView>`
  - `update(tenantId, id, input: UpdateEmployeePayload): Promise<EmployeeView>`
  - `listPackages(tenantId, employeeId): Promise<SalaryPackageDto[]>`, `addPackage(tenantId, employeeId, actorId, input): Promise<SalaryPackageDto>`
  - `packageAt(manager, tenantId, employeeId, date: string): Promise<SalaryPackage | null>` (greatest `effectiveFrom ≤ date`)
  - `EmployeeView` = internal shape with `iban: string | null` (decrypted) and `currentPackage: SalaryPackageDto | null`.
- Produces (`employee-mask.ts`): `maskEmployee(view: EmployeeView, permissions: Permission[]): EmployeeDto` — drops `iban` unless `EMPLOYEE_MANAGE`, drops `currentPackage` unless `PAYROLL_READ`; always sets `ibanMasked` (`'•••• ' + last4` or null).

- [ ] **Step 1: Failing tests** — `employee-mask.spec.ts`:

```ts
import { PERMISSIONS } from '@saas/shared';
import { maskEmployee } from './employee-mask';

const view: any = { id: 'e1', employeeNumber: 'EMP-2026-0001', firstName: 'Ada', lastName: 'Okafor', iban: 'AE070331234567890123456', ibanLast4: '3456', currentPackage: { basic: 6000 }, createdAt: new Date(), updatedAt: new Date() };

it('directory readers see no pay and a masked IBAN', () => {
  const dto = maskEmployee(view, [PERMISSIONS.EMPLOYEE_READ]);
  expect(dto).not.toHaveProperty('iban');
  expect(dto).not.toHaveProperty('currentPackage');
  expect(dto.ibanMasked).toBe('•••• 3456');
});
it('payroll readers see the package, not the IBAN', () => {
  const dto = maskEmployee(view, [PERMISSIONS.EMPLOYEE_READ, PERMISSIONS.PAYROLL_READ]);
  expect(dto.currentPackage).toEqual({ basic: 6000 });
  expect(dto).not.toHaveProperty('iban');
});
it('employee managers see the full IBAN', () => {
  expect(maskEmployee(view, [PERMISSIONS.EMPLOYEE_MANAGE]).iban).toBe('AE070331234567890123456');
});
```

`employees.service.spec.ts` (in-memory repo mocks in the style of `finance.service.spec.ts`):
- create assigns `EMP-YYYY-NNNN`, encrypts the IBAN (stored `ibanEncrypted` ≠ plain, `ibanLast4` = last four), never stores plain IBAN.
- create refuses a `userId` already linked to another employee in the tenant (409) and a `userId` from another tenant / nonexistent (400).
- update switching `paymentMethod` to `CASH` clears `ibanEncrypted`, `ibanLast4`, `bankName`; switching to `BANK` without an IBAN on file and none in input → 400 "Bank payees need an IBAN".
- update to `status: 'LEFT'` without a `leavingDate` → 400.
- `addPackage` refuses a duplicate `effectiveFrom` (409) and an `effectiveFrom` before `joiningDate` (400).
- `packageAt` picks the latest `effectiveFrom ≤ date`; returns null before the first.
- `list` with `search` matches name, number, job title (case-insensitive) and is tenant-scoped.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Mask helper:

```ts
// apps/api/src/modules/payroll/employee-mask.ts
import { PERMISSIONS, type EmployeeDto, type Permission, type SalaryPackageDto } from '@saas/shared';

export interface EmployeeView extends Omit<EmployeeDto, 'iban' | 'ibanMasked' | 'currentPackage'> {
  iban: string | null;
  ibanLast4: string | null;
  currentPackage: SalaryPackageDto | null;
}

/** Pay is private: the directory never carries salary, and only employee managers see a full IBAN. */
export function maskEmployee(view: EmployeeView, permissions: Permission[]): EmployeeDto {
  const { iban, ibanLast4, currentPackage, ...rest } = view;
  const dto: EmployeeDto = { ...rest, ibanMasked: ibanLast4 ? `•••• ${ibanLast4}` : null };
  if (permissions.includes(PERMISSIONS.EMPLOYEE_MANAGE)) dto.iban = iban;
  if (permissions.includes(PERMISSIONS.PAYROLL_READ)) dto.currentPackage = currentPackage;
  return dto;
}
```

Service: CRUD on `Employee` scoped by `tenantId`; number via `allocateNextSequenceValue(manager, tenantId, 'employee_number')` + `formatSequenceNumber('EMP', seq)` inside a transaction; IBAN through `PayrollCryptoService`; `fullName = first + ' ' + last`; `currentPackage = packageAt(today)`; `userId` validated against `User` in the same tenant (`organizationId` column on users — check the entity) and uniqueness pre-checked for a clear 409.

Controller (`@Controller('employees')`, guards like `finance.controller.ts`):

| Route | Permission | Body |
|---|---|---|
| `GET /employees?status&search` | `EMPLOYEE_READ` | — |
| `GET /employees/:id` | `EMPLOYEE_READ` | — |
| `POST /employees` | `EMPLOYEE_MANAGE` | `zodBody(createEmployeeSchema)` |
| `PATCH /employees/:id` | `EMPLOYEE_MANAGE` | `zodBody(updateEmployeeSchema)` |
| `GET /employees/:id/salary-packages` | `PAYROLL_READ` | — |
| `POST /employees/:id/salary-packages` | `PAYROLL_MANAGE` | `zodBody(createSalaryPackageSchema)` |

Every response goes through `maskEmployee(view, user.permissions)`.

Attachments: add to `attachment-owners.ts`: `EMPLOYEE: { entity: Employee, read: PERMISSIONS.EMPLOYEE_MANAGE, write: PERMISSIONS.EMPLOYEE_MANAGE, label: 'employee' }` (match the real shape of existing entries).

Audit: in `audit-subjects.ts` add `employees: { subject: 'EMPLOYEE', entity: Employee }` and `'payroll-runs': { subject: 'PAYROLL_RUN', entity: PayrollRun }` and `'payroll/opening-gratuity': { subject: 'PAYROLL', entity: PayrollRun }` — check that `auditSubjectFor` (two-segment lookup first) handles the `payroll/...` key; it does for mapped keys. In `audit.service.ts` `snapshot()`, skip columns listed in a new `AUDIT_REDACTED_COLUMNS = new Set(['ibanEncrypted', 'passwordHash'])` (add `passwordHash` only if not already excluded elsewhere — check). Test: `audit.service.spec.ts` gains "snapshot omits ibanEncrypted".

- [ ] **Step 4: Run** — `corepack pnpm --filter api exec jest src/modules/payroll src/modules/audit` → PASS; full api test → PASS.

- [ ] **Step 5: Commit** — `feat(api): employees, salary packages, masking, documents and audit`

---

### Task 7: API — advances and the gratuity ledger

**Files:**
- Create: `apps/api/src/modules/payroll/gratuity.service.ts`, `apps/api/src/modules/payroll/advances.service.ts`, `apps/api/src/modules/payroll/payroll.controller.ts`
- Test: `gratuity.service.spec.ts`, `advances.service.spec.ts`
- Modify: `employees.controller.ts` (advance + gratuity routes), `payroll.module.ts`

**Interfaces:**
- Consumes: `gratuityEntitlement`, `LedgerService.resolveLines`, `EmployeesService.packageAt`, `FinanceAccount`, `JournalEntry`.
- Produces:
  - `AdvancesService.record(tenantId, employeeId, actorId, input: RecordAdvancePayload): Promise<EmployeeAdvanceDto>` — posts `Dr EMPLOYEE_ADVANCES / Cr financeAccount`, decreases the finance account balance (same SQL as bill payment), `referenceType 'PAYROLL'`, `referenceId 'advance:<id>'`, `entryNumber 'JE-ADV-<employeeNumber>-<first 8 of id>'`.
  - `AdvancesService.outstanding(manager, tenantId, employeeId, excludeRunId?: string): Promise<number>` — Σ advances − Σ `advanceRecovery` on lines of runs with status in (APPROVED, PARTIALLY_PAID, PAID), excluding `excludeRunId`.
  - `AdvancesService.list(tenantId, employeeId): Promise<EmployeeAdvancesDto>`.
  - `GratuityService.balance(manager, tenantId, employeeId): Promise<number>` (Σ amount).
  - `GratuityService.unpaidLeaveDaysTo(manager, tenantId, employeeId, asOf: string, extraDays = 0): Promise<number>` — Σ `unpaidLeaveDays` on lines of non-voided, non-draft runs whose period's last day ≤ asOf, + `extraDays`.
  - `GratuityService.entitlement(manager, tenantId, employee: Employee, asOf: string, extraUnpaidDays = 0): Promise<{ serviceDays: number; amount: number; basic: number }>` — package at `asOf` (0 if none).
  - `GratuityService.summary(tenantId, employeeId): Promise<EmployeeGratuityDto>`.
  - `GratuityService.previewOpening(tenantId, cutoverDate?: string): Promise<OpeningGratuityPreviewDto>` — default cutover = last day of the month before the earliest non-voided run, else last day of last month (UTC). Lines: employees not `LEFT`, `joiningDate ≤ cutover`, no OPENING row.
  - `GratuityService.postOpening(tenantId, actorId, input: PostOpeningGratuityPayload): Promise<{ journalEntryId: string; total: number }>` — refuses if any listed employee already has OPENING (409) or does not qualify (400); refuses if a non-voided approved run exists with period end ≤ cutover (409: "Runs already posted for or before the cut-over"); posts one entry `Dr OPENING_BALANCE_EQUITY / Cr GRATUITY_PROVISION` for the total (skip zero lines but still write a zero OPENING row so the employee is marked as set up), `referenceType 'PAYROLL'`, `referenceId 'gratuity-opening:<cutoverDate>'`, `entryDate` = cutover; one OPENING row per line `{ amount, asOf: cutover, journalEntryId }`. Persist the cutover as the max OPENING `asOf` (no separate table).
  - `GratuityService.latestCutover(manager, tenantId): Promise<string | null>` (max OPENING asOf).
  - `GratuityService.adjust(tenantId, employeeId, actorId, input: GratuityAdjustmentPayload): Promise<GratuityLedgerEntryDto>` — `Dr OPENING_BALANCE_EQUITY / Cr GRATUITY_PROVISION` for positive, reversed sides for negative; ADJUSTMENT row.

Routes: `GET /employees/:id/advances` (`PAYROLL_READ`), `POST /employees/:id/advances` (`PAYROLL_PAY`), `GET /employees/:id/gratuity` (`PAYROLL_READ`), `POST /employees/:id/gratuity-adjustments` (`PAYROLL_APPROVE`); in `payroll.controller.ts` (`@Controller('payroll')`): `POST /payroll/opening-gratuity/preview` (`PAYROLL_MANAGE`), `POST /payroll/opening-gratuity` (`PAYROLL_APPROVE`).

- [ ] **Step 1: Failing tests** (`gratuity.service.spec.ts`, `advances.service.spec.ts`, using in-memory manager mocks and a `resolveLines` mock that echoes roles):
  - advance posts a balanced entry with roles `EMPLOYEE_ADVANCES` debit and the finance account credit, and decrements the account balance query.
  - outstanding = 5000 advanced − 1000 recovered on an approved run = 4000; recovery on a DRAFT or VOIDED run is not counted; `excludeRunId` excluded.
  - previewOpening default cutover with no runs = last day of last month (fake timers at 2026-10-16 → `2026-09-30`); excludes joiners after cutover, LEFT employees and employees with OPENING.
  - postOpening posts one entry for the total with `OPENING_BALANCE_EQUITY` debit / `GRATUITY_PROVISION` credit and writes one OPENING row per line; a second post for the same employee → 409; overriding amounts are respected.
  - adjust negative amount posts reversed sides.
  - unpaidLeaveDaysTo sums only approved/paid, non-voided runs with period end ≤ asOf, plus `extraDays`.

- [ ] **Step 2–4:** run → FAIL, implement, run → PASS (`corepack pnpm --filter api exec jest src/modules/payroll`).

- [ ] **Step 5: Commit** — `feat(api): employee advances and the gratuity ledger with go-live opening balances`

---

### Task 8: API — payroll runs: create, edit, refresh

**Files:**
- Create: `apps/api/src/modules/payroll/payroll-runs.service.ts`, `apps/api/src/modules/payroll/payroll-runs.controller.ts`
- Test: `apps/api/src/modules/payroll/payroll-runs.service.spec.ts`
- Modify: `payroll.module.ts`

**Interfaces:**
- Consumes: `periodBounds`, `daysEmployed`, `packageGross`, `computeLine`, `round2`, `EmployeesService.packageAt`, `AdvancesService.outstanding`, `GratuityService.latestCutover`.
- Produces (`PayrollRunsService`):
  - `create(tenantId, actorId, input: CreatePayrollRunPayload): Promise<PayrollRunDto>`
  - `list(tenantId): Promise<PayrollRunDto[]>` (no lines), `get(tenantId, id): Promise<PayrollRunDto>` (with lines ordered by employee number)
  - `updateLine(tenantId, runId, lineId, input: UpdatePayrollLinePayload): Promise<PayrollRunDto>`
  - `refresh(tenantId, runId): Promise<PayrollRunDto>`
  - `payslip(tenantId, runId, lineId): Promise<PayslipDto>`
  - internal `recalcLine(line: PayrollRunLine): void` and `recalcTotals(run: PayrollRun): void` (exported for Task 9/10 via the service).

Rules:
- create: period validated; refuse if a non-voided run exists for the period (409 "October 2026 already has payroll run PR-…"); refuse if `latestCutover ≥ periodBounds(period).last` (409 "Gratuity opening balances were set up as of <date>; payroll for <period> is already in them"); `payDate` default `<period>-28`; number via sequence `payroll_run_number` → `formatSequenceNumber('PR', seq)`. Lines for employees with `status === 'ACTIVE'` and `daysEmployed > 0`; employees with no package at month end are **skipped and reported** in the response as `warnings: ['EMP-… has no salary package for <period>']` (add optional `warnings?: string[]` to `PayrollRunDto` in shared — do it in this task and rebuild shared). Line snapshot from the package at month end; `gross = packageGross(pkg)`; `flags = isNational ? ['NATIONAL_PENSION_NOT_HANDLED'] : []`; extras 0; then `recalcLine`.
- recalcLine uses `computeLine`; sets `proratedGross, overtimeAmount, unpaidLeaveAmount, salaryCost, netPay`.
- updateLine: run must be DRAFT (409 otherwise); apply input; `advanceRecovery ≤ outstanding(employee, excludeRunId: runId)` (400 "Only <x> of <name>'s advance is outstanding"); `unpaidLeaveDays ≤ daysEmployed` (400); recalc; `netPay < 0` → 400 "<name>'s deductions exceed their pay"; recalc totals; save.
- refresh: DRAFT only; re-snapshot packages/days for existing lines keeping extras; add newly eligible employees; remove lines whose employee is no longer eligible; recalc; same warnings.
- totals: `totalSalaryCost = Σ salaryCost`, `totalOvertime`, `totalBonus`, `totalUnpaidLeave`, `totalAdvanceRecovery`, `totalOtherDeductions`, `totalNet`; DTO totals also give `bankNet`/`cashNet` by line payment method.

Controller (`@Controller('payroll-runs')`): `GET /` + `GET /:id` + `GET /:id/lines/:lineId` (`PAYROLL_READ`); `POST /` (`PAYROLL_MANAGE`, `zodBody(createPayrollRunSchema)`); `PATCH /:id/lines/:lineId` (`PAYROLL_MANAGE`, `zodBody(updatePayrollLineSchema)`); `POST /:id/refresh` (`PAYROLL_MANAGE`).

- [ ] **Step 1: Failing tests** (in-memory mocks):
  - creates lines only for ACTIVE employees employed in the month (ON_HOLD, LEFT-before-month, joins-after-month excluded); mid-month joiner prorated.
  - uses the package in effect at month end (raise effective the 15th applies to the whole month).
  - employee with no package → skipped with a warning.
  - national → flag set.
  - duplicate period → 409; voided run for the period does not block.
  - refuses a run at or before the gratuity cut-over (409).
  - updateLine recomputes amounts and totals; refuses on non-DRAFT; refuses advance recovery above outstanding; refuses negative net; refuses unpaid leave days above days employed.
  - refresh keeps extras, adds a new joiner, drops an employee set to ON_HOLD.
  - payslip returns line + employee (masked IBAN) + organization.

- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.

- [ ] **Step 5: Commit** — `feat(api): payroll runs with monthly extras`

---

### Task 9: API — approve and void (posting + gratuity true-up)

**Files:**
- Create: `apps/api/src/modules/payroll/payroll-posting.service.ts`
- Test: `apps/api/src/modules/payroll/payroll-posting.service.spec.ts`
- Modify: `payroll-runs.controller.ts`, `payroll.module.ts`

**Interfaces:**
- Consumes: `GratuityService.balance/entitlement/unpaidLeaveDaysTo`, `LedgerService.resolveLines`, `PayrollRunsService.get` (for the response), entities.
- Produces:
  - `PayrollPostingService.approve(tenantId, runId, actor: { userId: string; permissions: Permission[] }): Promise<PayrollRunDto>`
  - `PayrollPostingService.void(tenantId, runId, actor): Promise<PayrollRunDto>`
  - Routes `POST /payroll-runs/:id/approve`, `POST /payroll-runs/:id/void` (`PAYROLL_APPROVE`; service re-checks `actor.permissions.includes(PERMISSIONS.PAYROLL_APPROVE)` like `PayablesService.approve`).

approve (one transaction, run row locked `pessimistic_write`, status must be DRAFT, at least one line):
1. For each line: `asOf = periodBounds(run.period).last`; `employee` loaded; `before = balance(employee)`; `extra = line.unpaidLeaveDays` (the current run is still DRAFT so it is not in `unpaidLeaveDaysTo`); `ent = entitlement(employee, asOf, extra)` (uses package at asOf → latest basic); `accrual = round2(ent.amount − before)`; set `gratuityBefore/Accrual/After`.
2. Totals recalculated; `totalGratuityAccrual = Σ accrual`.
3. Journal lines (skip zero lines; amounts from totals):
   - `Dr SALARIES` `Σ salaryCost`
   - `Cr SALARIES` `Σ otherDeductionAmount` (description "Payroll deductions")
   - `Cr SALARIES_PAYABLE` `Σ netPay`
   - `Cr EMPLOYEE_ADVANCES` `Σ advanceRecovery`
   - gratuity: if `G = Σ accrual > 0`: `Dr GRATUITY_EXPENSE G`, `Cr GRATUITY_PROVISION G`; if `G < 0`: `Dr GRATUITY_PROVISION |G|`, `Cr GRATUITY_EXPENSE |G|`.
   Balanced by construction: `salaryCost = net + advanceRecovery + otherDeductions` per line.
   `resolveLines(tenantId, lines, manager)` (base currency, rate 1); save `JournalEntry` `{ entryNumber: 'JE-' + runNumber, referenceType: 'PAYROLL', referenceId: run.id, entryDate: asOf (UTC midnight), totalAmount: Σ salaryCost + |G|, lines }`.
4. One `ACCRUAL` gratuity row per line with non-zero accrual `{ amount: accrual, asOf, runLineId, journalEntryId }`.
5. Run → APPROVED, `approvedAt/ById`, `journalEntryId`.

void (one transaction, lock, status must be APPROVED and `bankPaidAt` and `cashPaidAt` null — 409 "Paid runs cannot be voided"):
1. Load the approval entry; post a reversal with every line's debit/credit swapped: `entryNumber 'JE-' + runNumber + '-VOID'`, `referenceType 'PAYROLL'`, `referenceId run.id`, `entryDate` today (UTC). Use `resolveLines` with `ledgerAccountId` per line (from the stored resolved lines) so it reverses exactly.
2. For each ACCRUAL row of the run's lines: insert a `REVERSAL` row with `-amount`, same `runLineId`, the void journal id.
3. Run → VOIDED, `voidJournalEntryId`.

- [ ] **Step 1: Failing tests:**
  - approve posts a balanced entry with exactly these role amounts for a 2-employee run (one with bonus 500 + advance recovery 1000 + other deduction 200; one prorated) — assert each role's debit/credit sum.
  - first approval with no gratuity history: accrual = full entitlement to month end.
  - true-up after a raise: run Oct approved with basic 6000, raise to 7000 effective Nov 1, Nov accrual = entitlement(Nov 30, basic 7000) − balance after Oct.
  - pay cut → negative accrual → `Dr GRATUITY_PROVISION / Cr GRATUITY_EXPENSE`, still balanced.
  - current run's unpaid leave counts: line with 10 unpaid days → `serviceDays` 10 lower than without.
  - national line → accrual 0, no gratuity row.
  - approve on non-DRAFT → 409; without permission → 403.
  - void reverses every journal line (sum of the two entries per account = 0), writes REVERSAL rows netting the accruals to 0, frees the period for a new run; void after a payment → 409.

- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.

- [ ] **Step 5: Commit** — `feat(api): approve and void payroll runs with gratuity true-up`

---

### Task 10: API — pay a run

**Files:**
- Modify: `apps/api/src/modules/payroll/payroll-posting.service.ts`, `payroll-runs.controller.ts`
- Test: `payroll-posting.service.spec.ts`

**Interfaces:**
- Produces: `PayrollPostingService.pay(tenantId, runId, actor, input: PayPayrollRunPayload): Promise<PayrollRunDto>`; route `POST /payroll-runs/:id/pay` (`PAYROLL_PAY`, `zodBody(payPayrollRunSchema)`), service re-checks `PERMISSIONS.PAYROLL_PAY`.

Rules (one transaction, lock run): status APPROVED or PARTIALLY_PAID (409 otherwise); if that method's `…PaidAt` already set → 409 "Bank payees on PR-… are already paid"; unpaid lines of that method; if none → set the method's `…PaidAt` and return without a journal; total = Σ netPay; finance account found in tenant (404); posts `Dr SALARIES_PAYABLE / Cr { financeAccountId }` with `entryNumber 'JE-' + runNumber + '-' + method`, `referenceType 'PAYROLL'`, `referenceId run.id`, `entryDate paidAt ?? now`; decrements the finance account balance with the same `UPDATE "finance_accounts" SET "balance" = "balance" - $1 …` statement as `PayablesService` (base currency; if the account's currency differs from base → 400 "Pay payroll from a <base> account" — multi-currency is out of scope); sets lines' `paidAt`, the method's `…PaidAt`; status → PAID when no unpaid line remains, else PARTIALLY_PAID.

- [ ] **Step 1: Failing tests:** bank then cash → PARTIALLY_PAID then PAID with two balanced entries and two balance decrements; paying bank twice → 409; run with only bank payees paid by bank → PAID directly, and a later cash pay call → 409 (already complete) or no-op — choose 409 "Nothing left to pay"; pay a DRAFT → 409; foreign-currency account → 400; without permission → 403.

- [ ] **Step 2–4:** FAIL → implement → PASS.

- [ ] **Step 5: Commit** — `feat(api): pay payroll runs by bank and cash`

---

### Task 11: API — payroll in the cash forecast and runway

**Files:**
- Modify: `apps/api/src/modules/finance/finance.service.ts` (`cashForecast` ~79-190, `getOverview` runway ~287), `apps/api/src/modules/finance/finance.module.ts` (register `Employee`, `SalaryPackage`, `PayrollRun`, `PayrollRunLine` repos — entities only, no module import cycle)
- Test: `apps/api/src/modules/finance/finance.service.spec.ts`

**Interfaces:**
- Consumes: entities from Task 4, `packageGross`, `periodBounds`.
- Produces: `CashForecastMonthDto.payrollOut` populated; `closing = opening + inflows − billsOut − recurringOut − payrollOut`; runway committed burn adds Σ current gross of ACTIVE employees.

Rules:
- Approved/partially paid runs: Σ netPay of lines with `paidAt` null, bucketed by `payDate` (overdue → month 1).
- For each forecast month with no non-voided run for that period (DRAFT runs count as "has a run": use their current totalNet bucketed on their payDate): Σ `packageGross(packageAt(month end))` over employees ACTIVE with `daysEmployed(month) > 0`, bucketed on `<month>-28`. Load all packages for the tenant once and pick in memory.
- Runway: `committed = recurringMonthly + expenseMonthly + payrollMonthly` where `payrollMonthly` = Σ current gross of ACTIVE employees.

- [ ] **Step 1: Failing tests:** an approved unpaid run due this month contributes its unpaid net to month 1 and its bank-paid lines don't; a future month with no run projects Σ gross of active employees (a LEFT employee excluded, a future joiner included only from their joining month); a DRAFT run for next month uses its totalNet, not the projection; runway includes payroll.

- [ ] **Step 2–4:** FAIL → implement → PASS (`corepack pnpm --filter api exec jest src/modules/finance`).

- [ ] **Step 5: Commit** — `feat(api): payroll in the cash forecast and runway`

---

### Task 12: API — seed payroll

**Files:**
- Modify: `apps/api/src/database/seeds/run-seed.ts`

**Interfaces:**
- Consumes: `EmployeesService.create/addPackage`, `GratuityService.previewOpening/postOpening`, `PayrollRunsService.create/updateLine`, `PayrollPostingService.approve/pay`, `AdvancesService.record`; the demo org's owner user (holds all permissions) and its default finance account(s) (create a "Petty cash" CASH finance account via `FinanceService` if the seed has none, in the org's base currency).

Steps (inside `tenantContext.runWithTenant(orgId, …)`, idempotent — skip if any employee exists for the org):
1. Six employees: four BANK (IBANs `AE07033123456789012345{0..3}`), two CASH; one `isNational: true`; one joined on the 15th of last month; others joined 1–6 years ago. Packages effective at joining (basic 4,000–15,000, housing 25–40% of basic, transport 500–1,000).
2. Opening gratuity: `previewOpening()` with cutover = last day of two months ago; `postOpening()` with the calculated amounts.
3. One advance of 2,000 to a BANK employee from the bank account, dated two months ago.
4. Run for last month: create; on one line overtime 10h, on another bonus 1,000 "Seed bonus", on the advanced employee advance recovery 1,000, on one line unpaid leave 2 days; approve as owner; pay BANK from the default bank account and CASH from petty cash.
5. Assert (throw on failure): run status `PAID`; approval and both payment journal entries exist; `GRATUITY_PROVISION` balance = Σ OPENING + Σ ACCRUAL rows; no line flagged except the national.

- [ ] **Step 1:** implement; **Step 2:** `corepack pnpm --filter api build` and `corepack pnpm --filter api test` → PASS (seed not runnable locally — no DB); write in the commit body the CI checks that cover it.
- [ ] **Step 3: Commit** — `feat(api): seed employees and a paid payroll run for the books check`

---

### Task 13: Web — People: employees

**Files:**
- Create: `apps/web/src/lib/api/endpoints/payroll.ts`, `apps/web/src/hooks/use-payroll.ts` (employee part)
- Create: `apps/web/src/app/(app)/people/employees/page.tsx`, `apps/web/src/app/(app)/people/employees/[id]/page.tsx`
- Create: `apps/web/src/components/people/employees-view.tsx`, `employee-detail.tsx`, `employee-form-modal.tsx`, `salary-package-modal.tsx`, `employee-gratuity-tab.tsx`, `employee-advances-tab.tsx`, `record-advance-modal.tsx`
- Modify: `apps/web/src/lib/nav.ts`, `apps/web/src/lib/api/endpoints/index.ts` (or wherever `api` is assembled)
- Test: `apps/web/src/components/people/*.spec.tsx`

**Interfaces:**
- Consumes: shared schemas/DTOs (Task 3), API routes (Tasks 6–7).
- Produces hooks: `useEmployees(q)`, `useEmployee(id)`, `useCreateEmployee()`, `useUpdateEmployee()`, `useSalaryPackages(id)`, `useAddSalaryPackage()`, `useEmployeeGratuity(id)`, `useAdjustGratuity()`, `useEmployeeAdvances(id)`, `useRecordAdvance()`.

Rules:
- Read `apps/web/AGENTS.md` first. Pages are thin wrappers with `PageGuard` like `app/(app)/purchasing/bills/page.tsx` (`EMPLOYEE_READ`).
- Nav: a **People** entry (`href: '/people/employees'`, icon `Users` from lucide, `rule: { permission: PERMISSIONS.EMPLOYEE_READ }`) placed after Finance; a sub-nav (copy `finance-nav.tsx` pattern) with Employees and Payroll (`PAYROLL_READ`).
- Employees list: DataTable (number, name, title, department, status badge, payment method), status filter, search; "Add employee" (`EMPLOYEE_MANAGE`, via `<Can>`).
- Detail tabs: Profile (form in modal with `useForm<z.input<typeof createEmployeeSchema>, unknown, z.output<…>>`; IBAN field shown only to `EMPLOYEE_MANAGE`, else masked text), Salary history (`PAYROLL_READ`; table + "Record change" modal with `createSalaryPackageSchema`, showing gross), Gratuity (`PAYROLL_READ`; balance, today's entitlement, service days, movements; "Adjust" for `PAYROLL_APPROVE`), Advances (`PAYROLL_READ`; outstanding, list; "Record advance" for `PAYROLL_PAY` with a finance-account select from the existing finance accounts hook), Documents (`EMPLOYEE_MANAGE`; `<AttachmentsPanel ownerType="EMPLOYEE" ownerId={id} canEdit />`).
- Error toasts via the existing `describe`/`describeServer` helpers in `use-finance.ts`.

- [ ] **Step 1: Tests** — `employees-view.spec.tsx`: renders rows; hides "Add employee" without `EMPLOYEE_MANAGE`. `employee-detail.spec.tsx`: pay tabs hidden without `PAYROLL_READ`; IBAN masked without `EMPLOYEE_MANAGE`; Documents tab hidden without `EMPLOYEE_MANAGE`. Follow the mocking pattern of existing component specs (e.g. `components/finance/subscriptions/*.spec.tsx`).
- [ ] **Step 2:** implement until `corepack pnpm --filter web exec tsc --noEmit` is clean and `corepack pnpm --filter web test` passes (pre-existing `drawers.spec.tsx` failure excepted).
- [ ] **Step 3: Commit** — `feat(web): People section with employees, salary history, gratuity, advances and documents`

---

### Task 14: Web — payroll runs, payslips, opening gratuity, forecast series

**Files:**
- Create: `apps/web/src/app/(app)/people/payroll/page.tsx`, `.../[id]/page.tsx`, `.../[id]/payslips/[lineId]/page.tsx`, `.../opening-gratuity/page.tsx`
- Create: `apps/web/src/components/people/payroll-runs-view.tsx`, `payroll-run-detail.tsx`, `payroll-line-editor.tsx`, `pay-run-modal.tsx`, `payslip-view.tsx`, `opening-gratuity-view.tsx`
- Modify: `apps/web/src/hooks/use-payroll.ts`, `apps/web/src/lib/api/endpoints/payroll.ts`, `apps/web/src/components/finance/dashboard/cash-forecast-chart.tsx`
- Test: specs beside the new components

**Interfaces:**
- Produces hooks: `usePayrollRuns()`, `usePayrollRun(id)`, `useCreatePayrollRun()`, `useUpdatePayrollLine()`, `useRefreshPayrollRun()`, `useApprovePayrollRun()`, `useVoidPayrollRun()`, `usePayPayrollRun()`, `usePayslip(runId, lineId)`, `useOpeningGratuityPreview(cutover?)`, `usePostOpeningGratuity()`.

Rules:
- Run list: period, number, status badge, net, gratuity accrual; "New run" (`PAYROLL_MANAGE`) modal with month picker (default next month without a run) and pay date; shows server warnings (employees without a package) in a toast/inline list.
- Run detail: header with totals (salary cost, net, bank net, cash net, gratuity accrual); line grid with editable extras while DRAFT (numeric inputs debounced → `useUpdatePayrollLine`; per-row server error shown inline), flags as badges ("Pension not handled"), payslip link per line; actions by status/permission: Refresh (DRAFT, manage), Approve (DRAFT, approve; confirm dialog stating total and gratuity), Pay bank / Pay cash (APPROVED/PARTIALLY_PAID, pay; modal with a finance-account select filtered to base currency, date), Void (APPROVED with nothing paid, approve; confirm).
- Payslip page: print-friendly layout (company, employee, period, earnings, deductions, net, masked IBAN), a Print button (`window.print()`), `@media print` hides app chrome — check how existing printable pages (quotes/invoices) do it and reuse.
- Opening gratuity page (`PAYROLL_MANAGE` to view, `PAYROLL_APPROVE` to post): cut-over date input, preview table with editable amounts (default calculated), total, Post button with confirm; after posting, shows "Opening balances posted as of <date>". Link to it from the Payroll list while `latestCutover` is null — expose this by adding `openingGratuityCutover: string | null` to the runs list response (add to shared DTO as a wrapper `{ runs: PayrollRunDto[]; openingGratuityCutover: string | null }` and to the API `list` — do this in this task with an API test).
- Forecast chart: add the `payrollOut` series to the stacked outflows with its own token color and legend entry; update the chart's text summary.

- [ ] **Step 1: Tests** — run detail: actions shown/hidden per status and permission; editing disabled when not DRAFT; payslip renders net and masked IBAN; opening gratuity: Post disabled without `PAYROLL_APPROVE`; forecast chart summary mentions payroll.
- [ ] **Step 2:** implement; web tsc clean; web tests pass; api tests pass (for the list wrapper change).
- [ ] **Step 3: Commit** — `feat(web): payroll runs, payslips, opening gratuity and payroll in the forecast`

---

### Task 15: Docs and final verification

**Files:**
- Modify: `docs/FLAGS.md` (new "Employees and payroll" section, same style as "Overheads and recurring bills")

- [ ] **Step 1: FLAGS bullets** (one each, with the reason):
  - UAE/GCC nationals: no GPSSA pension yet — lines flagged; handle outside Kerf until #3.
  - No WPS SIF export, leave balances, or final settlement yet (#3); 2400 provision is never paid out until then.
  - Gratuity accrues from day one although nothing is payable before one year of service; #3's settlement applies eligibility.
  - Package in effect on the last day of the month applies to the whole month (no split-month proration of raises).
  - Off-cycle (bonus-only) runs are not supported; one run per month.
  - Payroll is base-currency only; paying from a foreign-currency account is refused.
  - Payslips are printable pages; no emailing or server-side PDF.
  - Forecast projects payroll as gross on the 28th for months without a run.
  - `PAYROLL_DATA_KEY` must be set in production; losing it makes stored IBANs unreadable (re-enter them).
  - Opening gratuity cut-over blocks runs for months it already covers.
- [ ] **Step 2: Verify** — `corepack pnpm --filter @saas/shared build && corepack pnpm --filter @saas/shared test && corepack pnpm --filter api test && corepack pnpm --filter api build && corepack pnpm --filter web exec tsc --noEmit && corepack pnpm --filter web test` (the `drawers.spec.tsx` failure is pre-existing on master). DB checks run in CI (`migration:run`, `check:drift`, `seed`, `check:books`).
- [ ] **Step 3: Commit** — `docs: flag what payroll leaves for compliance and job costing`
