# Job Costing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timesheets per employee (manual and from the shop-floor clock) that cost each work order's labour at the employee's real monthly cost per hour, absorbed into WIP/COGS when payroll is approved, so per-job margin and the P&L split direct labour from overhead exactly.

**Architecture:** All arithmetic (standard hours, cost per hour, estimated rate, absorption rounding, labour status) is pure code in `packages/shared/src/payroll/labour.ts`. A new API module `modules/job-costing/` owns the two new tables (`timesheet_entries`, `work_order_labour`), timesheet CRUD, job labour breakdown/recompute, and the absorption postings; `PayrollModule` and `ProductionModule` both import it (it imports neither — it reads their entities directly), so there is no module cycle. Every writer of timesheets or job labour takes one per-tenant advisory lock (`lockJobCosting`) first; payroll approval/void take it after `lockGratuityOpening`, so the lock order is always run → gratuity → job-costing → work order.

**Tech Stack:** NestJS 11, TypeORM 1, Postgres 18 (FORCE RLS), zod 4, vitest (shared), jest (api), Next.js 16 + TanStack Query + react-hook-form (web).

**Spec:** `docs/superpowers/specs/2026-10-16-job-costing-design.md`

**Depends on:** sub-project #3 implemented per `docs/superpowers/plans/2026-10-16-uae-compliance.md` (this plan uses its `PayrollSettings` entity and service, `PensionScheme`, `pensionContribution`, the run-line columns `pensionEmployer` and `leaveProvisionChange`, migration `1790100000000-UaeCompliance`, and the ledger roles of its Task 1). Implement on a branch `feat/job-costing` cut from `feat/uae-compliance` after #3 is complete.

## Global Constraints

- Branch `feat/job-costing`, stacked on `feat/uae-compliance` (#3) which is stacked on `feat/employees-payroll` (#2).
- Use `corepack pnpm` (pnpm is not on PATH). After editing `packages/shared`, run `corepack pnpm --filter @saas/shared build` before api/web tests.
- No database locally: the migration is hand-written to mirror entity decorators exactly (names, case, types, defaults, index names); CI's schema job runs `migration:run`, `check:drift`, `seed`, `check:books`. Read `scripts/check-drift.mjs`, `1790000000000-EmployeesAndPayroll.ts` and `1790100000000-UaeCompliance.ts` before writing the migration. New migration: `1790200000000-JobCosting.ts`.
- Permissions only from `PERMISSIONS` constants. New constants live in `packages/shared/src/rbac/permissions/timesheets.ts` and nowhere else: `TIMESHEET_READ = 'timesheet:read'`, `TIMESHEET_MANAGE = 'timesheet:manage'`; grants admin both, manager both, member read, viewer none.
- Per-employee rates and amounts are visible only with `payroll:read`; job totals follow `quote:view_cost` (`canSeeCost` in `production.controller.ts`). Hours are visible to `timesheet:read` (and to `work_order:read` on a work order's labour panel).
- Every query tenant-scoped; new tables `ENABLE` + `FORCE ROW LEVEL SECURITY` with the policy loop from `1790000000000-EmployeesAndPayroll.ts`.
- Ledger append-only; every posting balanced; corrections post reversals dated `max(today, original entry date)`.
- Money `numeric(14,2)` rounded with `round2`; rates `numeric(12,4)` rounded to 4 dp; hours `numeric(5,2)` on entries, `numeric(7,2)` on run lines.
- Cost per hour: `cost = salaryCost + pensionEmployer + gratuityAccrual + leaveProvisionChange`; `standardHours = round2(daysEmployed / daysInMonth × monthlyStandardHours + overtimeHours + overtimeHoursPremium)`; `rate = cost > 0 ? round4(cost / max(standardHours, loggedHours)) : 0`. Absorbed per employee never exceeds `cost`.
- Estimated rate: `round4((gross + pensionEmployer(full month) + (isNational ? 0 : basic × 21 / 30 / 12) + basic × annualDays / 30 / 12) / monthlyStandardHours)`.
- `monthlyStandardHours` default 208, allowed 100..320.
- Lock order, always: payroll run row → `lockGratuityOpening` → `lockJobCosting` → work order rows (sorted by id when several). Production paths that touch labour (stop, finish, log time, complete, cancel) call `lockJobCosting` as the **first** statement in their transaction.
- The shop floor is never blocked by accounting: a clock entry that cannot be written (posted month, outside employment, daily cap) is skipped silently; the minutes still count as unlinked.
- Never save a whole row read earlier where another writer may have changed it; update only the columns the operation owns.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the committing model's name).

## Review Focus

1. **A payroll run voided after one of its jobs was completed** (labour moved WIP → COGS by completion) → the void reverses that labour from COGS, WIP never goes negative, and re-approving absorbs again to COGS. Test: Task 8 "void after completion reverses from COGS".
2. **An employee logs more hours than the month's standard** (unrecorded overtime) → the rate falls to cost ÷ logged hours and absorbed equals cost exactly, never more. Tests: Task 2 "logged hours above standard" and Task 8 "absorbed never exceeds cost".
3. **The clock is stopped by a linked user whose month is already posted, or whose day already has 24 hours** → the stop succeeds, minutes are recorded, no entry is created, no error. Test: Task 7 "skips the entry but keeps the minutes".
4. **A late timesheet entered on a completed job before its month posts** → the job's `actualCost` is recomputed with the new provisional hours; after posting the same edit is a 409. Test: Task 5 "late hours recompute a completed job" and "refuses hours in a posted month".
5. **A job cancelled after WIP labour was absorbed, then the run voided** → cancel moved the labour back to 6390; the void skips those rows; 6390 and WIP both net to zero. Test: Task 9 "cancel then void nets to zero".

---

## File Structure

**Shared (`packages/shared/src/`)**
- Create `rbac/permissions/timesheets.ts` (+ `timesheets.test.ts`); modify `rbac/permissions/index.ts`.
- Modify `finance/ledger.ts` (6390 `LABOUR_ABSORBED`, parent 6300; `OPERATING_EXPENSE_CHILD_ROLES` becomes every descendant of 6000), `finance/ledger.test.ts`.
- Create `payroll/labour.ts` (+ `labour.test.ts`).
- Modify `production/work-orders.ts` (`actualCost` optional `labour`, `LabourStatus`, `WorkOrderLabourDto`, `WorkOrderDto.labour`, `LabourSplit`), `production/work-orders.test.ts`.
- Create `timesheets/types.ts`, `schemas/timesheets.ts` (+ `timesheets.test.ts`); export both from `index.ts`.
- Modify `payroll/types.ts` (line and run labour fields), the #3 settings schema/DTO (`monthlyStandardHours`), `finance/currency.ts` (`MarginRowDto.provisionalLabourShare`).

**API (`apps/api/src/`)**
- Create `database/migrations/1790200000000-JobCosting.ts`, `database/job-costing-migration.spec.ts`.
- Create `modules/job-costing/`: `entities/timesheet-entry.entity.ts`, `entities/work-order-labour.entity.ts`, `job-costing.lock.ts`, `timesheets.service.ts`, `job-cost.service.ts`, `labour-absorption.service.ts`, `labour-utilisation.service.ts`, `timesheets.controller.ts`, `labour-utilisation.controller.ts`, `job-costing.module.ts`; specs beside each service.
- Modify `modules/payroll/entities/payroll-run.entity.ts`, `entities/payroll-settings.entity.ts` (#3), `payroll-settings.service.ts` (#3), `payroll-runs.service.ts`, `payroll-posting.service.ts`, `payroll.module.ts`; `modules/production/entities/work-order.entity.ts`, `production.service.ts`, `production.controller.ts`, `production.module.ts`; `modules/finance/reports.service.ts`, `reports.controller.ts`; `modules/audit/audit-subjects.ts`; `app.module.ts`; `database/seeds/run-seed.ts`.

**Web (`apps/web/src/`)**
- Modify `lib/nav.ts`, `components/people/people-nav.tsx`, `lib/api/endpoints/payroll.ts`, `hooks/use-payroll.ts`, `components/people/payroll-run-detail.tsx`, `components/people/payroll-settings-view.tsx` (#3), `components/production/work-order-drawer.tsx`, `components/finance/reports/reports-view.tsx`, `hooks/use-platform.ts`, the reports API endpoint file.
- Create `app/(app)/people/page.tsx`, `app/(app)/people/timesheets/page.tsx`, `lib/api/endpoints/timesheets.ts`, `hooks/use-timesheets.ts`, `components/people/timesheets-view.tsx`, `timesheet-week-grid.tsx`, `timesheet-crew-day.tsx`, `people-index.tsx`, `components/production/work-order-labour-panel.tsx`, `components/finance/reports/labour-utilisation.tsx`.

**Docs:** `docs/FLAGS.md`.

---

### Task 1: Shared — timesheet permissions and the Labour absorbed account

**Files:**
- Create: `packages/shared/src/rbac/permissions/timesheets.ts`, `packages/shared/src/rbac/permissions/timesheets.test.ts`
- Modify: `packages/shared/src/rbac/permissions/index.ts`, `packages/shared/src/finance/ledger.ts`, `packages/shared/src/finance/ledger.test.ts`

**Interfaces:**
- Produces: `PERMISSIONS.TIMESHEET_READ` (`'timesheet:read'`), `PERMISSIONS.TIMESHEET_MANAGE` (`'timesheet:manage'`), `timesheetsDomain`; `LEDGER_ROLES.LABOUR_ABSORBED`; account 6390; `OPERATING_EXPENSE_CHILD_ROLES` = roles of every account whose parent chain reaches 6000 (so a tenant missing 6390 falls back to 6000 via `byRoleWithOverheadFallback`).

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/rbac/permissions/timesheets.test.ts
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_DOMAINS, permissionsForSystemRole } from './index';

describe('timesheet permissions', () => {
  it('registers read and manage', () => {
    expect(PERMISSIONS.TIMESHEET_READ).toBe('timesheet:read');
    expect(PERMISSIONS.TIMESHEET_MANAGE).toBe('timesheet:manage');
    expect(PERMISSION_DOMAINS.some((d) => d.key === 'timesheet')).toBe(true);
  });

  it('admins and managers manage; members read; viewers nothing', () => {
    for (const slug of ['admin', 'manager'] as const) {
      expect(permissionsForSystemRole(slug)).toEqual(expect.arrayContaining(['timesheet:read', 'timesheet:manage']));
    }
    const member = permissionsForSystemRole('member') ?? [];
    expect(member).toContain('timesheet:read');
    expect(member).not.toContain('timesheet:manage');
    expect((permissionsForSystemRole('viewer') ?? []).filter((p) => p.startsWith('timesheet:'))).toEqual([]);
  });
});
```

(Use the import of `permissionsForSystemRole` that `payroll.test.ts` uses; adapt the import, not the assertions.)

In `ledger.test.ts` replace the test `nests every overhead account under 6000 and only those` with:

```ts
  it('lists every descendant of 6000 as an overhead role, and only those', () => {
    const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
    const under6000 = (code: string | undefined): boolean =>
      !!code && (code === '6000' || under6000(byCode.get(code)?.parentCode));
    const descendants = SYSTEM_LEDGER_ACCOUNTS.filter((a) => a.code !== '6000' && under6000(a.parentCode));
    expect(descendants.map((a) => a.role).sort()).toEqual([...OPERATING_EXPENSE_CHILD_ROLES].sort());
    for (const d of descendants) expect(d.type).toBe('EXPENSE');
  });
```

and append:

```ts
it('adds Labour absorbed as a contra under Salaries & wages', () => {
  const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
  expect(byCode.get('6390')).toMatchObject({ type: 'EXPENSE', role: 'LABOUR_ABSORBED', parentCode: '6300' });
  expect(OPERATING_EXPENSE_CHILD_ROLES).toContain('LABOUR_ABSORBED');
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/rbac/permissions/timesheets.test.ts src/finance/ledger.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/rbac/permissions/timesheets.ts
import type { PermissionDomain, PermissionValues } from './domain';

export const TIMESHEET_PERMISSIONS = {
  TIMESHEET_READ: 'timesheet:read',
  TIMESHEET_MANAGE: 'timesheet:manage',
} as const;

type TimesheetPermission = PermissionValues<typeof TIMESHEET_PERMISSIONS>;

export const timesheetsDomain: PermissionDomain<TimesheetPermission> = {
  key: 'timesheet',
  label: 'Timesheets',
  permissions: TIMESHEET_PERMISSIONS,
  descriptions: {
    [TIMESHEET_PERMISSIONS.TIMESHEET_READ]: 'View hours worked by employee, job and day — not pay',
    [TIMESHEET_PERMISSIONS.TIMESHEET_MANAGE]: 'Enter and correct timesheet hours for any employee',
  },
  groupPermissions: Object.values(TIMESHEET_PERMISSIONS),
  grants: {
    admin: Object.values(TIMESHEET_PERMISSIONS),
    // Supervisors enter their crew's hours.
    manager: Object.values(TIMESHEET_PERMISSIONS),
    // The floor sees where its hours went.
    member: [TIMESHEET_PERMISSIONS.TIMESHEET_READ],
    viewer: [],
  },
};
```

In `index.ts`: `import { timesheetsDomain, TIMESHEET_PERMISSIONS } from './timesheets';`, spread `...TIMESHEET_PERMISSIONS` into `PERMISSIONS` right after `...PAYROLL_PERMISSIONS`, add `timesheetsDomain` to `PERMISSION_DOMAINS` right after `payrollDomain`, and export it beside `payrollDomain`.

In `ledger.ts`: add `LABOUR_ABSORBED: 'LABOUR_ABSORBED',` after `PENSION_EXPENSE: 'PENSION_EXPENSE',` (#3). Add the account right after the 6330 line (#3):

```ts
  { code: '6390', name: 'Labour absorbed', type: 'EXPENSE', role: LEDGER_ROLES.LABOUR_ABSORBED, parentCode: '6300', description: 'Payroll cost charged to jobs (a credit): Salaries & wages net of this is labour not spent on jobs' },
```

Replace `OPERATING_EXPENSE_CHILD_ROLES`:

```ts
/** The overhead roles that roll up, directly or through a parent, into 6000 Other operating expense. */
export const OPERATING_EXPENSE_CHILD_ROLES: LedgerRole[] = (() => {
  const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
  const under6000 = (code: string | undefined): boolean =>
    !!code && (code === '6000' || under6000(byCode.get(code)?.parentCode));
  return SYSTEM_LEDGER_ACCOUNTS.filter((a) => a.code !== '6000' && under6000(a.parentCode)).map((a) => a.role);
})();
```

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build && corepack pnpm --filter api build` → PASS. Also run `corepack pnpm --filter api exec jest src/modules/rbac` (the catalog seeding spec must accept the new domain).

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): timesheet permissions and the Labour absorbed account"`

---

### Task 2: Shared — labour maths

**Files:**
- Create: `packages/shared/src/payroll/labour.ts`, `packages/shared/src/payroll/labour.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `round4(n: number): number`
  - `standardHours(a: { daysEmployed: number; daysInMonth: number; monthlyStandardHours: number; overtimeHours: number; overtimeHoursPremium: number }): number`
  - `labourCost(a: { salaryCost: number; pensionEmployer: number; gratuityAccrual: number; leaveProvisionChange: number }): number`
  - `labourRate(a: { cost: number; standardHours: number; loggedHours: number }): number`
  - `estimatedLabourRate(a: { gross: number; basic: number; pensionEmployer: number; isNational: boolean; annualLeaveDays: number; monthlyStandardHours: number }): number`
  - `allocateAbsorption<T extends { id: string; hours: number }>(entries: T[], rate: number, cap: number): Map<string, number>` — amount per entry id; Σ = `min(round2(Σ hours × rate), round2(cap))`; the rounding remainder goes to the entry with the most hours (first in input order on ties).
  - `unlinkedHours(actualMinutes: number, entryHours: number): number` — `max(0, round2(actualMinutes / 60 − entryHours))`.
  - `type LabourStatus = 'ACTUAL' | 'PROVISIONAL' | 'MIXED' | 'STANDARD'`; `labourStatus(s: { actual: number; provisional: number; unlinked: number }): LabourStatus | null`.

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/payroll/labour.test.ts
import { describe, expect, it } from 'vitest';
import {
  allocateAbsorption,
  estimatedLabourRate,
  labourCost,
  labourRate,
  labourStatus,
  standardHours,
  unlinkedHours,
} from './labour';

describe('standardHours', () => {
  it('a full month is the tenant standard', () =>
    expect(standardHours({ daysEmployed: 31, daysInMonth: 31, monthlyStandardHours: 208, overtimeHours: 0, overtimeHoursPremium: 0 })).toBe(208));
  it('a joiner is prorated by calendar days', () =>
    expect(standardHours({ daysEmployed: 15, daysInMonth: 30, monthlyStandardHours: 208, overtimeHours: 0, overtimeHoursPremium: 0 })).toBe(104));
  it('paid overtime hours add to the hours the cost covers', () =>
    expect(standardHours({ daysEmployed: 30, daysInMonth: 30, monthlyStandardHours: 208, overtimeHours: 10, overtimeHoursPremium: 2 })).toBe(220));
});

describe('labourCost', () => {
  it('adds the employer on-costs to salary cost', () =>
    expect(labourCost({ salaryCost: 9000, pensionEmployer: 0, gratuityAccrual: 525, leaveProvisionChange: 500 })).toBe(10025));
  it('a negative true-up lowers it', () =>
    expect(labourCost({ salaryCost: 9000, pensionEmployer: 0, gratuityAccrual: -1200, leaveProvisionChange: 0 })).toBe(7800));
});

describe('labourRate', () => {
  it('cost over standard hours', () => expect(labourRate({ cost: 10400, standardHours: 208, loggedHours: 150 })).toBe(50));
  it('logged hours above standard', () => expect(labourRate({ cost: 10400, standardHours: 208, loggedHours: 260 })).toBe(40));
  it('nothing to absorb when cost is not positive', () => {
    expect(labourRate({ cost: 0, standardHours: 208, loggedHours: 10 })).toBe(0);
    expect(labourRate({ cost: -50, standardHours: 208, loggedHours: 10 })).toBe(0);
  });
  it('no hours, no rate', () => expect(labourRate({ cost: 100, standardHours: 0, loggedHours: 0 })).toBe(0));
  it('rounds to four places', () => expect(labourRate({ cost: 10000, standardHours: 208, loggedHours: 0 })).toBe(48.0769));
});

describe('estimatedLabourRate', () => {
  it('gross plus statutory on-costs over standard hours', () =>
    // 9000 + 0 + 6000×21/30/12 (350) + 6000×30/30/12 (500) = 9850 / 208
    expect(estimatedLabourRate({ gross: 9000, basic: 6000, pensionEmployer: 0, isNational: false, annualLeaveDays: 30, monthlyStandardHours: 208 })).toBe(47.3558));
  it('nationals have pension and no gratuity', () =>
    // 9000 + 1350 + 0 + 500 = 10850 / 208
    expect(estimatedLabourRate({ gross: 9000, basic: 6000, pensionEmployer: 1350, isNational: true, annualLeaveDays: 30, monthlyStandardHours: 208 })).toBe(52.1635));
});

describe('allocateAbsorption', () => {
  it('puts the rounding remainder on the largest entry', () => {
    const m = allocateAbsorption([{ id: 'a', hours: 1 }, { id: 'b', hours: 3 }, { id: 'c', hours: 1 }], 33.3333, Infinity);
    // Σ = round2(5 × 33.3333) = 166.67; each rounds to 33.33 / 100.00 / 33.33 = 166.66
    expect([...m.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(166.67, 2);
    expect(m.get('b')).toBe(100.01);
  });
  it('never absorbs more than the cap', () => {
    const m = allocateAbsorption([{ id: 'a', hours: 8 }, { id: 'b', hours: 2 }], 50, 400);
    expect(m.get('a')! + m.get('b')!).toBe(400);
  });
  it('no entries, empty map', () => expect(allocateAbsorption([], 50, 100).size).toBe(0));
});

describe('unlinkedHours', () => {
  it('minutes not covered by entries', () => expect(unlinkedHours(150, 2)).toBe(0.5));
  it('never negative', () => expect(unlinkedHours(60, 2)).toBe(0));
});

describe('labourStatus', () => {
  it('derives the status', () => {
    expect(labourStatus({ actual: 0, provisional: 0, unlinked: 0 })).toBeNull();
    expect(labourStatus({ actual: 10, provisional: 0, unlinked: 0 })).toBe('ACTUAL');
    expect(labourStatus({ actual: 10, provisional: 5, unlinked: 0 })).toBe('PROVISIONAL');
    expect(labourStatus({ actual: 10, provisional: 0, unlinked: 5 })).toBe('MIXED');
    expect(labourStatus({ actual: 0, provisional: 0, unlinked: 5 })).toBe('STANDARD');
  });
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/payroll/labour.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/payroll/labour.ts
import { round2 } from './calc';

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** The hours a month's pay covers: prorated standard plus the overtime that was paid. */
export function standardHours(a: {
  daysEmployed: number;
  daysInMonth: number;
  monthlyStandardHours: number;
  overtimeHours: number;
  overtimeHoursPremium: number;
}): number {
  return round2((a.daysEmployed / a.daysInMonth) * a.monthlyStandardHours + a.overtimeHours + a.overtimeHoursPremium);
}

/** What an employee cost the business this month, from the approved line. */
export function labourCost(a: {
  salaryCost: number;
  pensionEmployer: number;
  gratuityAccrual: number;
  leaveProvisionChange: number;
}): number {
  return round2(a.salaryCost + a.pensionEmployer + a.gratuityAccrual + a.leaveProvisionChange);
}

/**
 * Cost per hour. Dividing by the larger of standard and logged hours means
 * hours × rate can never exceed the cost, however many hours were logged.
 */
export function labourRate(a: { cost: number; standardHours: number; loggedHours: number }): number {
  const hours = Math.max(a.standardHours, a.loggedHours);
  if (!(a.cost > 0) || !(hours > 0)) return 0;
  return round4(a.cost / hours);
}

/**
 * Used before the month's payroll posts: the package plus statutory on-costs
 * (gratuity at the first-five-years 21 days, annual leave), over standard hours.
 */
export function estimatedLabourRate(a: {
  gross: number;
  basic: number;
  pensionEmployer: number;
  isNational: boolean;
  annualLeaveDays: number;
  monthlyStandardHours: number;
}): number {
  if (!(a.monthlyStandardHours > 0)) return 0;
  const gratuity = a.isNational ? 0 : (a.basic * 21) / 30 / 12;
  const leave = (a.basic * a.annualLeaveDays) / 30 / 12;
  return round4((a.gross + a.pensionEmployer + gratuity + leave) / a.monthlyStandardHours);
}

/** Splits one employee's absorbed labour across their entries so the parts sum exactly. */
export function allocateAbsorption<T extends { id: string; hours: number }>(
  entries: T[],
  rate: number,
  cap: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!entries.length) return out;
  const hours = entries.reduce((s, e) => s + e.hours, 0);
  const total = round2(Math.min(round2(hours * rate), cap));
  let largest = entries[0];
  let sum = 0;
  for (const e of entries) {
    const amount = round2(e.hours * rate);
    out.set(e.id, amount);
    sum = round2(sum + amount);
    if (e.hours > largest.hours) largest = e;
  }
  out.set(largest.id, round2(out.get(largest.id)! + round2(total - sum)));
  return out;
}

/** Operation minutes nobody's timesheet accounts for. */
export function unlinkedHours(actualMinutes: number, entryHours: number): number {
  return Math.max(0, round2(actualMinutes / 60 - entryHours));
}

export type LabourStatus = 'ACTUAL' | 'PROVISIONAL' | 'MIXED' | 'STANDARD';
export const LABOUR_STATUSES: readonly LabourStatus[] = ['ACTUAL', 'PROVISIONAL', 'MIXED', 'STANDARD'];

/**
 * ACTUAL: every hour costed from a posted run. PROVISIONAL: some hours wait on
 * a month's payroll. MIXED: actual plus clock minutes from users not linked to
 * an employee. STANDARD: only unlinked minutes (jobs from before timesheets).
 */
export function labourStatus(s: { actual: number; provisional: number; unlinked: number }): LabourStatus | null {
  if (s.provisional > 0) return 'PROVISIONAL';
  if (s.unlinked > 0) return s.actual > 0 ? 'MIXED' : 'STANDARD';
  if (s.actual > 0) return 'ACTUAL';
  return null;
}
```

Export from `index.ts` beside the other payroll modules: `export * from './payroll/labour';`. If `round4` collides with an existing barrel export (`grep -rn "export function round4\|export const round4" packages/shared/src`), drop the export keyword here and import the existing one instead.

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build` → PASS.

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): labour cost per hour, estimated rate and absorption rounding"`

---

### Task 3: Shared — job cost with real labour, timesheet schemas and DTOs

**Files:**
- Modify: `packages/shared/src/production/work-orders.ts`, `packages/shared/src/production/work-orders.test.ts`, `packages/shared/src/payroll/types.ts`, the #3 compliance schema/DTO files (`schemas/payroll-compliance.ts`, `payroll/compliance-types.ts`), `packages/shared/src/finance/currency.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/timesheets/types.ts`, `packages/shared/src/schemas/timesheets.ts`, `packages/shared/src/schemas/timesheets.test.ts`

**Interfaces:**
- Produces:
  - `actualCost(input)` accepts optional `labour?: number`; when given it is the labour figure (operations still drive machine time).
  - `interface LabourSplit { actual: number; provisional: number; unlinked: number }`
  - `interface WorkOrderLabourEmployeeDto { employeeId: string; employeeName: string; hours: number; rate: number | null; amount: number | null; status: 'ACTUAL' | 'PROVISIONAL' }`
  - `interface WorkOrderLabourDto { actual: number | null; provisional: number | null; unlinked: number | null; total: number | null; unlinkedHours: number; status: LabourStatus | null; byEmployee: WorkOrderLabourEmployeeDto[] }`
  - `WorkOrderDto.labour: WorkOrderLabourDto | null` (null on list responses; filled on `get`).
  - `TIMESHEET_INDIRECT_CATEGORIES = ['CLEANING','MAINTENANCE','TRAINING','IDLE','OTHER'] as const`, `type TimesheetIndirectCategory`, `type TimesheetSource = 'MANUAL' | 'CLOCK'`.
  - `TimesheetEntryDto { id; employeeId; employeeName; employeeNumber; workDate; hours; workOrderId: string | null; woNumber: string | null; operationId: string | null; operationLabel: string | null; indirectCategory: TimesheetIndirectCategory | null; source: TimesheetSource; note: string | null; locked: boolean; absorbed: boolean }`
  - `TimesheetEmployeeDto { id; employeeNumber; name; status: EmployeeStatus; joiningDate: string; leavingDate: string | null; userId: string | null }`
  - `TimesheetOperationOptionDto { workOrderId; woNumber; workOrderStatus: WorkOrderStatus; description; operationId; operationLabel; operationStatus: WorkOrderOperationStatus }`
  - `LabourUtilisationRowDto { employeeId; employeeNumber; employeeName; standardHours; directHours; indirectHours: Record<TimesheetIndirectCategory, number>; unloggedHours; cost: number; absorbed: number; unabsorbed: number }`, `LabourUtilisationDto { period: string; status: 'ACTUAL' | 'PROVISIONAL'; rows: LabourUtilisationRowDto[]; totals: Omit<LabourUtilisationRowDto, 'employeeId' | 'employeeNumber' | 'employeeName'> }`
  - Schemas (each with `*Input` = `z.input`, `*Payload` = `z.output`): `timesheetEntrySchema`, `updateTimesheetEntrySchema`, `bulkTimesheetSchema`, `timesheetQuerySchema`, `crewQuerySchema`, `labourUtilisationQuerySchema`.
  - `PayrollRunLineDto` gains `standardHours, loggedHours, directHours, labourRate, labourAbsorbed: number`; `PayrollRunTotalsDto` gains `labourAbsorbed: number`; `PayrollSettingsDto` and `payrollSettingsSchema` gain `monthlyStandardHours` (default 208, 100..320).
  - `MarginRowDto.provisionalLabourShare: number`.

- [ ] **Step 1: Failing tests**

Append to `production/work-orders.test.ts`:

```ts
  it('uses the labour figure it is given instead of minutes × standard rate', () => {
    const op = { workCenterId: 'w', workCenterName: 'Cut', status: 'DONE' as const, estimatedSetupMinutes: 0, estimatedRunMinutes: 60, estimatedChargedMinutes: 60, actualMinutes: 120, machineCostPerHour: 30, laborCostPerHour: 20 };
    const r = actualCost({ operations: [op], materialValue: 100, toolingCost: 0, overheadPct: 0.1, qtyCompleted: 1, labour: 75 });
    expect(r.machine).toBe(60);
    expect(r.labor).toBe(75);
    expect(r.overhead).toBe(23.5); // 10% of 100 + 60 + 75
    expect(r.total).toBe(258.5);
  });
```

```ts
// packages/shared/src/schemas/timesheets.test.ts
import { describe, expect, it } from 'vitest';
import { bulkTimesheetSchema, labourUtilisationQuerySchema, timesheetEntrySchema, timesheetQuerySchema, updateTimesheetEntrySchema } from './timesheets';

const E = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';

describe('timesheet schemas', () => {
  it('an entry on a job operation', () => {
    const v = timesheetEntrySchema.parse({ employeeId: E, workDate: '2026-09-03', hours: '7.5', operationId: O });
    expect(v).toEqual({ employeeId: E, workDate: '2026-09-03', hours: 7.5, operationId: O, indirectCategory: null, note: null });
  });
  it('an indirect entry', () => expect(timesheetEntrySchema.parse({ employeeId: E, workDate: '2026-09-03', hours: 1, indirectCategory: 'IDLE' }).indirectCategory).toBe('IDLE'));
  it('needs exactly one of operation or category', () => {
    expect(timesheetEntrySchema.safeParse({ employeeId: E, workDate: '2026-09-03', hours: 1 }).success).toBe(false);
    expect(timesheetEntrySchema.safeParse({ employeeId: E, workDate: '2026-09-03', hours: 1, operationId: O, indirectCategory: 'IDLE' }).success).toBe(false);
  });
  it('hours above 0, at most 24, two decimals', () => {
    for (const hours of [0, -1, 24.01, 1.234]) expect(timesheetEntrySchema.safeParse({ employeeId: E, workDate: '2026-09-03', hours, indirectCategory: 'IDLE' }).success).toBe(false);
  });
  it('patch takes hours and note only', () => expect(updateTimesheetEntrySchema.parse({ hours: 2, note: '' })).toEqual({ hours: 2, note: null }));
  it('bulk upserts and deletes', () => {
    const v = bulkTimesheetSchema.parse({ upserts: [{ id: O, employeeId: E, workDate: '2026-09-03', hours: 3, indirectCategory: 'TRAINING' }], deletes: [] });
    expect(v.upserts[0].id).toBe(O);
    expect(bulkTimesheetSchema.safeParse({ upserts: [], deletes: [] }).success).toBe(false);
  });
  it('query ranges up to 62 days, from ≤ to', () => {
    expect(timesheetQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success).toBe(true);
    expect(timesheetQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(false);
    expect(timesheetQuerySchema.safeParse({ from: '2026-01-01', to: '2026-06-01' }).success).toBe(false);
  });
  it('utilisation period is YYYY-MM', () => expect(labourUtilisationQuerySchema.safeParse({ period: '2026-13' }).success).toBe(false));
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/production src/schemas/timesheets.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `production/work-orders.ts` `actualCost`: add `labour?: number;` to the input type (doc: "Labour already costed from timesheets and payroll; when absent, actual minutes × the snapshotted labour rate"), and after the loop: `if (input.labour != null) labor = input.labour;`. Add `LabourSplit`, `WorkOrderLabourEmployeeDto`, `WorkOrderLabourDto` (importing `LabourStatus` from `../payroll/labour`) and `labour: WorkOrderLabourDto | null;` on `WorkOrderDto` (doc: "Null on list responses; amounts null without quote:view_cost, per-employee rate/amount null without payroll:read").

```ts
// packages/shared/src/timesheets/types.ts
import type { EmployeeStatus } from '../payroll/types';
import type { WorkOrderOperationStatus, WorkOrderStatus } from '../production/work-orders';

export const TIMESHEET_INDIRECT_CATEGORIES = ['CLEANING', 'MAINTENANCE', 'TRAINING', 'IDLE', 'OTHER'] as const;
export type TimesheetIndirectCategory = (typeof TIMESHEET_INDIRECT_CATEGORIES)[number];
export type TimesheetSource = 'MANUAL' | 'CLOCK';
// …the DTO interfaces listed under Interfaces, verbatim.
```

(Check the actual module paths of `EmployeeStatus`, `WorkOrderStatus`, `WorkOrderOperationStatus` with grep and import from there.)

```ts
// packages/shared/src/schemas/timesheets.ts
import { z } from 'zod';
import { TIMESHEET_INDIRECT_CATEGORIES } from '../timesheets/types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const hours = z.coerce
  .number()
  .gt(0, 'Log more than zero hours')
  .max(24, 'A day has 24 hours')
  .refine((h) => Math.abs(Math.round(h * 100) - h * 100) < 1e-6, 'Use at most two decimals');
const note = z.string().trim().max(500).nullish().transform((v) => (v ? v : null));
const oneTarget = (v: { operationId: string | null; indirectCategory: string | null }) =>
  (v.operationId == null) !== (v.indirectCategory == null);
const oneTargetMessage = { message: 'Choose a job operation or an indirect category', path: ['operationId'] };

const entryBase = z.object({
  employeeId: z.string().uuid(),
  workDate: isoDate,
  hours,
  operationId: z.string().uuid().nullish().transform((v) => v ?? null),
  indirectCategory: z.enum(TIMESHEET_INDIRECT_CATEGORIES).nullish().transform((v) => v ?? null),
  note,
});

export const timesheetEntrySchema = entryBase.refine(oneTarget, oneTargetMessage);
export const updateTimesheetEntrySchema = z.object({ hours, note });
export const bulkTimesheetSchema = z
  .object({
    upserts: z.array(entryBase.extend({ id: z.string().uuid().optional() }).refine(oneTarget, oneTargetMessage)).max(500),
    deletes: z.array(z.string().uuid()).max(500),
  })
  .refine((v) => v.upserts.length + v.deletes.length > 0, { message: 'Nothing to save' });

const DAY = 86_400_000;
export const timesheetQuerySchema = z
  .object({ employeeId: z.string().uuid().optional(), from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: '"from" must be on or before "to"', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / DAY <= 62, { message: 'Ask for at most 62 days', path: ['to'] });
export const crewQuerySchema = z.object({ workDate: isoDate, workOrderId: z.string().uuid() });
export const labourUtilisationQuerySchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });

export type TimesheetEntryInput = z.input<typeof timesheetEntrySchema>;
export type TimesheetEntryPayload = z.output<typeof timesheetEntrySchema>;
export type UpdateTimesheetEntryInput = z.input<typeof updateTimesheetEntrySchema>;
export type UpdateTimesheetEntryPayload = z.output<typeof updateTimesheetEntrySchema>;
export type BulkTimesheetInput = z.input<typeof bulkTimesheetSchema>;
export type BulkTimesheetPayload = z.output<typeof bulkTimesheetSchema>;
export type TimesheetQueryPayload = z.output<typeof timesheetQuerySchema>;
export type CrewQueryPayload = z.output<typeof crewQuerySchema>;
export type LabourUtilisationQueryPayload = z.output<typeof labourUtilisationQuerySchema>;
```

Payroll types: add the five line fields and `labourAbsorbed` to totals. #3 settings: `payrollSettingsSchema` gains `monthlyStandardHours: z.coerce.number().min(100).max(320).default(208)`; `PayrollSettingsDto` gains `monthlyStandardHours: number`. `MarginRowDto` gains `provisionalLabourShare: number` with doc "Fraction of `cost` that is labour still waiting on its month's payroll".

Export `./timesheets/types` and `./schemas/timesheets` from `index.ts`.

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build && corepack pnpm --filter api exec tsc --noEmit -p tsconfig.json && corepack pnpm --filter web exec tsc --noEmit`. Expected: shared PASS; api/web report the new required DTO fields missing — that is Task 4's plumbing. To keep every commit building, in this task also add the minimum to compile: `labour: null` in `ProductionService.toDtos`, the five line fields and `labourAbsorbed` as `0` in the payroll DTO mappers, `monthlyStandardHours: 208` in `PayrollSettingsService` defaults/mapping, `provisionalLabourShare: 0` in `ReportsService.margins` rows, and the same in web spec fixtures. Then all three build.

- [ ] **Step 5: Commit** — `git add packages/shared/src apps && git commit -m "feat(shared): job labour DTOs, timesheet schemas, labour override on actual cost"`

---

### Task 4: API — migration, entities, module skeleton and plumbing

**Files:**
- Create: `apps/api/src/database/migrations/1790200000000-JobCosting.ts`, `apps/api/src/database/job-costing-migration.spec.ts`, `apps/api/src/modules/job-costing/entities/timesheet-entry.entity.ts`, `apps/api/src/modules/job-costing/entities/work-order-labour.entity.ts`, `apps/api/src/modules/job-costing/job-costing.lock.ts`, `apps/api/src/modules/job-costing/job-costing.module.ts`
- Modify: `modules/payroll/entities/payroll-run.entity.ts`, `modules/payroll/entities/payroll-settings.entity.ts`, `modules/payroll/payroll-settings.service.ts`, `modules/payroll/payroll-runs.service.ts`, `modules/production/entities/work-order.entity.ts`, `modules/audit/audit-subjects.ts`, `app.module.ts`

**Interfaces:**
- Produces:
  - `TimesheetEntry` (`timesheet_entries`): `id (uuid PK), tenantId ('tenant_id' uuid), employeeId ('employee_id' uuid), workDate ('work_date' date, string), hours (numeric 5,2, numericTransformer), workOrderId ('work_order_id' uuid null), operationId ('operation_id' uuid null), indirectCategory ('indirect_category' varchar 20 null), source (varchar 10, default 'MANUAL'), note (text null), runLineId ('run_line_id' uuid null), createdById ('created_by_id' uuid null), createdAt (CreateDateColumn 'created_at'), updatedAt (UpdateDateColumn 'updated_at')`. Indexes `idx_timesheet_entries_employee_date` (`tenantId, employeeId, workDate`), `idx_timesheet_entries_operation` (`operationId`), `idx_timesheet_entries_work_order` (`workOrderId`).
  - `WorkOrderLabour` (`work_order_labour`): `id, tenantId, workOrderId ('work_order_id'), employeeId ('employee_id'), runId ('run_id'), runLineId ('run_line_id'), period (char 7), hours (numeric 7,2), rate (numeric 12,4), amount (numeric 14,2), account (varchar 4: 'WIP' | 'COGS'), clearedTo ('cleared_to' varchar 7 null: 'COGS' | 'EXPENSE'), clearedAt ('cleared_at' timestamptz null), journalEntryId ('journal_entry_id' uuid), createdAt`. Indexes `idx_work_order_labour_work_order` (`workOrderId`), `idx_work_order_labour_run` (`runId`).
  - `lockJobCosting(manager: EntityManager, tenantId: string): Promise<void>` — `SELECT pg_advisory_xact_lock(hashtext($1))` with `'job-costing:' + tenantId`.
  - `PayrollRunLine` gains `standardHours ('standard_hours' numeric 7,2 default 0)`, `loggedHours ('logged_hours' numeric 7,2 default 0)`, `directHours ('direct_hours' numeric 7,2 default 0)`, `labourRate ('labour_rate' numeric 12,4 default 0)`, `labourAbsorbed (money('labour_absorbed'))`.
  - `PayrollRun` gains `totalLabourAbsorbed (money('total_labour_absorbed'))`, `labourJournalEntryId ('labour_journal_entry_id' uuid null)`, `labourVoidJournalEntryId ('labour_void_journal_entry_id' uuid null)`.
  - `PayrollSettings` gains `monthlyStandardHours ('monthly_standard_hours' numeric 6,2 default 208, numericTransformer)`.
  - `WorkOrder` gains `labourStatus ('labour_status' varchar 12 null)`, `labourSplit ('labour_split' jsonb null, type `LabourSplit | null`)`.
  - `JobCostingModule` registering both new entities plus `WorkOrder`, `WorkOrderOperation`, `WorkOrderMaterial`, `Employee`, `SalaryPackage`, `PensionScheme`, `PayrollSettings`, `PayrollRun`, `PayrollRunLine` via `TypeOrmModule.forFeature`, importing `FinanceModule`; providers/exports filled by later tasks.
  - Audit: `timesheets → { subject: 'TIMESHEET', entity: TimesheetEntry }`.

Migration `up()` (one transaction, statements in this order):
1. `ALTER TABLE "payroll_run_lines" ADD …` the five columns; `ALTER TABLE "payroll_runs" ADD …` the three; `ALTER TABLE "payroll_settings" ADD "monthly_standard_hours" numeric(6,2) NOT NULL DEFAULT 208` plus `CONSTRAINT "CHK_payroll_settings_standard_hours" CHECK ("monthly_standard_hours" BETWEEN 100 AND 320)`; `ALTER TABLE "work_orders" ADD "labour_status" varchar(12)`, `ADD "labour_split" jsonb`, CHECK `"labour_status" IN ('ACTUAL','PROVISIONAL','MIXED','STANDARD')`.
2. `CREATE TABLE "timesheet_entries"` then `"work_order_labour"`, uuid PK `DEFAULT gen_random_uuid()` named `PK_<table>_id`, the indexes above with exact names. FKs (`FK_<table>_<column-stem>`): `tenant_id → organizations(id) ON DELETE CASCADE`; `employee_id → employees(id) ON DELETE RESTRICT`; `work_order_id → work_orders(id) ON DELETE RESTRICT`; `timesheet_entries.operation_id → work_order_operations(id) ON DELETE RESTRICT`; `run_line_id → payroll_run_lines(id) ON DELETE SET NULL` on `timesheet_entries`, `ON DELETE RESTRICT` on `work_order_labour`; `work_order_labour.run_id → payroll_runs(id) ON DELETE RESTRICT`; `journal_entry_id → journal_entries(id) ON DELETE RESTRICT`; `payroll_runs.labour_journal_entry_id` / `labour_void_journal_entry_id → journal_entries(id) ON DELETE RESTRICT`. CHECKs: `timesheet_entries."hours" > 0 AND "hours" <= 24`; `("operation_id" IS NULL) <> ("indirect_category" IS NULL)`; `("work_order_id" IS NULL) = ("operation_id" IS NULL)`; `indirect_category IN ('CLEANING','MAINTENANCE','TRAINING','IDLE','OTHER')`; `source IN ('MANUAL','CLOCK')`; `work_order_labour.account IN ('WIP','COGS')`; `cleared_to IN ('COGS','EXPENSE')`.
3. Account backfill (6390, parent 6300 by role `SALARIES`):

```ts
await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
await queryRunner.query(
  `INSERT INTO "ledger_accounts" ("tenant_id", "code", "name", "type", "role", "is_system", "description", "parent_id")
   SELECT t."tenant_id", '6390', 'Labour absorbed', 'EXPENSE'::"ledger_accounts_type_enum", 'LABOUR_ABSORBED', true,
          'Payroll cost charged to jobs (a credit): Salaries & wages net of this is labour not spent on jobs',
          (SELECT p."id" FROM "ledger_accounts" p
            WHERE p."tenant_id" = t."tenant_id" AND p."role" = 'SALARIES' AND p."deletedAt" IS NULL)
   FROM (SELECT DISTINCT "tenant_id" FROM "ledger_accounts") t
   WHERE NOT EXISTS (
     SELECT 1 FROM "ledger_accounts" x
     WHERE x."tenant_id" = t."tenant_id" AND (x."role" = 'LABOUR_ABSORBED' OR x."code" = '6390') AND x."deletedAt" IS NULL
   )`,
);
```

4. RLS loop over `timesheet_entries`, `work_order_labour` (copy the loop from `1790000000000`).

`down()`: drop the two tables, the added columns and constraints, soft-delete the 6390 system account (`UPDATE … SET "deletedAt" = now() WHERE "is_system" AND "role" = 'LABOUR_ABSORBED'`).

Plumbing: map the new line/run columns in `PayrollRunsService` `toLineDto`/`toDto`/`recalcTotals`/`saveTotals` (`totalLabourAbsorbed = Σ labourAbsorbed`; refresh resets nothing — the labour columns are written only by approval); `PayrollSettingsService.get/put` read and write `monthlyStandardHours` (upsert column list gains it); add `JobCostingModule` to `AppModule` imports beside `PayrollModule`.

- [ ] **Step 1: Failing test** — `job-costing-migration.spec.ts` in the style of #3's `uae-compliance-migration.spec.ts`: runs `up()` against a recording `queryRunner` and asserts (a) both `CREATE TABLE` statements, (b) every index name declared on the two entities appears, (c) the 6390 insert carries the code-or-role guard and the `SALARIES` parent lookup, (d) `FORCE ROW LEVEL SECURITY` for both tables, (e) `down()` drops both tables.
- [ ] **Step 2: Run** — `corepack pnpm --filter api exec jest src/database/job-costing-migration.spec.ts` → FAIL.
- [ ] **Step 3: Implement** the migration, entities, lock helper, module, plumbing.
- [ ] **Step 4: Run** — `corepack pnpm --filter api test && corepack pnpm --filter api build` → PASS.
- [ ] **Step 5: Commit** — `feat(api): timesheet and job labour tables, Labour absorbed account`

---

### Task 5: API — timesheets service and controller

**Files:**
- Create: `apps/api/src/modules/job-costing/timesheets.service.ts`, `timesheets.service.spec.ts`, `timesheets.controller.ts`
- Modify: `job-costing.module.ts`

**Interfaces:**
- Consumes: `lockJobCosting`, `POSTED_RUN_STATUSES` (`modules/payroll/advances.service.ts`), `TimesheetEntry`, `WorkOrder`, `WorkOrderOperation`, `Employee`, `PayrollRun`, `PayrollRunLine`, schemas from Task 3; `JobCostService.recompute` (Task 6 — until then, inject it as optional and call `this.jobCost?.recompute`; Task 6 makes it required).
- Produces:
  - `TimesheetsService.list(tenantId, q: TimesheetQueryPayload): Promise<TimesheetEntryDto[]>`
  - `.crew(tenantId, q: CrewQueryPayload): Promise<TimesheetEntryDto[]>` (all entries on that work order on that date)
  - `.employees(tenantId): Promise<TimesheetEmployeeDto[]>` (not soft-deleted, ordered by name)
  - `.operations(tenantId): Promise<TimesheetOperationOptionDto[]>` (operations on RELEASED/IN_PROGRESS/COMPLETE work orders, not SKIPPED; COMPLETE ones only if completed within the last 62 days)
  - `.create(tenantId, actorId, input: TimesheetEntryPayload): Promise<TimesheetEntryDto>`
  - `.update(tenantId, id, input: UpdateTimesheetEntryPayload): Promise<TimesheetEntryDto>`
  - `.remove(tenantId, id): Promise<void>`
  - `.bulk(tenantId, actorId, input: BulkTimesheetPayload): Promise<TimesheetEntryDto[]>`
  - `.recordClock(manager, tenantId, a: { userId: string; workOrderId: string; operationId: string; minutes: number; workDate: string }): Promise<TimesheetEntry | null>` (Task 7 calls it; implemented here)
  - `.isPosted(manager, tenantId, employeeId, period): Promise<{ runNumber: string } | null>`
  - Routes (controller `@Controller('timesheets')`): `GET /timesheets` (`TIMESHEET_READ`, `zodQuery(timesheetQuerySchema)`), `GET /timesheets/crew` (`TIMESHEET_READ`), `GET /timesheets/employees` (`TIMESHEET_READ`), `GET /timesheets/operations` (`TIMESHEET_READ`), `POST /timesheets` (`TIMESHEET_MANAGE`), `POST /timesheets/bulk` (`TIMESHEET_MANAGE`, 200), `PATCH /timesheets/:id` (`TIMESHEET_MANAGE`), `DELETE /timesheets/:id` (`TIMESHEET_MANAGE`, 204). Declare the static `GET` routes before any `:id` route.

All writes go through one private `apply(manager, tenantId, actorId, { creates, updates, deletes })` inside one transaction:
1. `await lockJobCosting(manager, tenantId)` first.
2. Load every touched entry (`updates`/`deletes`, 404 if not the tenant's) and every touched operation (`creates`; 404 "That operation is not on a work order"), then lock the touched work orders `FOR UPDATE` sorted by id (query builder `setLock('pessimistic_write')`).
3. Per entry (existing and new): employee exists and is not soft-deleted (404); `workDate` within `joiningDate..leavingDate` (400 "<name> was not employed on <date>"); `isPosted(employee, workDate month)` → 409 "Payroll for <Month YYYY> is posted (<run number>); void it to change these hours"; work order PLANNED → 400 "<WO> has not been released to the floor yet"; CANCELLED → 409 "<WO> is cancelled"; operation SKIPPED → 400 "\"<label>\" was skipped".
4. Minute deltas per operation (`+hours×60` create, `(new−old)×60` update, `−hours×60` delete; CLOCK entries included on update/delete): `UPDATE "work_order_operations" SET "actual_minutes" = GREATEST(0, ROUND(("actual_minutes" + $1)::numeric, 2)) WHERE "id" = $2`; if the operation is PENDING and the delta is positive, also set `status = 'PAUSED'`, `started_at = COALESCE(started_at, now())`; a RELEASED work order receiving time becomes IN_PROGRESS (targeted update of `status`).
5. After applying: for each (employee, workDate) touched, `SUM(hours) > 24` → 422 "<name> has more than 24 hours on <date>" (the whole transaction rolls back).
6. For each touched work order with status COMPLETE: `JobCostService.recompute(manager, tenantId, workOrderId)`.

`isPosted`: `SELECT r."run_number" FROM "payroll_run_lines" l JOIN "payroll_runs" r ON r."id" = l."run_id" WHERE l."tenant_id" = $1 AND l."employee_id" = $2 AND r."period" = $3 AND r."status" = ANY($4)` with `POSTED_RUN_STATUSES`.

DTO mapping: `locked = isPosted(...) != null` (batch: one query per (employee, period) set); `absorbed = runLineId != null`; names from `Employee` (`firstName lastName`), `woNumber`/`operationLabel` from the joined rows.

`recordClock` (no lock of its own — callers hold `lockJobCosting` and the work order lock): find the employee by `userId` (not soft-deleted) → none: `null`; `hours = round2(minutes / 60)`; return `null` (no throw) when `hours <= 0`, `workDate` outside employment, `isPosted`, or the day's existing hours + `hours` > 24; else insert `{ source: 'CLOCK', createdById: userId, note: null, workOrderId, operationId, indirectCategory: null }`. It does **not** touch `actual_minutes` (the clock already added them).

- [ ] **Step 1: Failing tests** (in-memory repos and a recording `manager.query`, in the style of `production.service.spec.ts`):
  - create adds `hours × 60` to the operation's minutes, turns a PENDING operation PAUSED and a RELEASED work order IN_PROGRESS.
  - update applies the difference; delete subtracts; minutes never go below zero.
  - editing a CLOCK entry applies its delta too.
  - **refuses hours in a posted month** → 409 naming the run; the same entry is editable once the run is voided.
  - outside employment → 400; cancelled work order → 409; planned → 400; skipped operation → 400.
  - more than 24 hours in a day across two entries → 422 and nothing saved.
  - bulk applies deletes, updates and creates in one transaction; a failure in one item saves none.
  - **late hours recompute a completed job**: an entry on a COMPLETE work order calls `JobCostService.recompute` with that id.
  - `lockJobCosting` is the first query of every write (assert the recorded query order).
  - `recordClock`: unlinked user → null; linked → one CLOCK entry, minutes untouched; posted month / outside employment / over 24 h → null without throwing.
  - controller: `GET` routes need `timesheet:read`, writes `timesheet:manage` (metadata assertions as in `payroll-runs.controller.spec.ts`).
- [ ] **Step 2–4:** FAIL → implement → PASS (`corepack pnpm --filter api exec jest src/modules/job-costing`).
- [ ] **Step 5: Commit** — `feat(api): timesheets with operation minutes, posted-month locks and a daily cap`

---

### Task 6: API — job labour breakdown and recompute

**Files:**
- Create: `apps/api/src/modules/job-costing/job-cost.service.ts`, `job-cost.service.spec.ts`
- Modify: `job-costing.module.ts`, `modules/production/production.service.ts`, `production.service.spec.ts`, `production.controller.ts`, `production.module.ts`, `timesheets.service.ts` (make `JobCostService` required)

**Interfaces:**
- Consumes: `actualCost` with `labour`, `estimatedLabourRate`, `unlinkedHours`, `labourStatus`, `pensionContribution` (#3), `periodBounds`.
- Produces:
  - `JobCostService.estimatedRate(manager, tenantId, employeeId, period): Promise<number>` — package in effect on the period's last day (`SalaryPackage.effectiveFrom <= last`, latest first; none → 0); settings from `PayrollSettings` (defaults `monthlyStandardHours 208`, `annualLeaveDays 30` when no row); `annualDays = employee.annualLeaveDaysOverride ?? settings.annualLeaveDays`; pension employer share = `pensionContribution({ rates: scheme, basic, housing, gross, daysEmployed: 30, daysInMonth: 30 }).employer` when the employee `isNational` and has an **active** scheme, else 0. Memoised per call site via an optional `cache: Map<string, number>` argument keyed `employeeId:period`.
  - `.split(manager, tenantId, workOrderId): Promise<{ split: LabourSplit; unlinkedHours: number; byEmployee: WorkOrderLabourEmployeeDto[] }>`:
    - actual: `work_order_labour` rows for the work order grouped by (employee) → hours Σ, amount Σ, rate `round4(amount / hours)`, status ACTUAL.
    - provisional: timesheet entries on the work order with `runLineId IS NULL` grouped by (employee, month) → `round2(hours × estimatedRate)`; per employee Σ hours/amount, rate = the latest month's estimated rate; status PROVISIONAL.
    - unlinked: per operation not SKIPPED, `unlinkedHours(actualMinutes, Σ entry hours on it) × laborCostPerHour` (round2 at the end); `unlinkedHours` total.
  - `.costFor(manager, tenantId, wo: WorkOrder, ops: WorkOrderOperation[], materialValue: number, qtyCompleted: number): Promise<{ cost: CostSplit; split: LabourSplit; status: LabourStatus | null }>` — `actualCost({ …as complete() builds it, labour: actual + provisional + unlinked })`.
  - `.recompute(manager, tenantId, workOrderId): Promise<void>` — only for COMPLETE work orders: material value = Σ `valueIssued` of its materials; `qtyCompleted = wo.qtyCompleted ?? wo.qty`; targeted `update(WorkOrder, { id }, { actualCost, labourStatus, labourSplit })`.
  - `.breakdown(manager, tenantId, workOrderId, visibility: { cost: boolean; pay: boolean }): Promise<WorkOrderLabourDto>` — amounts null without `cost`; per-employee `rate`/`amount` null without `pay`; `total = actual + provisional + unlinked`.
  - `ProductionService.get(tenantId, id, canSeeCost, canSeePay = false)` fills `labour` via `breakdown`; `list` keeps `labour: null`. `ProductionController.get` passes `user.permissions.includes(PERMISSIONS.PAYROLL_READ)`.
  - `ProductionModule` imports `JobCostingModule`; `JobCostingModule` exports `JobCostService`, `TimesheetsService`.

- [ ] **Step 1: Failing tests:**
  - estimated rate for an expat and for a national on an active scheme (values from Task 2's examples); no package → 0; inactive scheme → no pension.
  - split: one posted row (actual), one unposted entry (provisional at the estimated rate), 90 operation minutes with 1 h of entries (0.5 h unlinked at the operation's standard rate).
  - recompute writes `actualCost.labor` = actual + provisional + unlinked, overhead reapplied, and `labourStatus` PROVISIONAL; an open work order is left alone.
  - breakdown masking: no `cost` → all amounts null, hours present; `cost` without `pay` → totals present, per-employee rate/amount null.
  - production spec: `get` returns `labour` from the (stubbed) service; `list` returns `labour: null`; update `makeWorld` to pass a stub `JobCostService`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(api): job labour breakdown at actual, provisional and standard rates`

---

### Task 7: API — the shop-floor clock writes timesheet entries

**Files:**
- Modify: `apps/api/src/modules/production/production.service.ts`, `production.service.spec.ts`

**Interfaces:**
- Consumes: `lockJobCosting`, `TimesheetsService.recordClock`.
- Produces: no new public methods; `stopOperation` (both stop and finish) and `logTime` behave as before plus a CLOCK entry for linked users.

Changes:
- `stopOperation` and `logTime`: first statement inside `this.dataSource.transaction` is `await lockJobCosting(manager, tenantId)`; then the existing code. `stopOperation` gains an `actorId: string` parameter (controller passes `user.id` for both stop and finish routes).
- `stopOperation`: when a running session closed, `added = Math.min(session, MAX_SESSION_MINUTES)`; after saving the operation, if `added > 0`: `await this.timesheets.recordClock(manager, tenantId, { userId: actorId, workOrderId: wo.id, operationId: op.id, minutes: added, workDate: isoDay(runningSince) })` where `isoDay(d) = d.toISOString().slice(0, 10)` (UTC — the platform has no tenant time zone; see FLAGS).
- `logTime`: after saving, `recordClock(…, { minutes, workDate: isoDay(new Date()) })`.
- The return value of `recordClock` is ignored: the floor is never blocked.

- [ ] **Step 1: Failing tests:**
  - stop by a user linked to an employee → one CLOCK entry for the session's hours dated the session start (UTC), minutes added once.
  - stop by an unlinked user → no entry, minutes added.
  - **skips the entry but keeps the minutes**: linked user whose month is posted (stub `recordClock` → null) → the stop succeeds and minutes are added.
  - logTime by a linked user → CLOCK entry dated today.
  - the first query in stop/finish/logTime is the job-costing advisory lock.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(api): clock sessions by linked users become timesheet entries`

---

### Task 8: API — absorption at payroll approval, reversal at void

**Files:**
- Create: `apps/api/src/modules/job-costing/labour-absorption.service.ts`, `labour-absorption.service.spec.ts`
- Modify: `apps/api/src/modules/payroll/payroll-posting.service.ts`, `payroll-posting.service.spec.ts`, `payroll.module.ts`, `job-costing.module.ts`

**Interfaces:**
- Consumes: `standardHours`, `labourCost`, `labourRate`, `allocateAbsorption`, `periodBounds`, `LedgerService.resolveLines`, `baseCurrencyFor`, `JobCostService.recompute`, `lockJobCosting`.
- Produces:
  - `interface PreparedAbsorption { total: number; journal: { workOrderId: string; woNumber: string; account: 'WIP' | 'COGS'; amount: number }[]; rows: Omit<WorkOrderLabour, 'id' | 'createdAt' | 'journalEntryId' | 'clearedTo' | 'clearedAt'>[]; stampEntryIds: Map<string, string> /* entry id → run line id */; completedWorkOrderIds: string[] }`
  - `LabourAbsorptionService.prepare(manager, tenantId, run: PayrollRun, lines: PayrollRunLine[]): Promise<PreparedAbsorption>` — mutates each line's `standardHours`, `loggedHours`, `directHours`, `labourRate`, `labourAbsorbed`.
  - `.post(manager, tenantId, run: PayrollRun, prepared: PreparedAbsorption, entryDate: Date): Promise<string | null>` — writes the labour journal, the `work_order_labour` rows, stamps the entries, recomputes completed work orders; returns the journal id (null when `total = 0`).
  - `.reverse(manager, tenantId, run: PayrollRun): Promise<string | null>` — returns the reversal journal id (null when nothing was absorbed).

`prepare`:
1. `{ first, last } = periodBounds(run.period)`; settings `monthlyStandardHours` (208 when no row).
2. Entries: `timesheet_entries` for the run's employees with `workDate BETWEEN first AND last`.
3. Work orders of the direct entries: id → `{ status, woNumber }`.
4. Per line: `logged = Σ hours`; `direct = Σ hours where operationId`; `std = standardHours({ daysEmployed, daysInMonth, monthlyStandardHours, overtimeHours, overtimeHoursPremium })`; `cost = labourCost({ salaryCost, pensionEmployer: line.pensionEmployer ?? 0, gratuityAccrual: line.gratuityAccrual ?? 0, leaveProvisionChange: line.leaveProvisionChange ?? 0 })`; `rate = labourRate({ cost, standardHours: std, loggedHours: logged })`; absorbable = direct entries whose work order is not CANCELLED; `amounts = allocateAbsorption(absorbable, rate, Math.max(cost, 0))`; `labourAbsorbed = Σ amounts`; set the five line fields (`loggedHours = logged`, `directHours = direct`).
5. Group amounts by (work order, employee) → rows `{ tenantId, workOrderId, employeeId, runId, runLineId, period, hours, rate, amount, account: status === 'COMPLETE' ? 'COGS' : 'WIP' }` (skip zero amounts); journal grouped by work order.
6. `stampEntryIds`: every entry of the line (direct and indirect) except those on CANCELLED work orders → the line id.

`post` (skip entirely when `total = 0`, but still stamp entries): journal `entryNumber 'JE-<run number>-LAB'`, `referenceType 'PAYROLL'`, `referenceId run.id`, `entryDate`, `totalAmount total`, base currency, lines: per work order `{ role: WIP | COGS, accountName: 'Work in progress' | 'Cost of goods sold', debit: amount, credit: 0, description: '<WO> labour <Month YYYY>' }`, plus `{ role: LABOUR_ABSORBED, accountName: 'Labour absorbed', debit: 0, credit: total, description: 'Payroll <run number> labour charged to jobs' }`. Insert rows with the journal id. `UPDATE "timesheet_entries" SET "run_line_id" = $1 WHERE "id" = ANY($2)` per line. `JobCostService.recompute` for each COMPLETE work order.

`reverse`: rows = `work_order_labour WHERE run_id = run.id`. For each row: `clearedTo = 'EXPENSE'` → skip (the cancel already returned it to 6390); `account = 'COGS' || clearedTo = 'COGS'` → credit COGS; else credit WIP. Debit LABOUR_ABSORBED with the Σ of the non-skipped amounts. Post `'JE-<run number>-LAB-VOID'` dated `max(today, labour journal entryDate)` when Σ > 0. Delete the rows; `UPDATE "timesheet_entries" SET "run_line_id" = NULL WHERE "run_line_id" = ANY(<run line ids>)`; recompute every COMPLETE work order the rows touched.

`PayrollPostingService` changes:
- approve: after `lockGratuityOpening`, `await lockJobCosting(manager, tenantId)`. After the gratuity/leave/pension per-line work and **before** the lines are saved: `const absorption = await this.labour.prepare(manager, tenantId, run, lines)`. After the main journal is saved: `const labourJournalEntryId = await this.labour.post(manager, tenantId, run, absorption, dayToDate(asOf))`. The run `update` gains `totalLabourAbsorbed` and `labourJournalEntryId`.
- void: after `lockGratuityOpening`, `await lockJobCosting(manager, tenantId)`; after the main reversal: `const labourVoidJournalEntryId = await this.labour.reverse(manager, tenantId, run)`; the run `update` gains `labourVoidJournalEntryId`, and resets `totalLabourAbsorbed` to 0 only if the existing pattern resets totals on void (it does not today — leave totals as they are).
- `PayrollModule` imports `JobCostingModule`; `JobCostingModule` exports `LabourAbsorptionService`.

- [ ] **Step 1: Failing tests** (`labour-absorption.service.spec.ts` and `payroll-posting.service.spec.ts`):
  - approve with one employee (cost 10,400, 208 standard, 40 h on an open job, 20 h on a completed job, 8 h IDLE) posts `JE-…-LAB`: Dr WIP 2,000, Dr COGS 1,000, Cr 6390 3,000; line `labourRate 50`, `directHours 60`, `loggedHours 68`; rows WIP/COGS; entries stamped (including the IDLE one).
  - **absorbed never exceeds cost**: 260 logged hours all direct → absorbed = cost exactly.
  - hours on a cancelled job are not absorbed and stay unstamped.
  - a line with cost ≤ 0 absorbs nothing.
  - a completed job touched by the approval is recomputed (labour ACTUAL).
  - **void after completion reverses from COGS**: approve (row WIP) → complete the job (row cleared to COGS, Task 9 behaviour simulated by setting `clearedTo`) → void credits COGS, not WIP; rows deleted; entries unstamped; job recomputed (labour back to PROVISIONAL).
  - void with no absorption posts no labour journal.
  - lock order: run lock, gratuity lock, job-costing lock (recorded queries in order).
  - main payroll journal unchanged by absorption (existing balance assertions still pass).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(api): payroll approval charges timesheet hours to jobs at actual cost`

---

### Task 9: API — completion and cancellation move absorbed labour

**Files:**
- Modify: `apps/api/src/modules/production/production.service.ts`, `production.service.spec.ts`, `apps/api/src/modules/job-costing/labour-absorption.service.ts`, `labour-absorption.service.spec.ts`

**Interfaces:**
- Produces:
  - `LabourAbsorptionService.wipLabour(manager, tenantId, workOrderId): Promise<{ ids: string[]; amount: number }>` — rows with `account = 'WIP'` and `clearedTo IS NULL`.
  - `.clear(manager, ids: string[], to: 'COGS' | 'EXPENSE'): Promise<void>` — targeted update of `clearedTo`, `clearedAt = now()`.

`complete`:
- First statement in the transaction: `await lockJobCosting(manager, tenantId)`.
- Replace the `actualCost({...})` call with `this.jobCost.costFor(manager, tenantId, wo, ops, wip, qtyCompleted)`; set `wo.actualCost`, `wo.labourStatus`, `wo.labourSplit`.
- `const labour = await this.absorption.wipLabour(manager, tenantId, wo.id)`; `const moved = money(wip + labour.amount)`; post the existing `JE-<WO>-DONE` entry when `moved > 0` with `amount: moved` and both lines at `moved`; then `clear(labour.ids, 'COGS')`. Update the comment above it: material and the labour absorbed so far both leave WIP; labour absorbed later goes straight to COGS.

`cancel`:
- First statement: `await lockJobCosting(manager, tenantId)`.
- After the material check: `wipLabour`; if `amount > 0`, post `'JE-<WO>-LAB-CANCEL'` (`referenceType 'WORK_ORDER'`): Dr `LABOUR_ABSORBED` / Cr `WIP` for the amount, description "<WO> cancelled: labour back to overhead"; `clear(ids, 'EXPENSE')`.

- [ ] **Step 1: Failing tests:**
  - complete with material 100 and WIP labour 300 posts one `JE-…-DONE` of 400 (Dr COGS / Cr WIP) and clears the rows to COGS; `actualCost.labor` comes from `costFor`.
  - complete with labour only (no material) still posts.
  - cancel with WIP labour posts Dr 6390 / Cr WIP and clears to EXPENSE; cancel with none posts nothing.
  - **cancel then void nets to zero**: approval absorbs 300 to WIP for the job; cancel posts Dr 6390 300 / Cr WIP 300; void skips the EXPENSE row → no labour reversal journal; Σ WIP lines = 0 and Σ 6390 lines = 0 across all three entries.
  - the first query of complete and cancel is the job-costing lock.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(api): completion moves absorbed labour to COGS; cancellation returns it to overhead`

---

### Task 10: API — margin report and labour utilisation

**Files:**
- Create: `apps/api/src/modules/job-costing/labour-utilisation.service.ts`, `labour-utilisation.service.spec.ts`, `labour-utilisation.controller.ts`
- Modify: `apps/api/src/modules/finance/reports.service.ts`, `reports.service.spec.ts` (or the margins spec that exists), `reports.controller.ts`, `job-costing.module.ts`

**Interfaces:**
- Produces:
  - `ReportsService.margins` rows gain `provisionalLabourShare`: per group, Σ `wo.labourSplit?.provisional ?? 0` over the measured work orders ÷ `g.cost`, rounded to 3 dp (0 when cost is 0). CSV gains a "Provisional labour %" column.
  - `LabourUtilisationService.forPeriod(tenantId, period): Promise<LabourUtilisationDto>`.
  - Route `GET /finance/reports/labour-utilisation?period=YYYY-MM` on `LabourUtilisationController` (`@Controller('finance')`), `@RequirePermissions(PERMISSIONS.FINANCE_READ, PERMISSIONS.PAYROLL_READ)`, `zodQuery(labourUtilisationQuerySchema)`.

`forPeriod`:
- Posted run for the period (`POSTED_RUN_STATUSES`): one row per line — `standardHours`, `directHours`, indirect hours by category from the line's entries, `unloggedHours = max(0, round2(standardHours − loggedHours))`, `cost = labourCost(line)`, `absorbed = labourAbsorbed`, `unabsorbed = round2(cost − absorbed)`; `status 'ACTUAL'`.
- Otherwise: employees ACTIVE during the period or with entries in it; `standardHours` from `daysEmployed` (calc's `daysEmployed`) with no overtime; `rate = JobCostService.estimatedRate`; `cost = round2(rate × standardHours)`; `absorbed = round2(rate × directHours on non-cancelled work orders)`; `status 'PROVISIONAL'`.
- `totals`: Σ of every numeric field (indirect per category).

- [ ] **Step 1: Failing tests:** margins provisional share for a group with one provisional and one actual job; utilisation for a posted month (absorbed + unabsorbed = cost per row and in totals; IDLE/TRAINING split; unlogged hours); utilisation for an unposted month uses estimated rates and says PROVISIONAL; route requires both permissions.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(api): labour utilisation report and provisional labour on margins`

---

### Task 11: API — seed job costing

**Files:**
- Modify: `apps/api/src/database/seeds/run-seed.ts`

**Interfaces:**
- Consumes: `TimesheetsService.bulk`, `ProductionService.complete/logTime`, `EmployeesService.update` (to link the owner user to one employee), `PayrollPostingService.approve` (existing call), repositories for `WorkOrder` / `WorkOrderOperation`.

Steps, inside `seedPayroll` **immediately before** the existing `posting.approve(...)` call for the seeded month (`lastPeriod`):
1. Insert two work orders directly (no sales order — the columns are nullable): `WO-SEED-1` and `WO-SEED-2`, status `IN_PROGRESS`, `qty 10`, `overheadPct 0.1`, `description` "Seed job 1/2", `releasedAt` the period's first day; each with two operations (`sequence 1/2`, labels "Cutting"/"Assembly", `workCenterId` a fixed uuid, `workCenterName` "Seed bench", `status 'PAUSED'`, estimates 120/240 minutes, `machineCostPerHour 40`, `laborCostPerHour 25`, `actualMinutes 0`).
2. `TimesheetsService.bulk` for three employees employed for the whole period (exclude the mid-month joiner and #3's seeded leaver): on days 3–7 of the period, 6 h on WO-SEED-1 "Cutting", 1.5 h on WO-SEED-2 "Assembly", 0.5 h `IDLE`.
3. `ProductionService.complete(tenantId, WO-SEED-1, ownerId, { qtyCompleted: 10 }, true)` — completed before approval, so its labour will absorb straight to COGS.
4. (existing) approve and pay.
5. `ProductionService.complete` WO-SEED-2 after approval — its WIP labour moves to COGS.
6. Link the owner user to one seeded employee (`EmployeesService.update(…, { userId: ownerId })`) and call `ProductionService.logTime` on a new `WO-SEED-3` (status `IN_PROGRESS`, one operation) for 45 minutes — a CLOCK entry dated today (current month, provisional).
7. `assertJobCostingSeeded(dataSource, tenantId, run, logger)`:
   - Σ `work_order_labour.amount` for the run = `run.totalLabourAbsorbed` > 0.
   - For every run line, `labourAbsorbed ≤ labourCost(line)`; Σ over lines of (absorbed + (cost − absorbed)) equals Σ cost (to the cent).
   - Every `work_order_labour` row for WO-SEED-1/2 has `account = 'COGS'` or `clearedTo = 'COGS'`.
   - The tenant's WIP ledger balance is 0 (no material is issued in the seed).
   - Exactly one CLOCK entry exists for WO-SEED-3.
   - WO-SEED-1 and WO-SEED-2 have `labourStatus = 'ACTUAL'`.
   Log a one-line summary.

- [ ] **Step 1:** implement; **Step 2:** `corepack pnpm --filter api build` (the seed runs in CI's schema job; there is no local database). **Step 3: Commit** — `chore(seed): timesheets, absorbed labour and a clock entry for the books check`

---

### Task 12: Web — timesheets

**Files:**
- Create: `apps/web/src/lib/api/endpoints/timesheets.ts`, `apps/web/src/hooks/use-timesheets.ts`, `apps/web/src/app/(app)/people/timesheets/page.tsx`, `apps/web/src/app/(app)/people/page.tsx`, `apps/web/src/components/people/people-index.tsx`, `timesheets-view.tsx`, `timesheet-week-grid.tsx`, `timesheet-crew-day.tsx`, `timesheets-view.spec.tsx`
- Modify: `apps/web/src/lib/nav.ts`, `apps/web/src/components/people/people-nav.tsx`, the api barrel that registers endpoint groups

**Interfaces:**
- Hooks: `useTimesheets(q)`, `useCrewTimesheets(q)`, `useTimesheetEmployees()`, `useTimesheetOperations()`, `useSaveTimesheets()` (bulk; invalidates `['timesheets']`, `['work-orders']`, `['payroll']`), `useDeleteTimesheet()`.

UI:
- `PEOPLE_NAV_ITEMS` gains `{ href: '/people/timesheets', label: 'Timesheets', icon: Clock, rule: { permission: PERMISSIONS.TIMESHEET_READ } }` between Employees and Payroll. The sidebar "People" item in `lib/nav.ts` becomes `href: '/people'`, `rule: { anyOf: [PERMISSIONS.EMPLOYEE_READ, PERMISSIONS.TIMESHEET_READ] }`. `app/(app)/people/page.tsx` renders `<PeopleIndex />`, a client component that `router.replace`s to the first `PEOPLE_NAV_ITEMS` entry the session can see (and shows the usual "no access" empty state if none).
- Page `/people/timesheets` (`PageGuard permission={PERMISSIONS.TIMESHEET_READ}`), tabs **Week** and **Crew day**.
- **Week grid:** employee picker (from `useTimesheetEmployees`), week picker (Mon–Sun, prev/next). Rows: one per (operation or indirect category) that has hours that week, plus an "Add row" picker (operations from `useTimesheetOperations` labelled `<WO> · <operation>`, then the five categories). Cells: number inputs (step 0.25, max 24). Daily totals row, red above 24. Locked cells (entry `locked`) read-only with a lock icon and tooltip "Payroll for this month is posted". CLOCK entries show a small clock badge. Save sends one bulk request: changed cells as upserts (existing id when the cell maps to one entry; a cell backed by several entries for the same target and day is read-only with the tooltip "Several entries — edit in Crew day"), cleared cells as deletes. Read-only without `TIMESHEET_MANAGE`.
- **Crew day:** pick a date and a work order (open or recently completed), then an operation; a table of employees employed that day with an hours input each (prefilled from `useCrewTimesheets`); Save → bulk upserts/deletes.
- Errors (409/422) show their message in a toast and keep the edits.

- [ ] **Step 1: Failing tests** (`timesheets-view.spec.tsx`, mocking hooks like `payroll.spec.tsx`): grid renders an employee's week with daily totals; editing a cell and saving sends one bulk payload with the upsert; clearing a cell sends a delete; a locked cell is read-only; without `TIMESHEET_MANAGE` there is no Save; crew day saves hours for two employees.
- [ ] **Step 2–4:** FAIL → implement → PASS (`corepack pnpm --filter web exec vitest run src/components/people/timesheets-view.spec.tsx && corepack pnpm --filter web exec tsc --noEmit`).
- [ ] **Step 5: Commit** — `feat(web): weekly and crew timesheets`

---

### Task 13: Web — job labour, payroll hours and standard hours

**Files:**
- Create: `apps/web/src/components/production/work-order-labour-panel.tsx`, `work-order-labour-panel.spec.tsx`
- Modify: `apps/web/src/components/production/work-order-drawer.tsx`, `apps/web/src/components/people/payroll-run-detail.tsx`, `apps/web/src/components/people/payroll-settings-view.tsx` (#3), related spec fixtures

UI:
- **Labour panel** in the work order drawer, after Operations: hidden when `wo.labour` is null. Header shows the status chip (`ACTUAL` green "Actual", `PROVISIONAL` amber "Provisional — waiting on payroll", `MIXED` "Actual + standard", `STANDARD` "Standard rates"). Table per employee: name, hours, rate, amount, status; rate/amount cells show "—" when null. Footer: unlinked hours × standard rate when `unlinkedHours > 0` ("Clock time from users not linked to an employee"), then totals (actual / provisional / unlinked / total) when not null.
- **Run detail** (`payroll:read`): each line gains Standard h, Logged h, Direct h and Absorbed columns (approved runs; drafts show "—"); run totals gain "Labour charged to jobs".
- **Payroll settings:** "Monthly standard hours" number input (100–320, default 208, help "Paid hours in a normal month: 26 days × 8 hours = 208") in the leave card.

- [ ] **Step 1: Failing tests:** panel renders actual and provisional rows, masks rate/amount when null, shows the unlinked footer; drawer shows the panel only when `labour` is present; run detail shows the absorbed column for an approved run; settings form submits `monthlyStandardHours`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(web): job labour panel, payroll hours and standard hours setting`

---

### Task 14: Web — reports

**Files:**
- Create: `apps/web/src/components/finance/reports/labour-utilisation.tsx`, `labour-utilisation.spec.tsx`
- Modify: `apps/web/src/components/finance/reports/reports-view.tsx`, `apps/web/src/hooks/use-platform.ts`, the reports endpoint file (`api.reports`)

UI:
- Margins table: a "provisional" badge after the margin when `provisionalLabourShare > 0`, tooltip "<n>% of cost is labour waiting on payroll".
- New tab `{ key: 'labour-utilisation', label: 'Labour', range: 'month' }`, shown only with `PAYROLL_READ`. `range: 'month'` renders an `<input type="month">` (default last month) and passes `{ period }`. `FinancialReport` union, `fetchers` and `api.reports.labourUtilisation(params)` gain the new report.
- Labour table: employee, standard h, direct h, indirect h (sum, with a per-category tooltip), unlogged h, cost, absorbed, unabsorbed; totals row; a "Provisional — payroll not posted" banner when `status === 'PROVISIONAL'`.

- [ ] **Step 1: Failing tests:** margins badge; the Labour tab is hidden without `payroll:read`; utilisation renders rows, totals and the provisional banner.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(web): labour utilisation report and provisional margin badge`

---

### Task 15: Docs and final verification

**Files:**
- Modify: `docs/FLAGS.md` — new section "Job costing" after "UAE payroll compliance"; remove the "#4" pointers from the Employees and payroll section.

- [ ] **Step 1: FLAGS bullets** (one each, with the reason):
  - Labour reaches jobs monthly, when payroll is approved; until then job labour is provisional at an estimated rate (package + statutory on-costs ÷ standard hours).
  - Cost per hour divides by the larger of standard and logged hours, so absorbed never exceeds payroll cost; unrecorded overtime lowers the rate instead of over-absorbing.
  - Labour absorption posts as its own journal (`JE-<run>-LAB`) in the approval transaction; void reverses it against where each amount sits now (WIP, COGS, or nothing if a cancellation already returned it to overhead).
  - Hours on cancelled jobs are not charged; labour absorbed into a job that is later cancelled returns to 6390 (overhead).
  - Machine time and the template overhead % stay management figures in `actualCost`; they are not posted.
  - Clock entries are dated in UTC (there is no tenant time zone yet); a session that starts after 20:00 in the UAE lands on the previous day.
  - The clock never fails because of timesheets: when an entry cannot be written (posted month, outside employment, over 24 hours) the minutes count as unlinked, at the work centre's standard rate.
  - Entries lock with the employee's posted run line; an employee left off a run (on hold) keeps editable, provisional hours for that month.
  - Jobs completed before job costing keep their standard-rate labour (status STANDARD); they are not re-costed.
  - Work order lists return `labour: null`; the breakdown is computed on the detail view only.
  - Timesheet approval workflow, employee self-entry and non-work-order jobs are not supported.
  - Every labour writer takes the per-tenant `job-costing` advisory lock: fine at SME volumes, a contention point for very busy floors.
- [ ] **Step 2: Verify** — `corepack pnpm --filter @saas/shared build && corepack pnpm --filter @saas/shared test && corepack pnpm --filter api test && corepack pnpm --filter api build && corepack pnpm --filter web exec tsc --noEmit && corepack pnpm --filter web test` (the `drawers.spec.tsx` failure is pre-existing on master). DB checks run in CI (`migration:run`, `check:drift`, `seed`, `check:books`).
- [ ] **Step 3: Commit** — `docs: flag job costing trade-offs`
