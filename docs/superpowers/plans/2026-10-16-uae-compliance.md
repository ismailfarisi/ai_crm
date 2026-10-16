# UAE Payroll Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave records and balances that feed payroll and a leave salary provision, GPSSA/ADPF pension for nationals with monthly remittance, a final-settlement document that pays out the gratuity and leave provisions, and a MOHRE-format WPS salary file per run and per settlement.

**Architecture:** All arithmetic (leave accrual, sick/maternity pay split, pension contribution, settlement figures, SIF formatting) is pure code in `packages/shared/src/payroll/` with vitest tests. The API extends the existing `PayrollModule` (`apps/api/src/modules/payroll/`) with one migration, seven new entities and new services (`PayrollSettingsService`, `PensionService`, `LeaveService`, `LeaveRecordsService`, `PensionRemittanceService`, `SettlementsService`, `WpsExportService`); leave and pension postings join the existing approval journal inside the same transaction and the same per-tenant advisory lock (`lockGratuityOpening`). The web app extends the People section (employee tabs, run detail, new Settlements and Payroll settings pages).

**Tech Stack:** NestJS 11, TypeORM 1, Postgres 18 (FORCE RLS), zod 4, vitest (shared), jest (api), Next.js 16 + TanStack Query + react-hook-form (web).

**Spec:** `docs/superpowers/specs/2026-10-16-uae-compliance-design.md`

## Global Constraints

- Branch `feat/uae-compliance`, stacked on `feat/employees-payroll` (PR #19). It builds on that branch's payroll module, the gratuity ledger and `lockGratuityOpening`.
- Use `corepack pnpm` (pnpm is not on PATH). After editing `packages/shared`, run `corepack pnpm --filter @saas/shared build` before api/web tests.
- No database locally: the migration is hand-written to mirror entity decorators exactly (names, case, types, defaults, index names); CI's schema job runs `migration:run`, `check:drift`, `seed`, `check:books`. Read `scripts/check-drift.mjs` and `1790000000000-EmployeesAndPayroll.ts` before writing the migration.
- Permissions only from `PERMISSIONS` constants; no new permission constants in this sub-project. Services re-check `actor.permissions` for approve/void/pay like `PayrollPostingService.assertCanApprove`.
- Every query tenant-scoped; new tables `ENABLE` + `FORCE ROW LEVEL SECURITY` with the policy loop from `1790000000000-EmployeesAndPayroll.ts` (bottom of `up()`); tenant-data statements after `SELECT set_config('app.bypass_rls','on',true)`.
- Ledger append-only; every posting balanced; corrections post exact reversals dated `max(today, original entry date)`.
- Money `numeric(14,2)` rounded with `round2`; base currency only; WPS files are AED only.
- Daily rate ÷ 30. Half pay = gross ÷ 30 × 0.5 per day. Leave encashment = days × basic ÷ 30. Notice pay = days × gross ÷ 30.
- Annual leave (calendar days): 0 under 6 months of service; 2 days per completed month from 6 to 12 months; `annualDays × serviceDays ÷ 365` from 12 months. `annualDays` = employee override ?? tenant `annualLeaveDays` (default 30, allowed 30..60). Service excludes unpaid days.
- Sick leave per service year (joining anniversary to anniversary), after probation: first 15 days full pay, next 30 half pay, next 45 unpaid; sick days on or before `probationEndDate` are unpaid. Maternity per record: 45 days full, 15 half, rest unpaid.
- Pension base: BASIC → basic; BASIC_HOUSING → basic + housing; GROSS → package gross; clamped to [min, max]; prorated by days employed ÷ days in month; unpaid leave does not reduce it.
- Gratuity at settlement: statutory entitlement at the leaving date, **zero when service < 365 days**, plus Σ gratuity ADJUSTMENT amounts.
- Run state lives in posted runs: `POSTED_RUN_STATUSES` from `advances.service.ts` (`APPROVED`, `PARTIALLY_PAID`, `PAID`).
- Never save a whole row read earlier in a transaction where another writer may have changed it; update only the columns the operation owns (pattern: `PayrollRunsService.saveTotals`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the committing model's name).

## Review Focus

1. **Leave recorded, edited or deleted after a draft run already exists** → the draft's line for that employee is re-filled from records (unless its leave was overridden) and the run totals move, so nobody approves stale sick or unpaid days. Test: Task 8 "refills the draft line when a leave record changes".
2. **Sick leave that spans a service-year anniversary and a month boundary** → days before the anniversary use the old year's bands, days after start at full pay again, and each month gets only its own days. Test: Task 2 "sick leave across the service-year anniversary".
3. **A settlement drafted, then a gratuity adjustment or leave adjustment posted for the leaver** → approval refuses with "refresh it" instead of posting stale figures. Test: Task 13 "refuses to approve a stale settlement".
4. **A national given a pension scheme after the draft was created, or whose scheme was deactivated** → approval applies the employee's current active scheme to the line; a deactivated or missing scheme refuses approval naming the employee. Test: Task 11 "approval applies the current scheme" and "refuses a national whose scheme is inactive".
5. **Voiding a run whose month's pension is remitted, or whose leaver is already settled** → 409 naming the remittance or settlement to void first. Test: Task 11 "void refused while remitted / while settled".

---

## File Structure

**Shared (`packages/shared/src/`)**
- Modify `finance/ledger.ts` (4 accounts, 4 roles, `'SETTLEMENT'` and `'PENSION_REMITTANCE'` reference types), `finance/types.ts` (`CashForecastMonthDto.pensionOut`), `payroll/calc.ts` (half pay and employee pension in `computeLine`), `payroll/types.ts` (line, totals, employee DTO fields; `GratuityEntryKind` gains `SETTLEMENT`), `schemas/payroll.ts` (employee and line fields), `platform/attachments.ts` (`'LEAVE_RECORD'` — in Task 5, with its API mapping).
- Create `payroll/leave.ts`, `payroll/pension.ts`, `payroll/settlement.ts`, `payroll/wps.ts`, `payroll/compliance-types.ts`, `schemas/payroll-compliance.ts` (+ tests); export from `index.ts`.

**API (`apps/api/src/`)**
- Create `database/migrations/1790100000000-UaeCompliance.ts`, `database/uae-compliance-migration.spec.ts`.
- Modify `database/tenant-sequence.util.ts` (`'settlement_number'`), `modules/finance/entities/journal-entry.entity.ts` (enum), `modules/storage/attachment-owners.ts`, `modules/audit/audit-subjects.ts`, `modules/finance/finance.service.ts` + `finance.module.ts`, `database/seeds/run-seed.ts`.
- Create in `modules/payroll/`: `entities/payroll-settings.entity.ts`, `entities/pension-scheme.entity.ts`, `entities/leave-record.entity.ts`, `entities/leave-ledger-entry.entity.ts`, `entities/pension-remittance.entity.ts`, `entities/settlement.entity.ts` (`Settlement`, `SettlementLine`); `payroll-settings.service.ts`, `pension.service.ts`, `leave.service.ts`, `leave-records.service.ts`, `leave.controller.ts`, `pension-remittance.service.ts`, `payroll-compliance.controller.ts`, `settlements.service.ts`, `settlements.controller.ts`, `wps-export.service.ts`; specs beside each.
- Modify in `modules/payroll/`: `entities/employee.entity.ts`, `entities/payroll-run.entity.ts`, `entities/gratuity-ledger-entry.entity.ts`, `employees.service.ts`, `payroll-runs.service.ts`, `payroll-posting.service.ts`, `payroll-runs.controller.ts`, `payroll.controller.ts`, `advances.service.ts`, `gratuity.service.ts`, `payroll.module.ts`.

**Web (`apps/web/src/`)**
- Modify `lib/api/endpoints/payroll.ts`, `hooks/use-payroll.ts`, `components/people/people-nav.tsx`, `employee-detail.tsx`, `employee-form-modal.tsx`, `payroll-run-detail.tsx`, `payroll-line-editor.tsx`, `payroll-runs-view.tsx`, `components/finance/dashboard/cash-forecast-chart.tsx`.
- Create pages `app/(app)/people/settlements/page.tsx`, `.../[id]/page.tsx`, `.../[id]/statement/page.tsx`, `app/(app)/people/settings/page.tsx`, `app/(app)/people/payroll/opening-leave/page.tsx`; components `employee-leave-tab.tsx`, `leave-record-modal.tsx`, `employee-pension-tab.tsx`, `payroll-settings-view.tsx`, `pension-panel.tsx`, `opening-leave-view.tsx`, `settlements-view.tsx`, `settlement-detail.tsx`, `settlement-statement.tsx`, `download-sif.ts`.

**Docs:** `docs/FLAGS.md`.

---

### Task 1: Shared — ledger accounts, roles, reference types, gratuity kind

**Files:**
- Modify: `packages/shared/src/finance/ledger.ts`, `packages/shared/src/payroll/types.ts`
- Test: `packages/shared/src/finance/ledger.test.ts`

**Interfaces:**
- Produces: `LEDGER_ROLES.{LEAVE_PROVISION, PENSION_PAYABLE, LEAVE_EXPENSE, PENSION_EXPENSE}`; accounts 2410, 2420, 6320, 6330; `JournalReferenceType` includes `'SETTLEMENT' | 'PENSION_REMITTANCE'`; `GratuityEntryKind` includes `'SETTLEMENT'`.

- [ ] **Step 1: Failing test** — append to `ledger.test.ts` (inside the top-level `describe`, matching the existing payroll test):

```ts
it('adds the compliance accounts with the right types and parents', () => {
  const byCode = new Map(SYSTEM_LEDGER_ACCOUNTS.map((a) => [a.code, a]));
  expect(byCode.get('2410')).toMatchObject({ type: 'LIABILITY', role: 'LEAVE_PROVISION' });
  expect(byCode.get('2420')).toMatchObject({ type: 'LIABILITY', role: 'PENSION_PAYABLE' });
  expect(byCode.get('6320')).toMatchObject({ type: 'EXPENSE', role: 'LEAVE_EXPENSE', parentCode: '6000' });
  expect(byCode.get('6330')).toMatchObject({ type: 'EXPENSE', role: 'PENSION_EXPENSE', parentCode: '6000' });
  expect(OPERATING_EXPENSE_CHILD_ROLES).toEqual(expect.arrayContaining(['LEAVE_EXPENSE', 'PENSION_EXPENSE']));
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/finance/ledger.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `ledger.ts` add after `GRATUITY_EXPENSE: 'GRATUITY_EXPENSE',`:

```ts
  LEAVE_PROVISION: 'LEAVE_PROVISION',
  PENSION_PAYABLE: 'PENSION_PAYABLE',
  LEAVE_EXPENSE: 'LEAVE_EXPENSE',
  PENSION_EXPENSE: 'PENSION_EXPENSE',
```

Accounts, in code order (2410 and 2420 right after the 2400 line; 6320 and 6330 right after the 6310 line):

```ts
  { code: '2410', name: 'Leave salary provision', type: 'LIABILITY', role: LEDGER_ROLES.LEAVE_PROVISION, description: 'Annual leave earned by employees and not yet taken or paid out' },
  { code: '2420', name: 'Pension contributions payable', type: 'LIABILITY', role: LEDGER_ROLES.PENSION_PAYABLE, description: 'Employee and employer pension contributions not yet remitted to the fund' },
```

```ts
  { code: '6320', name: 'Leave salary expense', type: 'EXPENSE', role: LEDGER_ROLES.LEAVE_EXPENSE, parentCode: '6000', description: 'Monthly change in the leave salary provision' },
  { code: '6330', name: 'Employer pension contribution', type: 'EXPENSE', role: LEDGER_ROLES.PENSION_EXPENSE, parentCode: '6000', description: "The employer's share of nationals' pension contributions" },
```

Extend `JournalReferenceType` with `| 'SETTLEMENT' | 'PENSION_REMITTANCE'`. In `payroll/types.ts` change to `export type GratuityEntryKind = 'OPENING' | 'ACCRUAL' | 'ADJUSTMENT' | 'REVERSAL' | 'SETTLEMENT';` and in `apps/api/src/modules/payroll/entities/gratuity-ledger-entry.entity.ts` simplify `kind: GratuityEntryKind | 'SETTLEMENT'` to `kind: GratuityEntryKind` (and drop "reserved" from its doc comment).

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build && corepack pnpm --filter api build` → PASS (the existing invariants — unique codes/roles, parent before child, 6000 children — must still pass).

- [ ] **Step 5: Commit** — `git add packages/shared/src apps/api/src/modules/payroll/entities/gratuity-ledger-entry.entity.ts && git commit -m "feat(shared): leave provision and pension accounts, settlement reference types"`

---

### Task 2: Shared — leave maths

**Files:**
- Create: `packages/shared/src/payroll/leave.ts`, `packages/shared/src/payroll/leave.test.ts`
- Modify: `packages/shared/src/index.ts` (`export * from './payroll/leave';` after `./payroll/gratuity`)

**Interfaces:**
- Produces:
  - `type LeaveType = 'ANNUAL' | 'SICK' | 'UNPAID' | 'MATERNITY' | 'OTHER_PAID'`; `LEAVE_TYPES: readonly LeaveType[]`
  - `interface LeaveRecordInput { type: LeaveType; startDate: string; endDate: string; days: number }`
  - `leaveServiceDays(a: { joiningDate: string; asOf: string; unpaidDays: number }): number`
  - `leaveAccrued(a: { serviceDays: number; annualDays: number }): number`
  - `interface PeriodLeave { annualDays: number; sickFullDays: number; halfPayDays: number; unpaidDays: number; otherPaidDays: number; leaveDays: number }`
  - `leaveForPeriod(a: { records: LeaveRecordInput[]; joiningDate: string; probationEndDate: string | null; leavingDate: string | null; period: string }): PeriodLeave`
  - `sickDaysByServiceYear(a: { records: LeaveRecordInput[]; joiningDate: string; probationEndDate: string | null }): Map<number, number>`
  - `recordPeriods(r: { startDate: string; endDate: string }): string[]` — every `YYYY-MM` the record touches.

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/payroll/leave.test.ts
import { describe, expect, it } from 'vitest';
import { leaveAccrued, leaveForPeriod, leaveServiceDays, recordPeriods, sickDaysByServiceYear, type LeaveRecordInput } from './leave';

describe('leaveAccrued', () => {
  const at = (serviceDays: number) => leaveAccrued({ serviceDays, annualDays: 30 });
  it('nothing under six months', () => expect(at(152)).toBe(0));
  it('two days per completed month from six months', () => expect(at(229)).toBe(14)); // 7.5 months
  it('eleven months', () => expect(at(335)).toBe(22));
  it('a full year jumps to the annual entitlement', () => expect(at(365)).toBe(30));
  it('pro rata after the first year', () => expect(at(1085)).toBe(89.18)); // 3 years less 10 unpaid days
  it('uses the annual override', () => expect(leaveAccrued({ serviceDays: 730, annualDays: 45 })).toBe(90));
});

describe('leaveServiceDays', () => {
  it('excludes unpaid days', () => expect(leaveServiceDays({ joiningDate: '2026-01-01', asOf: '2026-01-31', unpaidDays: 3 })).toBe(28));
  it('never negative', () => expect(leaveServiceDays({ joiningDate: '2026-01-01', asOf: '2026-01-02', unpaidDays: 5 })).toBe(0));
});

const rec = (type: LeaveRecordInput['type'], startDate: string, endDate: string, days?: number): LeaveRecordInput => {
  const cal = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
  return { type, startDate, endDate, days: days ?? cal };
};
const base = { joiningDate: '2020-01-15', probationEndDate: null, leavingDate: null };

describe('leaveForPeriod', () => {
  it('a record spanning two months counts in each', () => {
    const records = [rec('ANNUAL', '2026-09-28', '2026-10-03')];
    expect(leaveForPeriod({ ...base, records, period: '2026-09' }).annualDays).toBe(3);
    expect(leaveForPeriod({ ...base, records, period: '2026-10' }).annualDays).toBe(3);
  });

  it('an edited-down record is spread evenly over its dates', () => {
    const r = leaveForPeriod({ ...base, records: [rec('ANNUAL', '2026-10-01', '2026-10-04', 2)], period: '2026-10' });
    expect(r.annualDays).toBe(2);
    expect(r.leaveDays).toBe(2);
  });

  it('sick leave: 15 full, then half, counted across the service year', () => {
    const records = [rec('SICK', '2026-02-01', '2026-02-10'), rec('SICK', '2026-10-01', '2026-10-20')];
    const r = leaveForPeriod({ ...base, records, period: '2026-10' });
    expect(r.sickFullDays).toBe(5);
    expect(r.halfPayDays).toBe(15);
    expect(r.unpaidDays).toBe(0);
    expect(r.leaveDays).toBe(20);
  });

  it('sick leave across the service-year anniversary', () => {
    // Service years start on 15 October. 45 days already used in the year to 14 Oct 2026.
    const records = [rec('SICK', '2026-03-01', '2026-04-14'), rec('SICK', '2026-10-10', '2026-10-20')];
    const r = leaveForPeriod({ ...base, joiningDate: '2020-10-15', records, period: '2026-10' });
    expect(r.unpaidDays).toBe(5); // 10–14 Oct: beyond 45 in the old year
    expect(r.sickFullDays).toBe(6); // 15–20 Oct: a new year, full pay again
    expect(r.halfPayDays).toBe(0);
  });

  it('sick days during probation are unpaid', () => {
    const r = leaveForPeriod({ ...base, joiningDate: '2026-08-01', probationEndDate: '2026-10-05', records: [rec('SICK', '2026-10-03', '2026-10-07')], period: '2026-10' });
    expect(r.unpaidDays).toBe(3);
    expect(r.sickFullDays).toBe(2);
  });

  it('maternity: 45 full, 15 half, then unpaid, counted per record', () => {
    const records = [rec('MATERNITY', '2026-09-01', '2026-11-15')];
    const oct = leaveForPeriod({ ...base, records, period: '2026-10' });
    expect(oct.otherPaidDays).toBe(15); // units 31..45
    expect(oct.halfPayDays).toBe(15); // units 46..60
    expect(oct.unpaidDays).toBe(1); // unit 61
  });

  it('unpaid and other paid leave', () => {
    const r = leaveForPeriod({ ...base, records: [rec('UNPAID', '2026-10-05', '2026-10-06'), rec('OTHER_PAID', '2026-10-10', '2026-10-12')], period: '2026-10' });
    expect(r.unpaidDays).toBe(2);
    expect(r.otherPaidDays).toBe(3);
    expect(r.leaveDays).toBe(5);
  });

  it('stops at the leaving date', () => {
    const r = leaveForPeriod({ ...base, leavingDate: '2026-10-10', records: [rec('ANNUAL', '2026-10-08', '2026-10-14')], period: '2026-10' });
    expect(r.annualDays).toBe(3);
  });
});

describe('sickDaysByServiceYear', () => {
  it('counts post-probation sick days per service year', () => {
    const m = sickDaysByServiceYear({ joiningDate: '2020-10-15', probationEndDate: null, records: [rec('SICK', '2026-10-10', '2026-10-20')] });
    expect(m.get(5)).toBe(5);
    expect(m.get(6)).toBe(6);
  });
});

describe('recordPeriods', () => {
  it('lists every month touched', () => expect(recordPeriods({ startDate: '2026-09-28', endDate: '2026-11-02' })).toEqual(['2026-09', '2026-10', '2026-11']));
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/payroll/leave.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/payroll/leave.ts
import { daysBetweenInclusive, periodBounds, round2 } from './calc';

/**
 * Leave arithmetic (UAE Labour Law, calendar days). Pure: the API feeds it
 * records and dates, and stores what it returns.
 */
export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'OTHER_PAID'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export interface LeaveRecordInput {
  type: LeaveType;
  startDate: string;
  endDate: string;
  /** Calendar days, or fewer when HR edited it down (half days). */
  days: number;
}

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);

/** Days of service to `asOf`, inclusive, less unpaid days. */
export function leaveServiceDays(a: { joiningDate: string; asOf: string; unpaidDays: number }): number {
  return Math.max(0, daysBetweenInclusive(a.joiningDate, a.asOf) - a.unpaidDays);
}

/**
 * Annual leave earned to date: nothing in the first six months, two days per
 * completed month until the first anniversary, then the annual entitlement
 * pro rata.
 */
export function leaveAccrued(a: { serviceDays: number; annualDays: number }): number {
  const months = (a.serviceDays * 12) / 365;
  if (months < 6) return 0;
  if (months < 12) return 2 * Math.floor(months);
  return round2((a.annualDays * a.serviceDays) / 365);
}

interface Unit {
  date: string;
  weight: number;
}

/** One unit per calendar day, each weighing days ÷ calendar days. */
function unitsOf(r: LeaveRecordInput): Unit[] {
  const calendar = daysBetweenInclusive(r.startDate, r.endDate);
  if (calendar <= 0) return [];
  const weight = r.days / calendar;
  return Array.from({ length: calendar }, (_, i) => ({ date: addDays(r.startDate, i), weight }));
}

/** Completed years of service at `date` (0 in the first year). */
function serviceYear(joiningDate: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(joiningDate.slice(0, 4));
  return date.slice(5, 10) >= joiningDate.slice(5, 10) ? years : years - 1;
}

/** Splits `weight` days, `used` already taken, into full / half / unpaid bands. */
function split(used: number, weight: number, fullCap: number, halfCap: number) {
  const full = Math.max(0, Math.min(weight, fullCap - used));
  const half = Math.max(0, Math.min(weight - full, fullCap + halfCap - Math.max(used, fullCap)));
  return { full, half, unpaid: weight - full - half };
}

export interface PeriodLeave {
  annualDays: number;
  /** Sick days at full pay. */
  sickFullDays: number;
  /** Sick and maternity days at half pay. */
  halfPayDays: number;
  /** UNPAID records, sick beyond 45 days or in probation, maternity beyond 60. */
  unpaidDays: number;
  /** OTHER_PAID records and maternity at full pay. */
  otherPaidDays: number;
  /** Every leave day in the period, for the WPS file. */
  leaveDays: number;
}

/**
 * What an employee's leave records mean for one month's pay. Sick days are
 * banded across the whole service year (records before the month count
 * towards the 15 / 30 / 45), maternity within its own record.
 */
export function leaveForPeriod(a: {
  records: LeaveRecordInput[];
  joiningDate: string;
  probationEndDate: string | null;
  leavingDate: string | null;
  period: string;
}): PeriodLeave {
  const { first, last } = periodBounds(a.period);
  const from = a.joiningDate > first ? a.joiningDate : first;
  const to = a.leavingDate && a.leavingDate < last ? a.leavingDate : last;
  const inRange = (d: string) => d >= from && d <= to;
  const out: PeriodLeave = { annualDays: 0, sickFullDays: 0, halfPayDays: 0, unpaidDays: 0, otherPaidDays: 0, leaveDays: 0 };

  for (const r of a.records) {
    if (r.type === 'SICK' || r.type === 'MATERNITY') continue;
    for (const u of unitsOf(r)) {
      if (!inRange(u.date)) continue;
      out.leaveDays += u.weight;
      if (r.type === 'ANNUAL') out.annualDays += u.weight;
      else if (r.type === 'UNPAID') out.unpaidDays += u.weight;
      else out.otherPaidDays += u.weight;
    }
  }

  const sick = a.records
    .filter((r) => r.type === 'SICK')
    .flatMap(unitsOf)
    .sort((x, y) => x.date.localeCompare(y.date));
  const used = new Map<number, number>();
  for (const u of sick) {
    let band = { full: 0, half: 0, unpaid: u.weight };
    if (!(a.probationEndDate && u.date <= a.probationEndDate)) {
      const year = serviceYear(a.joiningDate, u.date);
      const before = used.get(year) ?? 0;
      band = split(before, u.weight, 15, 30);
      used.set(year, before + u.weight);
    }
    if (!inRange(u.date)) continue;
    out.leaveDays += u.weight;
    out.sickFullDays += band.full;
    out.halfPayDays += band.half;
    out.unpaidDays += band.unpaid;
  }

  for (const r of a.records.filter((x) => x.type === 'MATERNITY')) {
    let before = 0;
    for (const u of unitsOf(r)) {
      const band = split(before, u.weight, 45, 15);
      before += u.weight;
      if (!inRange(u.date)) continue;
      out.leaveDays += u.weight;
      out.otherPaidDays += band.full;
      out.halfPayDays += band.half;
      out.unpaidDays += band.unpaid;
    }
  }

  return {
    annualDays: round2(out.annualDays),
    sickFullDays: round2(out.sickFullDays),
    halfPayDays: round2(out.halfPayDays),
    unpaidDays: round2(out.unpaidDays),
    otherPaidDays: round2(out.otherPaidDays),
    leaveDays: round2(out.leaveDays),
  };
}

/** Post-probation sick days per service year (0 = the first year), for the 90-day limit. */
export function sickDaysByServiceYear(a: {
  records: LeaveRecordInput[];
  joiningDate: string;
  probationEndDate: string | null;
}): Map<number, number> {
  const m = new Map<number, number>();
  for (const u of a.records.filter((r) => r.type === 'SICK').flatMap(unitsOf)) {
    if (a.probationEndDate && u.date <= a.probationEndDate) continue;
    const y = serviceYear(a.joiningDate, u.date);
    m.set(y, round2((m.get(y) ?? 0) + u.weight));
  }
  return m;
}

/** Every 'YYYY-MM' a date range touches. */
export function recordPeriods(r: { startDate: string; endDate: string }): string[] {
  const out: string[] = [];
  let cursor = `${r.startDate.slice(0, 7)}-01`;
  while (cursor.slice(0, 7) <= r.endDate.slice(0, 7)) {
    out.push(cursor.slice(0, 7));
    const [y, m] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  return out;
}
```

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/payroll/leave.test.ts` → PASS; then `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build`.

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): statutory leave accrual and sick/maternity pay split"`

---

### Task 3: Shared — pension, half pay and pension on the line, settlement figures

**Files:**
- Create: `packages/shared/src/payroll/pension.ts`, `pension.test.ts`, `packages/shared/src/payroll/settlement.ts`, `settlement.test.ts`
- Modify: `packages/shared/src/payroll/calc.ts`, `calc.test.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type PensionBase = 'BASIC' | 'BASIC_HOUSING' | 'GROSS'`; `interface PensionRates { employeePct: number; employerPct: number; base: PensionBase; minSalary: number | null; maxSalary: number | null }`
  - `pensionContribution(a: { rates: PensionRates; basic: number; housing: number; gross: number; daysEmployed: number; daysInMonth: number }): { base: number; employee: number; employer: number }`
  - `PENSION_SCHEME_PRESETS: { key: string; name: string; rates: PensionRates }[]` (the four presets from the spec, keys `GPSSA_2023`, `GPSSA_LEGACY`, `ADPF_NEW`, `ADPF_IN_SERVICE`)
  - `LineInput` gains optional `halfPayDays?: number` and `pensionEmployee?: number`; `LineAmounts` gains `halfPayAmount: number`.
  - `settlementGratuity(a: { serviceDays: number; statutory: number; adjustments: number }): number`
  - `leaveEncashment(a: { days: number; basic: number }): number`
  - `noticePay(a: { days: number; gross: number; direction: 'PAY' | 'DEDUCT' }): number`

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/payroll/pension.test.ts
import { describe, expect, it } from 'vitest';
import { PENSION_SCHEME_PRESETS, pensionContribution, type PensionRates } from './pension';

const gpssa: PensionRates = { employeePct: 11, employerPct: 15, base: 'GROSS', minSalary: 3000, maxSalary: 70000 };
const full = { basic: 7000, housing: 2100, gross: 9800, daysEmployed: 31, daysInMonth: 31 };

describe('pensionContribution', () => {
  it('a full month on gross', () => expect(pensionContribution({ rates: gpssa, ...full })).toEqual({ base: 9800, employee: 1078, employer: 1470 }));
  it('clamps up to the minimum', () => expect(pensionContribution({ rates: gpssa, ...full, gross: 2500 })).toEqual({ base: 3000, employee: 330, employer: 450 }));
  it('clamps down to the maximum', () => expect(pensionContribution({ rates: gpssa, ...full, gross: 80000 }).base).toBe(70000));
  it('prorates by days employed', () => expect(pensionContribution({ rates: gpssa, ...full, daysEmployed: 15, daysInMonth: 30 }).base).toBe(4900));
  it('basic + housing base', () => expect(pensionContribution({ rates: { ...gpssa, base: 'BASIC_HOUSING' }, ...full }).base).toBe(9100));
  it('basic base with no caps', () => expect(pensionContribution({ rates: { ...gpssa, base: 'BASIC', minSalary: null, maxSalary: null }, ...full }).base).toBe(7000));
});

describe('presets', () => {
  it('ships the four schemes', () => {
    expect(PENSION_SCHEME_PRESETS.map((p) => p.key)).toEqual(['GPSSA_2023', 'GPSSA_LEGACY', 'ADPF_NEW', 'ADPF_IN_SERVICE']);
    expect(PENSION_SCHEME_PRESETS[0].rates).toEqual(gpssa);
  });
});
```

```ts
// packages/shared/src/payroll/settlement.test.ts
import { describe, expect, it } from 'vitest';
import { leaveEncashment, noticePay, settlementGratuity } from './settlement';

describe('settlement figures', () => {
  it('no gratuity under a year of service', () => expect(settlementGratuity({ serviceDays: 364, statutory: 5000, adjustments: 0 })).toBe(0));
  it('statutory plus adjustments from a year', () => expect(settlementGratuity({ serviceDays: 365, statutory: 5000, adjustments: 250 })).toBe(5250));
  it('adjustments still apply under a year', () => expect(settlementGratuity({ serviceDays: 200, statutory: 3000, adjustments: 100 })).toBe(100));
  it('encashes leave on basic ÷ 30', () => expect(leaveEncashment({ days: 12.5, basic: 6000 })).toBe(2500));
  it('a negative balance is a deduction', () => expect(leaveEncashment({ days: -3, basic: 6000 })).toBe(-600));
  it('notice pay on gross ÷ 30, paid or deducted', () => {
    expect(noticePay({ days: 30, gross: 9000, direction: 'PAY' })).toBe(9000);
    expect(noticePay({ days: 10, gross: 9000, direction: 'DEDUCT' })).toBe(-3000);
  });
});
```

Change the first `computeLine` test in `calc.test.ts` to expect `halfPayAmount: 0` in the object, and append:

```ts
  it('half pay days cost half a day each, on gross ÷ 30', () => {
    const r = computeLine({ ...base, halfPayDays: 4 });
    expect(r.halfPayAmount).toBe(600);
    expect(r.salaryCost).toBe(8400);
  });

  it('employee pension reduces net pay, not salary cost', () => {
    const r = computeLine({ ...base, pensionEmployee: 990 });
    expect(r.salaryCost).toBe(9000);
    expect(r.netPay).toBe(8010);
  });
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/payroll` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/payroll/pension.ts
import { round2 } from './calc';

export type PensionBase = 'BASIC' | 'BASIC_HOUSING' | 'GROSS';
export const PENSION_BASES: readonly PensionBase[] = ['BASIC', 'BASIC_HOUSING', 'GROSS'];

export interface PensionRates {
  employeePct: number;
  employerPct: number;
  base: PensionBase;
  minSalary: number | null;
  maxSalary: number | null;
}

/**
 * A national's monthly contribution. The base follows the contract salary
 * (unpaid leave does not reduce it), clamped to the fund's bounds and
 * prorated by days employed.
 */
export function pensionContribution(a: {
  rates: PensionRates;
  basic: number;
  housing: number;
  gross: number;
  daysEmployed: number;
  daysInMonth: number;
}): { base: number; employee: number; employer: number } {
  const contract = a.rates.base === 'BASIC' ? a.basic : a.rates.base === 'BASIC_HOUSING' ? a.basic + a.housing : a.gross;
  const clamped = Math.min(Math.max(contract, a.rates.minSalary ?? 0), a.rates.maxSalary ?? Infinity);
  const base = round2((clamped * a.daysEmployed) / a.daysInMonth);
  return {
    base,
    employee: round2((base * a.rates.employeePct) / 100),
    employer: round2((base * a.rates.employerPct) / 100),
  };
}

/**
 * Starting points a tenant confirms before use: rates change, and the API
 * creates these inactive.
 */
export const PENSION_SCHEME_PRESETS: { key: string; name: string; rates: PensionRates }[] = [
  { key: 'GPSSA_2023', name: 'GPSSA (joined from 31 Oct 2023)', rates: { employeePct: 11, employerPct: 15, base: 'GROSS', minSalary: 3000, maxSalary: 70000 } },
  { key: 'GPSSA_LEGACY', name: 'GPSSA (legacy, joined earlier)', rates: { employeePct: 5, employerPct: 12.5, base: 'GROSS', minSalary: 3000, maxSalary: 70000 } },
  { key: 'ADPF_NEW', name: 'ADPF (new member, from 1 Dec 2023)', rates: { employeePct: 11, employerPct: 15, base: 'GROSS', minSalary: null, maxSalary: 100000 } },
  { key: 'ADPF_IN_SERVICE', name: 'ADPF (in-service member)', rates: { employeePct: 5, employerPct: 15, base: 'GROSS', minSalary: null, maxSalary: null } },
];
```

```ts
// packages/shared/src/payroll/settlement.ts
import { round2 } from './calc';

/** Nothing is payable under a year of service (Decree-Law 33/2021); adjustments always apply. */
export function settlementGratuity(a: { serviceDays: number; statutory: number; adjustments: number }): number {
  return round2((a.serviceDays < 365 ? 0 : a.statutory) + a.adjustments);
}

/** Untaken leave on basic ÷ 30; a negative balance (leave taken in advance) is a deduction. */
export function leaveEncashment(a: { days: number; basic: number }): number {
  return round2((a.days * a.basic) / 30);
}

/** Notice pay in lieu on gross ÷ 30: paid to the employee, or deducted when they did not serve it. */
export function noticePay(a: { days: number; gross: number; direction: 'PAY' | 'DEDUCT' }): number {
  const amount = round2((a.days * a.gross) / 30);
  return a.direction === 'PAY' ? amount : -amount;
}
```

In `calc.ts`: add to `LineInput`:

```ts
  /** Sick or maternity days at half pay. */
  halfPayDays?: number;
  /** A national's pension share, deducted from net pay. */
  pensionEmployee?: number;
```

add `halfPayAmount: number;` to `LineAmounts`, and replace `computeLine`'s body:

```ts
export function computeLine(i: LineInput): LineAmounts {
  const proratedGross = round2((i.gross * i.daysEmployed) / i.daysInMonth);
  const hourly = i.basic / 30 / 8;
  const overtimeAmount = round2(hourly * (1.25 * i.overtimeHours + 1.5 * i.overtimeHoursPremium));
  const unpaidLeaveAmount = round2((i.gross / 30) * i.unpaidLeaveDays);
  const halfPayAmount = round2((i.gross / 30) * 0.5 * (i.halfPayDays ?? 0));
  const salaryCost = round2(proratedGross + overtimeAmount + i.bonusAmount - unpaidLeaveAmount - halfPayAmount);
  const netPay = round2(salaryCost - i.advanceRecovery - i.otherDeductionAmount - (i.pensionEmployee ?? 0));
  return { proratedGross, overtimeAmount, unpaidLeaveAmount, halfPayAmount, netPay, salaryCost };
}
```

Export both new files from `index.ts` after `./payroll/leave`.

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build && corepack pnpm --filter api build` → PASS (the API ignores the new optional fields until Task 10).

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): pension contributions, half pay, settlement figures"`

---

### Task 4: Shared — WPS SIF formatter

**Files:**
- Create: `packages/shared/src/payroll/wps.ts`, `packages/shared/src/payroll/wps.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type WpsEmployerIdType = 'MOHRE' | 'FREE_ZONE'`
  - `interface SifEmployer { employerId: string; employerIdType: WpsEmployerIdType; payerRoutingCode: string }`
  - `interface SifRow { personId: string; routingCode: string; iban: string; payStart: string; payEnd: string; days: number; fixed: number; variable: number; leaveDays: number }`
  - `sifIncomeSplit(netPay: number, variable: number): { fixed: number; variable: number }`
  - `buildSif(a: { employer: SifEmployer; rows: SifRow[]; salaryMonth: string; createdAt: Date; reference: string }): { fileName: string; content: string }`

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/payroll/wps.test.ts
import { describe, expect, it } from 'vitest';
import { buildSif, sifIncomeSplit } from './wps';

const employer = { employerId: '1234567', employerIdType: 'MOHRE' as const, payerRoutingCode: '803320101' };
const row = { personId: '10000000000001', routingCode: '803320101', iban: 'AE070331234567890123450', payStart: '2026-10-01', payEnd: '2026-10-31', days: 31, fixed: 22000, variable: 312.5, leaveDays: 2 };

describe('buildSif', () => {
  it('writes the exact MOHRE layout', () => {
    const out = buildSif({ employer, rows: [row], salaryMonth: '2026-10', createdAt: new Date('2026-10-28T06:05:09Z'), reference: 'PR-2026-0007' });
    // UAE time is UTC+4 with no daylight saving.
    expect(out.fileName).toBe('0000001234567261028100509.SIF');
    expect(out.content).toBe(
      'EDR,10000000000001,803320101,AE070331234567890123450,2026-10-01,2026-10-31,31,22000.00,312.50,2\r\n' +
        'SCR,0000001234567,803320101,2026-10-28,1005,102026,1,22312.50,AED,PR-2026-0007\r\n',
    );
  });

  it('free-zone employer IDs are not padded', () => {
    const out = buildSif({ employer: { ...employer, employerIdType: 'FREE_ZONE', employerId: 'JAFZA-778' }, rows: [row], salaryMonth: '2026-10', createdAt: new Date('2026-10-28T06:05:09Z'), reference: 'R' });
    expect(out.fileName).toBe('JAFZA-778261028100509.SIF');
    expect(out.content.split('\r\n')[1].startsWith('SCR,JAFZA-778,')).toBe(true);
  });

  it('rounds fractional leave days', () => {
    const out = buildSif({ employer, rows: [{ ...row, leaveDays: 1.5 }], salaryMonth: '2026-10', createdAt: new Date('2026-10-28T06:05:09Z'), reference: 'R' });
    expect(out.content.split('\r\n')[0].endsWith(',2')).toBe(true);
  });
});

describe('sifIncomeSplit', () => {
  it('fixed is net less variable', () => expect(sifIncomeSplit(9000, 500)).toEqual({ fixed: 8500, variable: 500 }));
  it('when deductions swallow the fixed part, everything is variable', () => expect(sifIncomeSplit(300, 500)).toEqual({ fixed: 0, variable: 300 }));
});
```

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/payroll/wps.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/payroll/wps.ts
import { round2 } from './calc';

/**
 * The MOHRE Salary Information File: one EDR row per employee, one SCR
 * trailer. Agents (banks, exchange houses) accept this standard layout;
 * some add their own variations, which Kerf does not produce.
 */
export type WpsEmployerIdType = 'MOHRE' | 'FREE_ZONE';

export interface SifEmployer {
  employerId: string;
  employerIdType: WpsEmployerIdType;
  payerRoutingCode: string;
}

export interface SifRow {
  personId: string;
  routingCode: string;
  iban: string;
  payStart: string;
  payEnd: string;
  days: number;
  fixed: number;
  variable: number;
  leaveDays: number;
}

/** fixed + variable = net pay; overtime and bonus are the variable part. */
export function sifIncomeSplit(netPay: number, variable: number): { fixed: number; variable: number } {
  if (variable > netPay) return { fixed: 0, variable: round2(netPay) };
  return { fixed: round2(netPay - variable), variable: round2(variable) };
}

const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;
const two = (n: number) => String(n).padStart(2, '0');

export function buildSif(a: {
  employer: SifEmployer;
  rows: SifRow[];
  salaryMonth: string;
  createdAt: Date;
  reference: string;
}): { fileName: string; content: string } {
  const local = new Date(a.createdAt.getTime() + UAE_OFFSET_MS);
  const y = local.getUTCFullYear();
  const mo = two(local.getUTCMonth() + 1);
  const d = two(local.getUTCDate());
  const hh = two(local.getUTCHours());
  const mi = two(local.getUTCMinutes());
  const ss = two(local.getUTCSeconds());
  const employerId = a.employer.employerIdType === 'MOHRE' ? a.employer.employerId.padStart(13, '0') : a.employer.employerId;
  const [sy, sm] = a.salaryMonth.split('-');

  const lines = a.rows.map((r) =>
    ['EDR', r.personId, r.routingCode, r.iban, r.payStart, r.payEnd, String(r.days), r.fixed.toFixed(2), r.variable.toFixed(2), String(Math.round(r.leaveDays))].join(','),
  );
  const total = round2(a.rows.reduce((s, r) => s + r.fixed + r.variable, 0));
  lines.push(['SCR', employerId, a.employer.payerRoutingCode, `${y}-${mo}-${d}`, `${hh}${mi}`, `${sm}${sy}`, String(a.rows.length), total.toFixed(2), 'AED', a.reference].join(','));

  return {
    fileName: `${employerId}${String(y).slice(2)}${mo}${d}${hh}${mi}${ss}.SIF`,
    content: lines.map((l) => `${l}\r\n`).join(''),
  };
}
```

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build` → PASS.

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): WPS salary information file formatter"`

---

### Task 5: Shared — compliance schemas and DTOs

**Files:**
- Create: `packages/shared/src/schemas/payroll-compliance.ts`, `packages/shared/src/schemas/payroll-compliance.test.ts`, `packages/shared/src/payroll/compliance-types.ts`
- Modify: `packages/shared/src/schemas/payroll.ts` (employee fields, line fields), `packages/shared/src/schemas/payroll.test.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces schemas (each with `*Input` = `z.input` and `*Payload` = `z.output` types): `payrollSettingsSchema`, `createPensionSchemeSchema`, `updatePensionSchemeSchema`, `leaveRecordSchema`, `leaveAdjustmentSchema`, `openingLeavePreviewSchema`, `postOpeningLeaveSchema`, `remitPensionSchema`, `createSettlementSchema`, `updateSettlementSchema`, `paySettlementSchema`. Employee schemas gain `wpsPersonId`, `bankRoutingCode`, `pensionSchemeId`, `annualLeaveDaysOverride`, `probationEndDate`. `updatePayrollLineSchema` gains `halfPayDays` and `leaveOverridden` (only `false` accepted: "back to automatic").
- Produces DTOs in `compliance-types.ts` (exact shapes below).

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/schemas/payroll-compliance.test.ts
import { describe, expect, it } from 'vitest';
import { leaveRecordSchema, payrollSettingsSchema, postOpeningLeaveSchema, updateSettlementSchema, createPensionSchemeSchema } from './payroll-compliance';

describe('payrollSettingsSchema', () => {
  it('needs the employer and routing code when WPS is on', () => {
    expect(payrollSettingsSchema.safeParse({ wpsEnabled: true }).success).toBe(false);
    expect(payrollSettingsSchema.parse({ wpsEnabled: true, employerIdType: 'MOHRE', employerId: '1234567890123', payerRoutingCode: '803320101' }).annualLeaveDays).toBe(30);
  });
  it('a MOHRE ID is 13 digits', () => {
    expect(payrollSettingsSchema.safeParse({ wpsEnabled: true, employerIdType: 'MOHRE', employerId: '12AB', payerRoutingCode: '803320101' }).success).toBe(false);
  });
  it('WPS off needs nothing', () => expect(payrollSettingsSchema.parse({ wpsEnabled: false }).employerId).toBeNull());
  it('annual leave days 30..60', () => expect(payrollSettingsSchema.safeParse({ wpsEnabled: false, annualLeaveDays: 22 }).success).toBe(false));
});

describe('leaveRecordSchema', () => {
  it('defaults days to the calendar span', () => expect(leaveRecordSchema.parse({ type: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-05' }).days).toBe(5));
  it('refuses end before start', () => expect(leaveRecordSchema.safeParse({ type: 'SICK', startDate: '2026-10-05', endDate: '2026-10-01' }).success).toBe(false));
  it('refuses more days than the span', () => expect(leaveRecordSchema.safeParse({ type: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', days: 3 }).success).toBe(false));
  it('allows half days', () => expect(leaveRecordSchema.parse({ type: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-01', days: 0.5 }).days).toBe(0.5));
});

describe('createPensionSchemeSchema', () => {
  it('min salary cannot exceed max', () => expect(createPensionSchemeSchema.safeParse({ name: 'X', employeePct: 5, employerPct: 15, base: 'GROSS', minSalary: 5000, maxSalary: 1000 }).success).toBe(false));
});

describe('postOpeningLeaveSchema', () => {
  it('accepts a negative balance (leave taken in advance)', () => {
    expect(postOpeningLeaveSchema.parse({ cutoverDate: '2026-09-30', lines: [{ employeeId: '6f1c2c1e-0000-4000-8000-000000000001', balanceDays: -2 }] }).lines[0].balanceDays).toBe(-2);
  });
});

describe('updateSettlementSchema', () => {
  it('manual lines need a positive amount and a label', () => {
    expect(updateSettlementSchema.safeParse({ manualLines: [{ kind: 'ADDITION', label: '', amount: 10 }] }).success).toBe(false);
    expect(updateSettlementSchema.parse({ manualLines: [{ kind: 'DEDUCTION', label: 'Damages', amount: 250 }] }).manualLines?.[0].amount).toBe(250);
  });
});
```

Append to `schemas/payroll.test.ts`:

```ts
describe('employee compliance fields', () => {
  const base = { firstName: 'A', lastName: 'B', joiningDate: '2024-01-01', paymentMethod: 'CASH' as const };
  it('validates WPS person ID and routing code', () => {
    expect(createEmployeeSchema.safeParse({ ...base, wpsPersonId: '123' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, bankRoutingCode: '12345' }).success).toBe(false);
    const ok = createEmployeeSchema.parse({ ...base, wpsPersonId: '10000000000001', bankRoutingCode: '803320101', probationEndDate: '2024-06-30' });
    expect(ok.wpsPersonId).toBe('10000000000001');
    expect(ok.pensionSchemeId).toBeNull();
    expect(ok.annualLeaveDaysOverride).toBeNull();
  });
  it('the update schema still applies no defaults', () => {
    expect(updateEmployeeSchema.parse({ wpsPersonId: '10000000000001' })).toEqual({ wpsPersonId: '10000000000001' });
  });
});

describe('updatePayrollLineSchema leave fields', () => {
  it('accepts half pay days and a reset to automatic', () => {
    expect(updatePayrollLineSchema.parse({ halfPayDays: 2 })).toEqual({ halfPayDays: 2 });
    expect(updatePayrollLineSchema.parse({ leaveOverridden: false })).toEqual({ leaveOverridden: false });
    expect(updatePayrollLineSchema.safeParse({ leaveOverridden: true }).success).toBe(false);
  });
});
```

(Import `createEmployeeSchema`, `updateEmployeeSchema`, `updatePayrollLineSchema` at the top of `payroll.test.ts` if not already imported.)

- [ ] **Step 2: Run** — `corepack pnpm --filter @saas/shared exec vitest run src/schemas` → FAIL.

- [ ] **Step 3: Implement** — in `schemas/payroll.ts` add to `employeeFields`:

```ts
  wpsPersonId: z.string().trim().nullish().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{14}$/.test(v), 'A WPS person ID is 14 digits'),
  bankRoutingCode: z.string().trim().nullish().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{9}$/.test(v), 'A routing code is 9 digits'),
  pensionSchemeId: z.string().uuid().nullish().transform((v) => v ?? null),
  annualLeaveDaysOverride: z.coerce.number().int().min(30).max(60).nullish().transform((v) => v ?? null),
  probationEndDate: isoDay.nullish().transform((v) => v ?? null),
```

and to `updatePayrollLineSchema`'s object:

```ts
    halfPayDays: z.coerce.number().min(0).max(31).optional(),
    /** Only `false`: hand the leave fields back to the records. */
    leaveOverridden: z.literal(false).optional(),
```

Create `schemas/payroll-compliance.ts`:

```ts
import { z } from 'zod';
import { LEAVE_TYPES } from '../payroll/leave';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(0).transform((n) => Math.round(n * 100) / 100);
const optionalMoney = money.nullish().transform((v) => v ?? null);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v == null || v === '' ? null : v));
const calendarDays = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;

export const payrollSettingsSchema = z
  .object({
    wpsEnabled: z.boolean(),
    employerIdType: z.enum(['MOHRE', 'FREE_ZONE']).nullish().transform((v) => v ?? null),
    employerId: optionalText(20),
    payerRoutingCode: z.string().trim().nullish().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{9}$/.test(v), 'A routing code is 9 digits'),
    annualLeaveDays: z.coerce.number().int().min(30).max(60).default(30),
  })
  .refine((v) => !v.wpsEnabled || (v.employerIdType && v.employerId && v.payerRoutingCode), { message: 'WPS needs the employer ID type, employer ID and payer routing code', path: ['employerId'] })
  .refine((v) => v.employerIdType !== 'MOHRE' || !v.employerId || /^\d{13}$/.test(v.employerId), { message: 'A MOHRE employer ID is 13 digits', path: ['employerId'] });

const pct = z.coerce.number().min(0).max(100);
const schemeFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  employeePct: pct,
  employerPct: pct,
  base: z.enum(['BASIC', 'BASIC_HOUSING', 'GROSS']),
  minSalary: optionalMoney,
  maxSalary: optionalMoney,
};
const minBelowMax = (v: { minSalary?: number | null; maxSalary?: number | null }) => v.minSalary == null || v.maxSalary == null || v.minSalary <= v.maxSalary;

export const createPensionSchemeSchema = z.object(schemeFields).refine(minBelowMax, { message: 'Minimum salary cannot exceed the maximum', path: ['minSalary'] });
export const updatePensionSchemeSchema = z
  .object({ ...schemeFields, isActive: z.boolean() })
  .partial()
  .refine(minBelowMax, { message: 'Minimum salary cannot exceed the maximum', path: ['minSalary'] })
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as typeof v);

export const leaveRecordSchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    startDate: isoDay,
    endDate: isoDay,
    days: z.coerce.number().positive().multipleOf(0.5).nullish(),
    note: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date cannot be before the start', path: ['endDate'] })
  .refine((v) => v.days == null || v.days <= calendarDays(v.startDate, v.endDate), { message: 'More days than the dates cover', path: ['days'] })
  .transform((v) => ({ ...v, days: v.days ?? calendarDays(v.startDate, v.endDate) }));

export const leaveAdjustmentSchema = z.object({
  days: z.coerce.number().refine((n) => n !== 0, 'Days cannot be zero').transform((n) => Math.round(n * 100) / 100),
  note: z.string().trim().min(1, 'Say why').max(200),
});

export const openingLeavePreviewSchema = z.object({ cutoverDate: isoDay.optional() });
export const postOpeningLeaveSchema = z.object({
  cutoverDate: isoDay,
  lines: z
    .array(z.object({ employeeId: z.string().uuid(), balanceDays: z.coerce.number().min(-60).max(400).transform((n) => Math.round(n * 100) / 100) }))
    .min(1, 'Choose at least one employee'),
});

export const remitPensionSchema = z.object({ financeAccountId: z.string().uuid(), paidAt: z.coerce.date().optional() });

export const SETTLEMENT_REASONS = ['RESIGNATION', 'TERMINATION', 'END_OF_CONTRACT', 'DEATH', 'OTHER'] as const;
export const createSettlementSchema = z.object({ employeeId: z.string().uuid(), reason: z.enum(SETTLEMENT_REASONS) });
export const updateSettlementSchema = z
  .object({
    reason: z.enum(SETTLEMENT_REASONS).optional(),
    leaveEncashmentDays: z.coerce.number().min(0).max(400).optional(),
    noticeDays: z.coerce.number().min(0).max(180).optional(),
    noticeDirection: z.enum(['PAY', 'DEDUCT']).optional(),
    advanceRecovery: money.optional(),
    manualLines: z
      .array(z.object({ kind: z.enum(['ADDITION', 'DEDUCTION']), label: z.string().trim().min(1, 'Describe the line').max(160), amount: money.refine((n) => n > 0, 'Amount must be above zero') }))
      .max(20)
      .optional(),
  })
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as typeof v);
export const paySettlementSchema = z.object({ financeAccountId: z.string().uuid(), paidAt: z.coerce.date().optional() });

export type PayrollSettingsInput = z.input<typeof payrollSettingsSchema>;
export type PayrollSettingsPayload = z.output<typeof payrollSettingsSchema>;
export type CreatePensionSchemeInput = z.input<typeof createPensionSchemeSchema>;
export type CreatePensionSchemePayload = z.output<typeof createPensionSchemeSchema>;
export type UpdatePensionSchemeInput = z.input<typeof updatePensionSchemeSchema>;
export type UpdatePensionSchemePayload = z.output<typeof updatePensionSchemeSchema>;
export type LeaveRecordFormInput = z.input<typeof leaveRecordSchema>;
export type LeaveRecordPayload = z.output<typeof leaveRecordSchema>;
export type LeaveAdjustmentInput = z.input<typeof leaveAdjustmentSchema>;
export type LeaveAdjustmentPayload = z.output<typeof leaveAdjustmentSchema>;
export type PostOpeningLeaveInput = z.input<typeof postOpeningLeaveSchema>;
export type PostOpeningLeavePayload = z.output<typeof postOpeningLeaveSchema>;
export type RemitPensionInput = z.input<typeof remitPensionSchema>;
export type RemitPensionPayload = z.output<typeof remitPensionSchema>;
export type SettlementReason = (typeof SETTLEMENT_REASONS)[number];
export type CreateSettlementInput = z.input<typeof createSettlementSchema>;
export type CreateSettlementPayload = z.output<typeof createSettlementSchema>;
export type UpdateSettlementInput = z.input<typeof updateSettlementSchema>;
export type UpdateSettlementPayload = z.output<typeof updateSettlementSchema>;
export type PaySettlementInput = z.input<typeof paySettlementSchema>;
export type PaySettlementPayload = z.output<typeof paySettlementSchema>;
```

(`LeaveRecordFormInput` avoids clashing with `LeaveRecordInput` from `payroll/leave.ts`.)

Create `payroll/compliance-types.ts`:

```ts
import type { LeaveType } from './leave';
import type { PensionBase } from './pension';
import type { WpsEmployerIdType } from './wps';
import type { PaymentMethod } from './types';
import type { SettlementReason } from '../schemas/payroll-compliance';

export interface PayrollSettingsDto { wpsEnabled: boolean; employerIdType: WpsEmployerIdType | null; employerId: string | null; payerRoutingCode: string | null; annualLeaveDays: number; }

export interface PensionSchemeDto { id: string; name: string; presetKey: string | null; employeePct: number; employerPct: number; base: PensionBase; minSalary: number | null; maxSalary: number | null; isActive: boolean; assignedCount: number; createdAt: string; }

export interface LeaveRecordDto { id: string; employeeId: string; type: LeaveType; startDate: string; endDate: string; days: number; note: string | null; createdAt: string; }
export type LeaveEntryKind = 'OPENING' | 'ACCRUAL' | 'TAKEN' | 'ADJUSTMENT' | 'ENCASHMENT' | 'REVERSAL';
export interface LeaveLedgerEntryDto { id: string; kind: LeaveEntryKind; days: number; amount: number | null; asOf: string; note: string | null; createdAt: string; }
export interface EmployeeLeaveDto {
  balanceDays: number;
  /** Statutory leave earned to today (for information). */
  accruedToDate: number;
  annualDays: number;
  /** Leave salary provision carried — present only for payroll:read holders. */
  provision?: number;
  records: LeaveRecordDto[];
  /** Amounts are stripped for callers without payroll:read. */
  entries: LeaveLedgerEntryDto[];
}
export interface OpeningLeavePreviewDto { cutoverDate: string; lines: { employeeId: string; employeeName: string; joiningDate: string; basic: number; serviceDays: number; calculatedDays: number }[]; }

export interface PensionRemittanceDto { id: string; period: string; amount: number; financeAccountId: string; paidAt: string; voidedAt: string | null; createdAt: string; }
export interface PensionPeriodDto {
  period: string;
  employeeTotal: number;
  employerTotal: number;
  due: number;
  lines: { employeeId: string; employeeName: string; schemeName: string | null; base: number; employee: number; employer: number }[];
  remittance: PensionRemittanceDto | null;
}

export type SettlementStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'VOIDED';
export type SettlementLineKind = 'GRATUITY' | 'LEAVE_ENCASHMENT' | 'NOTICE_PAY' | 'ADVANCE_RECOVERY' | 'ADDITION' | 'DEDUCTION';
export interface SettlementLineDto { id: string; kind: SettlementLineKind; label: string; quantity: number | null; rate: number | null; amount: number; }
export interface SettlementDto {
  id: string; settlementNumber: string; employeeId: string; employeeName: string; leavingDate: string;
  reason: SettlementReason; serviceDays: number; basic: number; gross: number; leaveBalanceDays: number;
  status: SettlementStatus; netPay: number; paymentMethod: PaymentMethod; financeAccountId: string | null;
  paidAt: string | null; approvedAt: string | null; journalEntryId: string | null;
  lines: SettlementLineDto[]; createdAt: string; updatedAt: string;
}
export interface SettlementStatementDto {
  settlement: SettlementDto;
  employee: { employeeNumber: string; fullName: string; jobTitle: string | null; joiningDate: string; ibanMasked: string | null; bankName: string | null };
  organization: { name: string; legalName: string | null; address: string | null; baseCurrency: string };
}

export interface WpsSifDto { fileName: string; content: string; warnings: string[]; }
```

Export `./schemas/payroll-compliance` and `./payroll/compliance-types` from `index.ts` after `./payroll/types`.

- [ ] **Step 4: Run** — `corepack pnpm --filter @saas/shared test && corepack pnpm --filter @saas/shared build && corepack pnpm --filter api build && corepack pnpm --filter web exec tsc --noEmit` → PASS (`CreateEmployeePayload` gains fields the API ignores until Task 7).

- [ ] **Step 5: Commit** — `git add packages/shared/src && git commit -m "feat(shared): compliance schemas and DTOs"`

---

### Task 6: API — migration, entities, DTO plumbing

**Files:**
- Create: `apps/api/src/database/migrations/1790100000000-UaeCompliance.ts`, `apps/api/src/database/uae-compliance-migration.spec.ts`
- Create: `apps/api/src/modules/payroll/entities/payroll-settings.entity.ts`, `pension-scheme.entity.ts`, `leave-record.entity.ts`, `leave-ledger-entry.entity.ts`, `pension-remittance.entity.ts`, `settlement.entity.ts` (`Settlement`, `SettlementLine`)
- Modify: `apps/api/src/modules/payroll/entities/employee.entity.ts`, `payroll-run.entity.ts`, `gratuity-ledger-entry.entity.ts`, `payroll.module.ts`, `payroll-runs.service.ts` (`toLineDto`, `toDto`), `employees.service.ts` (`toView`), `apps/api/src/database/tenant-sequence.util.ts`, `apps/api/src/modules/finance/entities/journal-entry.entity.ts`, `apps/api/src/modules/finance/finance.service.ts` (`pensionOut: 0` placeholder in every month row), `apps/api/src/modules/storage/attachment-owners.ts`, `apps/api/src/modules/audit/audit-subjects.ts`
- Modify shared: `packages/shared/src/payroll/types.ts` (fields below), `packages/shared/src/finance/types.ts` (`pensionOut`), `packages/shared/src/platform/attachments.ts` (`'LEAVE_RECORD'`)
- Modify web fixtures so `tsc` stays clean: `apps/web/src/components/people/payroll.spec.tsx`, `payroll-line-editor.spec.tsx`, and any other spec building `PayrollRunLineDto`, `PayrollRunTotalsDto`, `EmployeeDto` or `CashForecastMonthDto` literals (grep for `gratuityAfter:`, `bankNet:`, `ibanMasked:`, `payrollOut:`).

**Interfaces:**
- Produces entities (style of `payroll-run.entity.ts`: snake_case `name:`, `numericTransformer` / `nullableNumericTransformer`, dates `type: 'date'` → `string`):
  - `PayrollSettings` (`payroll_settings`): `id, tenantId, wpsEnabled (bool default false), employerIdType (varchar 10, null), employerId (varchar 20, null), payerRoutingCode (char 9, null), annualLeaveDays (int default 30), updatedAt (UpdateDateColumn 'updated_at')`. Unique index `uq_payroll_settings_tenant` (tenant_id).
  - `PensionScheme` (`pension_schemes`): `id, tenantId, name (varchar 120), presetKey (varchar 40, null), employeePct (numeric 5,2), employerPct (numeric 5,2), base (varchar 20), minSalary (numeric 14,2 null), maxSalary (numeric 14,2 null), isActive (bool default false), createdAt ('created_at')`. Index `idx_pension_schemes_tenant` (tenant_id); unique `uq_pension_schemes_tenant_preset` (tenant_id, preset_key) where `"preset_key" IS NOT NULL`.
  - `LeaveRecord` (`leave_records`): `id, tenantId, employeeId, type (varchar 20), startDate (date), endDate (date), days (numeric 5,1), note (text null), createdById (uuid null), createdAt, updatedAt`. Index `idx_leave_records_employee` (tenant_id, employee_id).
  - `LeaveLedgerEntry` (`leave_ledger_entries`): `id, tenantId, employeeId, kind (varchar 20), days (numeric 7,2), amount (numeric 14,2 null), asOf (date), runLineId (uuid null), settlementId (uuid null), journalEntryId (uuid null), note (text null), createdAt`. Index `idx_leave_ledger_employee` (tenant_id, employee_id).
  - `PensionRemittance` (`pension_remittances`): `id, tenantId, period (char 7), amount (numeric 14,2), financeAccountId (uuid), paidAt (timestamptz), journalEntryId (uuid), voidJournalEntryId (uuid null), voidedAt (timestamptz null), createdById (uuid null), createdAt`. Unique `uq_pension_remittances_live` (tenant_id, period) where `"voided_at" IS NULL`.
  - `Settlement` (`settlements`): `id, tenantId, settlementNumber (varchar 40), employeeId, employeeName (varchar 255), leavingDate (date), reason (varchar 20), serviceDays (int), status (varchar 20 default 'DRAFT'), basic (money), gross (money), leaveBalanceDays (numeric 7,2 default 0), netPay (money), paymentMethod (varchar 10), financeAccountId (uuid null), paidAt (timestamptz null), journalEntryId (uuid null), paymentJournalEntryId (uuid null), voidJournalEntryId (uuid null), approvedById (uuid null), approvedAt (timestamptz null), createdById (uuid null), createdAt, updatedAt`. Unique `uq_settlements_tenant_number` (tenant_id, settlement_number); unique `uq_settlements_live_employee` (tenant_id, employee_id) where `"status" <> 'VOIDED'`.
  - `SettlementLine` (`settlement_lines`): `id, tenantId, settlementId, kind (varchar 20), label (varchar 160), quantity (numeric 7,2 null), rate (numeric 14,4 null), amount (numeric 14,2), sortOrder (int default 0)`. Index `idx_settlement_lines_settlement` (settlement_id).
  - `Employee` gains `wpsPersonId (varchar 14 null)`, `bankRoutingCode (char 9 null)`, `pensionSchemeId (uuid null)`, `annualLeaveDaysOverride (int null)`, `probationEndDate (date null)`.
  - `PayrollRun` gains money columns `totalHalfPay ('total_half_pay')`, `totalPensionEmployee`, `totalPensionEmployer`, `totalLeaveProvision`.
  - `PayrollRunLine` gains `halfPayDays (numeric 5,2 default 0)`, `halfPayAmount (money)`, `annualLeaveDays (numeric 5,2 default 0)`, `leaveDaysInPeriod (numeric 5,2 default 0)`, `leaveOverridden (bool default false)`, `pensionSchemeId (uuid null)`, `pensionSchemeName (varchar 120 null)`, `pensionBase (money)`, `pensionEmployee (money)`, `pensionEmployer (money)`, `leaveProvisionBefore / leaveProvisionChange / leaveProvisionAfter (numeric 14,2 null)`.
  - `GratuityLedgerEntry` gains `settlementId (uuid null, 'settlement_id')`.
- Shared DTO additions:
  - `PayrollRunLineDto`: `halfPayDays, halfPayAmount, annualLeaveDays, leaveDaysInPeriod: number; leaveOverridden: boolean; pensionSchemeName: string | null; pensionBase, pensionEmployee, pensionEmployer: number; leaveProvisionBefore, leaveProvisionChange, leaveProvisionAfter: number | null`.
  - `PayrollRunTotalsDto`: `halfPay, pensionEmployee, pensionEmployer, leaveProvision: number`.
  - `EmployeeDto`: `wpsPersonId, bankRoutingCode, pensionSchemeId: string | null; annualLeaveDaysOverride: number | null; probationEndDate: string | null`.
  - `CashForecastMonthDto.pensionOut: number`.
  - `ATTACHMENT_OWNER_TYPES` gains `'LEAVE_RECORD'`.
- `TenantSequenceName` gains `'settlement_number'`; journal enum gains `'SETTLEMENT', 'PENSION_REMITTANCE'`.
- `attachment-owners.ts`: `LEAVE_RECORD: { entity: LeaveRecord, read: PERMISSIONS.EMPLOYEE_MANAGE, write: PERMISSIONS.EMPLOYEE_MANAGE, label: 'leave record' }` (medical certificates are as private as employee documents).
- `audit-subjects.ts`: `settlements → { subject: 'SETTLEMENT', entity: Settlement }`, `'payroll/settings' → { subject: 'PAYROLL_SETTINGS', entity: PayrollSettings }`, `'payroll/pension-schemes' → { subject: 'PENSION_SCHEME', entity: PensionScheme }`, `'payroll/pension' → { subject: 'PENSION_REMITTANCE', entity: PensionRemittance }`, `'payroll/opening-leave' → { subject: 'PAYROLL', entity: LeaveLedgerEntry }`.

- [ ] **Step 1: Entities** — write the six new entity files and the column additions above. Every money column uses the `money(name)` helper pattern from `payroll-run.entity.ts`.

- [ ] **Step 2: Migration** — hand-write `UaeCompliance1790100000000`. `up()` in this order:
  1. `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'SETTLEMENT'` and the same for `'PENSION_REMITTANCE'`.
  2. `CREATE TABLE` for `payroll_settings`, `pension_schemes`, `leave_records`, `settlements`, `settlement_lines`, `leave_ledger_entries`, `pension_remittances` (that order — FKs point backwards), uuid PK `DEFAULT gen_random_uuid()` named `PK_<table>_id`, every index from the Interfaces with the exact names. FKs (named `FK_<table>_<column-stem>`): `tenant_id → organizations(id) ON DELETE CASCADE` on all; `leave_records.employee_id`, `leave_ledger_entries.employee_id`, `settlements.employee_id → employees(id) ON DELETE RESTRICT`; `settlement_lines.settlement_id → settlements(id) ON DELETE CASCADE`; `leave_ledger_entries.run_line_id → payroll_run_lines(id) ON DELETE SET NULL`; `leave_ledger_entries.settlement_id → settlements(id) ON DELETE RESTRICT`; every `*journal_entry_id → journal_entries(id) ON DELETE RESTRICT`; `pension_remittances.finance_account_id`, `settlements.finance_account_id → finance_accounts(id) ON DELETE RESTRICT`. CHECKs: `payroll_settings.employer_id_type IN ('MOHRE','FREE_ZONE')`, `payroll_settings.annual_leave_days BETWEEN 30 AND 60`, `pension_schemes.base IN ('BASIC','BASIC_HOUSING','GROSS')`, `leave_records.type IN ('ANNUAL','SICK','UNPAID','MATERNITY','OTHER_PAID')`, `leave_records."end_date" >= "start_date"`, `leave_records.days > 0`, `leave_ledger_entries.kind IN ('OPENING','ACCRUAL','TAKEN','ADJUSTMENT','ENCASHMENT','REVERSAL')`, `settlements.status IN ('DRAFT','APPROVED','PAID','VOIDED')`, `settlements.reason IN ('RESIGNATION','TERMINATION','END_OF_CONTRACT','DEATH','OTHER')`, `settlement_lines.kind IN ('GRATUITY','LEAVE_ENCASHMENT','NOTICE_PAY','ADVANCE_RECOVERY','ADDITION','DEDUCTION')`.
  3. `ALTER TABLE "employees" ADD COLUMN …` for the five columns, plus `CONSTRAINT "FK_employees_pension_scheme" FOREIGN KEY ("pension_scheme_id") REFERENCES "pension_schemes"("id") ON DELETE RESTRICT`. `ALTER TABLE "payroll_runs" ADD COLUMN` the four totals (`numeric(14,2) NOT NULL DEFAULT 0`). `ALTER TABLE "payroll_run_lines" ADD COLUMN` the twelve line columns (defaults as in the entity). `ALTER TABLE "gratuity_ledger_entries" ADD COLUMN "settlement_id" uuid` + FK `→ settlements(id) ON DELETE RESTRICT`.
  4. `SELECT set_config('app.bypass_rls','on',true)` then backfill 2410, 2420, 6320, 6330 with the exact `INSERT … SELECT … WHERE NOT EXISTS` statement and frozen `ACCOUNTS` array pattern from `1790000000000-EmployeesAndPayroll.ts` (6320/6330 parent `'6000'`).
  5. RLS on the seven new tables with the policy loop copied from `1790000000000-EmployeesAndPayroll.ts`.
  `down()`: drop the gratuity FK and column, the line/run/employee columns, the seven tables (children first), soft-delete the four accounts by role (comment that enum values stay, as in `1790000000000`).

- [ ] **Step 3: Plumbing** — register the seven entities in `payroll.module.ts` `TypeOrmModule.forFeature`; add sequence name and enum values; map the new columns in `PayrollRunsService` `toLineDto`/`toDto` and `EmployeesService.toView`; `recalcTotals` and `saveTotals` gain the four totals (`totalHalfPay = Σ halfPayAmount`, `totalPensionEmployee = Σ pensionEmployee`, `totalPensionEmployer = Σ pensionEmployer`, `totalLeaveProvision = Σ (leaveProvisionChange ?? 0)`), and `PayrollPostingService.approve`'s run `update` writes them too; add `pensionOut: 0` to every month row in `FinanceService.cashForecast` (Task 15 fills it). Update the web spec fixtures.

- [ ] **Step 4: Migration test** — `apps/api/src/database/uae-compliance-migration.spec.ts`: run `up()` against `{ query: jest.fn() }` and assert: the two `ADD VALUE` statements come first; one `CREATE TABLE` per new table; `FORCE ROW LEVEL SECURITY` for each of the seven; the backfill passes codes `2410`, `2420`, `6320`, `6330`; `bypass_rls` precedes the first `INSERT`; an `ALTER TABLE "employees"` adds `"pension_scheme_id"`. Then run `down()` and assert it drops `"settlements"` after `"settlement_lines"`.

- [ ] **Step 5: Run** — `corepack pnpm --filter @saas/shared build && corepack pnpm --filter api exec jest src/database && corepack pnpm --filter api test && corepack pnpm --filter api build && corepack pnpm --filter web exec tsc --noEmit` → PASS.

- [ ] **Step 6: Commit** — `git add apps/api/src apps/web/src packages/shared/src && git commit -m "feat(api): compliance schema — leave, pension, settlements, WPS settings"`

---

### Task 7: API — payroll settings, pension schemes, employee compliance fields

**Files:**
- Create: `apps/api/src/modules/payroll/payroll-settings.service.ts`, `pension.service.ts`, `payroll-compliance.controller.ts`
- Test: `payroll-settings.service.spec.ts`, `pension.service.spec.ts`, `employees.service.spec.ts` (extend)
- Modify: `employees.service.ts` (create/update persist and validate the new fields), `payroll.module.ts`

**Interfaces:**
- Produces:
  - `PayrollSettingsService.get(tenantId, manager?: EntityManager): Promise<PayrollSettingsDto>` (defaults `{ wpsEnabled: false, employerIdType: null, employerId: null, payerRoutingCode: null, annualLeaveDays: 30 }` when no row); `.put(tenantId, input: PayrollSettingsPayload): Promise<PayrollSettingsDto>` (upsert `INSERT … ON CONFLICT ("tenant_id") DO UPDATE`); `.annualDaysFor(manager, tenantId, employee: Employee): Promise<number>` (override ?? tenant).
  - `PensionService.list(tenantId): Promise<PensionSchemeDto[]>` — first inserts any missing presets (`INSERT … ON CONFLICT DO NOTHING` on `uq_pension_schemes_tenant_preset`, `isActive: false`) from `PENSION_SCHEME_PRESETS`; `assignedCount` = non-deleted employees with that scheme. `.create(tenantId, input)` (active), `.update(tenantId, id, input)`, `.remove(tenantId, id)` (409 "<name> is assigned to N employees; deactivate it instead" when assigned). `.activeSchemeFor(manager, tenantId, employee): Promise<PensionScheme | null>`; `.ratesOf(s: PensionScheme): PensionRates`.
  - Routes (`@Controller('payroll')`): `GET /payroll/settings` (`PAYROLL_READ`), `PUT /payroll/settings` (`PAYROLL_MANAGE`, `zodBody(payrollSettingsSchema)`); `GET /payroll/pension-schemes` (`PAYROLL_READ`), `POST` (`PAYROLL_MANAGE`, `createPensionSchemeSchema`), `PATCH /:id` (`PAYROLL_MANAGE`, `updatePensionSchemeSchema`), `DELETE /:id` (`PAYROLL_MANAGE`, 204).
- Employee rules: `pensionSchemeId` must be an **active** scheme of the tenant (404 / 400 "Activate <name> before assigning it"); refused for non-nationals (400 "Pension schemes apply to UAE and GCC nationals"); setting `isNational: false` clears it; `probationEndDate` must be ≥ `joiningDate` (400). `wpsPersonId`, `bankRoutingCode`, `annualLeaveDaysOverride` stored as given.

- [ ] **Step 1: Failing tests** (in-memory repo mocks in the style of `employees.service.spec.ts`):
  - settings: `get` with no row returns the defaults; `put` then `get` returns what was saved; `annualDaysFor` prefers the employee override.
  - schemes: first `list` creates the four presets inactive, a second `list` creates none; `create` is active; `update` can activate a preset; `remove` refuses an assigned scheme and deletes an unassigned one.
  - employees: assigning an inactive scheme → 400; assigning to a non-national → 400; `isNational: false` clears the scheme; `probationEndDate` before joining → 400; new fields round-trip through create and `toView`.

- [ ] **Step 2–4:** run (`corepack pnpm --filter api exec jest src/modules/payroll`) → FAIL, implement, → PASS; `corepack pnpm --filter api build`.

- [ ] **Step 5: Commit** — `feat(api): payroll settings, pension schemes and employee compliance fields`

---

### Task 8: API — leave balances, records, locks and draft refill

**Files:**
- Create: `apps/api/src/modules/payroll/leave.service.ts`, `leave-records.service.ts`, `leave.controller.ts`
- Test: `leave.service.spec.ts`, `leave-records.service.spec.ts`
- Modify: `payroll-runs.service.ts` (new `fillLeave` and `refillLeaveForEmployee`), `payroll.module.ts`

**Interfaces:**
- Consumes: `leaveForPeriod`, `leaveAccrued`, `leaveServiceDays`, `sickDaysByServiceYear`, `recordPeriods` (Task 2); `GratuityService.unpaidLeaveDaysTo`; `PayrollSettingsService.annualDaysFor`; `EmployeesService.packageAt`; `POSTED_RUN_STATUSES`, `postedRunLines`.
- Produces (`LeaveService`, reads only — no dependency on `PayrollRunsService`):
  - `records(manager, tenantId, employeeId): Promise<LeaveRecord[]>`
  - `periodLeave(manager, tenantId, employee: Employee, period: string): Promise<PeriodLeave>`
  - `balanceDays(manager, tenantId, employeeId): Promise<number>` — Σ days of all ledger rows.
  - `provisionBalance(manager, tenantId, employeeId): Promise<number>` — Σ amount (null as 0).
  - `accrualBaseline(manager, tenantId, employeeId): Promise<number>` — Σ days of OPENING rows + ACCRUAL rows whose `runLineId` has no REVERSAL row.
  - `accruedTo(manager, tenantId, employee, asOf: string, extraUnpaidDays = 0): Promise<{ serviceDays: number; accrued: number; annualDays: number }>` — service stops at `min(asOf, leavingDate)`, but unpaid days are counted with the **uncapped** `asOf` via `gratuity.unpaidLeaveDaysTo(manager, tenantId, employee.id, asOf, extraUnpaidDays)`, exactly as `GratuityService.entitlement` does, so a leaver's final-month unpaid leave still counts. Callers pass a month end.
  - `latestCutover(manager, tenantId): Promise<string | null>` — max `asOf` of leave OPENING rows.
  - `summary(tenantId, employeeId, canSeePay: boolean): Promise<EmployeeLeaveDto>`
- Produces (`PayrollRunsService`, used by Tasks 10–11):
  - `fillLeave(manager, line: PayrollRunLine, employee: Employee, period: string): Promise<void>` — unless `line.leaveOverridden`: sets `unpaidLeaveDays = pl.unpaidDays`, `halfPayDays = pl.halfPayDays`; always sets `annualLeaveDays = pl.annualDays`, `leaveDaysInPeriod = pl.leaveDays`.
  - `refillLeaveForEmployee(manager, tenantId, employeeId, periods: string[]): Promise<void>` — for each DRAFT run among `periods` with a line for the employee: lock the run (`lockPayrollRun`), `fillLeave`, `recalcLine`, save the line's leave/amount columns, recompute and `saveTotals`.
- Produces (`LeaveRecordsService` — depends on `LeaveService` and `PayrollRunsService`):
  - `create(tenantId, employeeId, actorId, input: LeaveRecordPayload): Promise<LeaveRecordDto>`; `update(tenantId, employeeId, recordId, input)`; `remove(tenantId, employeeId, recordId)`.
- Routes (`leave.controller.ts`, `@Controller('employees')`): `GET /employees/:id/leave` (`EMPLOYEE_READ`; `canSeePay = user.permissions.includes(PAYROLL_READ)`; without it `provision` is omitted and every entry's `amount` is null); `POST /employees/:id/leave-records` (`EMPLOYEE_MANAGE`, `zodBody(leaveRecordSchema)`); `PATCH /employees/:id/leave-records/:recordId` (same); `DELETE …/:recordId` (`EMPLOYEE_MANAGE`, 204).

Record rules (one transaction; take `lockGratuityOpening(manager, tenantId)` first so they serialise with approval):
- The employee must exist (404); dates within employment: `startDate ≥ joiningDate` and, if `leavingDate`, `endDate ≤ leavingDate` (400).
- Overlap with another record of the employee (excluding itself on update) → 409 "<name> already has <type> leave from <start> to <end>".
- Locked periods: for every period in `recordPeriods` of the new range (and the old range on update/delete), a posted run with a line for the employee → 409 "Payroll <run number> for <Month YYYY> is already posted; void it to change leave in that month". An APPROVED or PAID settlement for the employee → 409 "<name> is settled; leave can no longer change".
- SICK: after the change, any service year in `sickDaysByServiceYear` above 90 → 400 "More than 90 sick days in one service year; record the employee as having left instead".
- After saving: `runs.refillLeaveForEmployee(manager, tenantId, employeeId, periods)`.

- [ ] **Step 1: Failing tests:**
  - `leave.service.spec.ts`: `balanceDays` and `provisionBalance` sum rows; `accrualBaseline` ignores ACCRUAL rows whose run line was reversed and includes OPENING; `accruedTo` caps at the leaving date and subtracts unpaid days from `unpaidLeaveDaysTo`; `summary` without pay permission omits provision and nulls amounts.
  - `leave-records.service.spec.ts`: creates a record and returns it; refuses overlap; refuses a record in a month with a posted run for the employee (and allows it when the posted run has no line for them); refuses after an approved settlement; refuses the 91st sick day of a service year; refuses dates before joining or after leaving; **refills the draft line when a leave record changes** (a draft for the month with a non-overridden line gets `unpaidLeaveDays`/`halfPayDays` from the records and its run totals updated; an overridden line keeps its manual values but its `leaveDaysInPeriod` updates); delete refills too.

- [ ] **Step 2–4:** FAIL → implement → PASS (`corepack pnpm --filter api exec jest src/modules/payroll`), `corepack pnpm --filter api build`.

- [ ] **Step 5: Commit** — `feat(api): leave records and balances feeding draft payroll`

---

### Task 9: API — opening leave and leave adjustments

**Files:**
- Modify: `apps/api/src/modules/payroll/leave.service.ts`, `payroll.controller.ts`, `leave.controller.ts`
- Test: `leave.service.spec.ts`

**Interfaces:**
- Produces:
  - `LeaveService.previewOpening(tenantId, cutoverDate?: string): Promise<OpeningLeavePreviewDto>` — default cut-over: the gratuity cut-over if one exists (`GratuityService.latestCutover`), else the last day of last month (UTC). Eligible: not LEFT, `joiningDate ≤ cutover`, no leave OPENING row, no leave ACCRUAL row that is still posted. `calculatedDays = accruedTo(employee, cutover).accrued`; `basic` = package at cut-over.
  - `LeaveService.postOpening(tenantId, actorId, input: PostOpeningLeavePayload): Promise<{ journalEntryId: string | null; total: number }>`
  - `LeaveService.adjust(tenantId, employeeId, actorId, input: LeaveAdjustmentPayload): Promise<LeaveLedgerEntryDto>`
  - Routes: `POST /payroll/opening-leave/preview` (`PAYROLL_MANAGE`, `zodBody(openingLeavePreviewSchema)`, 200) and `POST /payroll/opening-leave` (`PAYROLL_APPROVE`, `zodBody(postOpeningLeaveSchema)`) in `PayrollController`; `POST /employees/:id/leave-adjustments` (`PAYROLL_APPROVE`, `zodBody(leaveAdjustmentSchema)`) in `leave.controller.ts`.

postOpening rules (one transaction, `lockGratuityOpening` first):
- Duplicate employee ids → 400. Each employee must qualify as in the preview (400 naming them); an existing leave OPENING row → 409; a still-posted leave ACCRUAL row → 409 "Leave already accrued by a posted payroll run for <names>". Unlike gratuity, posted runs before the cut-over do **not** block: runs approved before this sub-project carry no leave rows, so nothing is counted twice.
- Per employee: `calculated = accruedTo(employee, cutover).accrued`; `basic = packageAt(cutover).basic`; `amount = round2(balanceDays × basic / 30)`. Rows: `OPENING { days: calculated, amount, asOf: cutover }` and, when `balanceDays ≠ calculated`, `ADJUSTMENT { days: round2(balanceDays − calculated), amount: null, note: 'Opening balance: leave taken before go-live' }`.
- Journal when `total = Σ amount ≠ 0`: `Dr OPENING_BALANCE_EQUITY / Cr LEAVE_PROVISION` (reverse sides when negative), `entryNumber 'JE-LEAVE-OPEN-<cutover>-<8 hex>'`, `referenceType 'PAYROLL'`, `referenceId 'leave-opening:<cutover>'`, `entryDate` the cut-over (UTC midnight), base currency, rate 1.

adjust rules: employee exists; an APPROVED/PAID settlement → 409 "<name> is settled"; writes `ADJUSTMENT { days, amount: null, asOf: today, note }` with no journal (the next approval trues the provision up).

- [ ] **Step 1: Failing tests:** preview lists eligible employees with calculated days and defaults to the gratuity cut-over; post writes OPENING at the calculated days plus an ADJUSTMENT for the difference and one balanced journal of Σ balance × basic ÷ 30; a negative balance posts the reverse journal; duplicate opening → 409; already accrued → 409; adjust writes a days-only row; adjust after settlement → 409.

- [ ] **Step 2–4:** FAIL → implement → PASS.

- [ ] **Step 5: Commit** — `feat(api): opening leave balances and leave adjustments`

---

### Task 10: API — runs: leave feed, half pay, pension, flags, leave cut-over

**Files:**
- Modify: `apps/api/src/modules/payroll/payroll-runs.service.ts`, `payroll.module.ts`
- Test: `payroll-runs.service.spec.ts`

**Interfaces:**
- Consumes: `LeaveService` (Task 8), `PensionService.activeSchemeFor/ratesOf` (Task 7), `pensionContribution`, `computeLine` with `halfPayDays`/`pensionEmployee` (Task 3).
- Produces:
  - `NATIONAL_NO_SCHEME_FLAG = 'NATIONAL_NO_PENSION_SCHEME'` (replaces `NATIONAL_PENSION_FLAG`, which is removed) and `LEAVE_IN_ADVANCE_FLAG = 'LEAVE_IN_ADVANCE'`, exported from `payroll-runs.service.ts`.
  - `applyPension(manager, line: PayrollRunLine, employee: Employee): Promise<void>` — public, used by approval (Task 11).
  - `recalcLine` passes `halfPayDays: line.halfPayDays` and `pensionEmployee: line.pensionEmployee` to `computeLine` and sets `line.halfPayAmount`.

Rules:
- create / refresh: after `snapshot`, `await this.fillLeave(manager, line, el.employee, period)`, `await this.applyPension(manager, line, el.employee)`, then flags, then `recalcLine`. On refresh, existing lines keep `leaveOverridden` and their manual values (as extras are kept today).
- `applyPension`: non-national → scheme fields null, amounts 0. National with an active scheme → `pensionSchemeId/Name` and `pensionContribution({ rates, basic, housing, gross, daysEmployed, daysInMonth })` into `pensionBase/Employee/Employer`. National without one → amounts 0, scheme null.
- flags: `NATIONAL_NO_PENSION_SCHEME` when national and no active scheme; `LEAVE_IN_ADVANCE` when `balanceDays + (accruedTo(employee, period end, line.unpaidLeaveDays).accrued − accrualBaseline) − annualLeaveDays < 0`.
- updateLine: if the input contains `unpaidLeaveDays` or `halfPayDays`, set `leaveOverridden = true`; if the input is `{ leaveOverridden: false }`, set it false and `fillLeave` from records. Validation adds `unpaidLeaveDays + halfPayDays ≤ daysEmployed` (400 "<name> has more leave days than days employed in <Month YYYY>").
- create: also refuse when `LeaveService.latestCutover ≥ period end` (409 "Leave opening balances were set up as of <date>; payroll for <Month YYYY> is already in them").

- [ ] **Step 1: Failing tests:** a draft line takes unpaid and half-pay days from sick and unpaid records; half pay reduces salary cost by gross ÷ 30 × 0.5 per day; a national with an active GPSSA scheme gets base/employee/employer and lower net pay; a national without a scheme is flagged `NATIONAL_NO_PENSION_SCHEME` and has no pension; editing unpaid days marks the line overridden and refresh keeps it; `{ leaveOverridden: false }` puts the record values back; unpaid + half pay above days employed → 400; annual leave beyond the balance flags `LEAVE_IN_ADVANCE`; a run at or before the leave cut-over → 409. Update existing tests that expected `NATIONAL_PENSION_NOT_HANDLED`.

- [ ] **Step 2–4:** FAIL → implement → PASS.

- [ ] **Step 5: Commit** — `feat(api): payroll lines take leave from records and pension for nationals`

---

### Task 11: API — approval and void: leave true-up, pension postings, new guards

**Files:**
- Modify: `apps/api/src/modules/payroll/payroll-posting.service.ts`, `payroll.module.ts`
- Test: `payroll-posting.service.spec.ts`

**Interfaces:**
- Consumes: `LeaveService` (`periodLeave`, `balanceDays`, `provisionBalance`, `accrualBaseline`, `accruedTo`, `latestCutover`), `PayrollRunsService.fillLeave/applyPension/recalcLine/recalcTotals`, entities `LeaveLedgerEntry`, `PensionRemittance`, `Settlement`.
- Produces: approval journal and line fields as below; void reversals; no new public methods.

approve — inside the existing transaction, after `lockGratuityOpening` and the month-order / gratuity cut-over checks:
1. Leave cut-over: `LeaveService.latestCutover` ≥ period end → 409 (same wording as Task 10).
2. Per line, before `revalidate`: load the employee (withDeleted); `await runs.fillLeave(...)` (non-overridden lines follow the records as they are now); `await runs.applyPension(...)`. A national with no active scheme → collect; after the loop, 409 "Assign an active pension scheme to <names> before approving".
3. `revalidate` additionally refuses `unpaidLeaveDays + halfPayDays > daysEmployed`.
4. Gratuity true-up exactly as today.
5. Leave true-up per line: `asOf = period end` (the ledger rows' `asOf` is `min(period end, leavingDate)`); `acc = accruedTo(employee, period end, line.unpaidLeaveDays)`; `accrualDays = round2(acc.accrued − accrualBaseline)`; `takenDays = −line.annualLeaveDays`; `balanceAfter = round2(balanceDays + accrualDays + takenDays)`; `before = provisionBalance`; `target = round2(balanceAfter × line.basic / 30)`; `change = round2(target − before)`; set `leaveProvisionBefore = before`, `leaveProvisionChange = change`, `leaveProvisionAfter = target`. Rows (after the journal is saved, carrying its id): `ACCRUAL { days: accrualDays, amount: change, asOf, runLineId }` always; `TAKEN { days: takenDays, amount: null, asOf, runLineId }` when `takenDays ≠ 0`.
6. Journal lines added to the existing list (zero lines filtered as today):
   - `[PENSION_PAYABLE, 'Pension contributions payable', 0, totalPensionEmployee, description]`
   - `[PENSION_EXPENSE, 'Employer pension contribution', totalPensionEmployer, 0, description]`, `[PENSION_PAYABLE, 'Pension contributions payable', 0, totalPensionEmployer, description]`
   - with `LP = totalLeaveProvision`: `[LEAVE_EXPENSE, 'Leave salary expense', max(LP,0), max(−LP,0)]`, `[LEAVE_PROVISION, 'Leave salary provision', max(−LP,0), max(LP,0)]`
   - `totalAmount = round2(totalSalaryCost + |G| + totalPensionEmployer + |LP|)`.
   Balanced by construction: per line `salaryCost = netPay + advanceRecovery + otherDeductionAmount + pensionEmployee`.
7. Save the lines (leave/pension/gratuity columns) and the run totals.

void — after the existing checks:
- A live pension remittance for `run.period` → 409 "Void the pension remittance for <Month YYYY> first".
- An APPROVED or PAID settlement for an employee on the run whose `leavingDate` falls in the run's period → 409 "<settlement number> for <name> depends on this run; void it first".
- Reverse leave rows: for each line, every ACCRUAL and TAKEN row with that `runLineId` gets a `REVERSAL { days: −days, amount: amount == null ? null : −amount, asOf, runLineId, journalEntryId: voidEntryId, note: 'Void of payroll <run number>' }`.

- [ ] **Step 1: Failing tests:**
  - approve posts a balanced entry with the pension lines (employee share Cr 2420, employer Dr 6330 / Cr 2420) and the leave provision line; per-role sums asserted for a 2-employee run (one national on GPSSA, one expat with 2 annual days taken).
  - first approval with no leave history accrues the statutory days to month end; the next month accrues only the difference; annual days taken reduce the balance and the provision.
  - a raise re-values the provision (same days, higher basic → positive change with zero accrual days).
  - **approval applies the current scheme**: scheme assigned after the draft was created → the approved line carries pension.
  - **refuses a national whose scheme is inactive** → 409 naming them.
  - unpaid + half pay above days employed → 400.
  - void writes REVERSAL rows netting leave days and amounts to zero and reverses the journal exactly.
  - **void refused while remitted / while settled** → 409 with the messages above.

- [ ] **Step 2–4:** FAIL → implement → PASS.

- [ ] **Step 5: Commit** — `feat(api): approval posts the leave provision and pension contributions`

---

### Task 12: API — pension remittance

**Files:**
- Create: `apps/api/src/modules/payroll/pension-remittance.service.ts`
- Test: `pension-remittance.service.spec.ts`
- Modify: `payroll-compliance.controller.ts`, `payroll.module.ts`

**Interfaces:**
- Produces:
  - `PensionRemittanceService.period(tenantId, period): Promise<PensionPeriodDto>` — lines with `pensionEmployee + pensionEmployer > 0` on the period's posted run; `due = employeeTotal + employerTotal` when no live remittance, else 0; `remittance` = the live one or null.
  - `.remit(tenantId, period, actor: PayrollActor, input: RemitPensionPayload): Promise<PensionRemittanceDto>`
  - `.void(tenantId, period, actor: PayrollActor): Promise<PensionRemittanceDto>`
  - `.unremitted(manager, tenantId): Promise<{ period: string; amount: number }[]>` — for the forecast (Task 15).
  - Routes: `GET /payroll/pension/:period` (`PAYROLL_READ`; period must match `^\d{4}-(0[1-9]|1[0-2])$`, else 400), `POST /payroll/pension/:period/remit` (`PAYROLL_PAY`, `zodBody(remitPensionSchema)`, 200), `POST /payroll/pension/:period/void` (`PAYROLL_PAY`, 200). Service re-checks `PERMISSIONS.PAYROLL_PAY`.

remit (one transaction, `lockGratuityOpening` first): no posted run for the period → 409 "Approve payroll for <Month YYYY> first"; a live remittance → 409 "Pension for <Month YYYY> is already remitted"; due 0 → 409 "No pension is due for <Month YYYY>"; base-currency account check and balance decrement exactly as `PayrollPostingService.pay`; journal `Dr PENSION_PAYABLE / Cr { financeAccountId }`, `entryNumber 'JE-PENSION-<period>'`, `referenceType 'PENSION_REMITTANCE'`, `referenceId <remittance id>`, `entryDate paidAt ?? now`. Insert the row (the partial unique index decides races: `23505` → 409).

void: the live remittance (404 otherwise); reversal journal (lines swapped, dated `max(today, original)`), `entryNumber 'JE-PENSION-<period>-VOID'`; balance restored with `"balance" = "balance" + $1`; `voidedAt`, `voidJournalEntryId` set by targeted `update`.

- [ ] **Step 1: Failing tests:** period view sums shares per employee; remit posts a balanced entry and moves the account balance; second remit → 409; remit before approval → 409; foreign-currency account → 400; void reverses and frees the period for a new remittance; without permission → 403.

- [ ] **Step 2–4:** FAIL → implement → PASS.

- [ ] **Step 5: Commit** — `feat(api): remit pension contributions to the fund`

---

### Task 13: API — final settlement

**Files:**
- Create: `apps/api/src/modules/payroll/settlements.service.ts`, `settlements.controller.ts`
- Test: `settlements.service.spec.ts`
- Modify: `advances.service.ts` (recoveries include settlements), `gratuity.service.ts` (`adjust` refuses settled employees), `payroll.module.ts`

**Interfaces:**
- Consumes: `GratuityService.target/balance`, `LeaveService.balanceDays/provisionBalance`, `AdvancesService.outstanding`, `EmployeesService.packageAt`, `settlementGratuity`, `leaveEncashment`, `noticePay`, `LedgerService.resolveLines`, `lockGratuityOpening`, `allocateNextSequenceValue(…, 'settlement_number')` → `formatSequenceNumber('FS', seq)`.
- Produces (`SettlementsService`): `list(tenantId): Promise<SettlementDto[]>`, `get(tenantId, id)`, `create(tenantId, actorId, input: CreateSettlementPayload)`, `update(tenantId, id, input: UpdateSettlementPayload)`, `refresh(tenantId, id)`, `remove(tenantId, id)`, `approve(tenantId, id, actor: PayrollActor)`, `void(tenantId, id, actor)`, `pay(tenantId, id, actor, input: PaySettlementPayload)`, `statement(tenantId, id): Promise<SettlementStatementDto>`; `lockSettlement(manager, tenantId, id)` (pessimistic write, like `lockPayrollRun`).
- Routes (`@Controller('settlements')`): `GET /`, `GET /:id`, `GET /:id/statement` (`PAYROLL_READ`); `POST /` (`PAYROLL_MANAGE`, `createSettlementSchema`); `PATCH /:id` (`PAYROLL_MANAGE`, `updateSettlementSchema`); `POST /:id/refresh` (`PAYROLL_MANAGE`, 200); `DELETE /:id` (`PAYROLL_MANAGE`, 204); `POST /:id/approve`, `POST /:id/void` (`PAYROLL_APPROVE`, 200); `POST /:id/pay` (`PAYROLL_PAY`, `paySettlementSchema`, 200).
- `AdvancesService.recovered` adds Σ `−amount` of `ADVANCE_RECOVERY` lines on the employee's APPROVED/PAID settlements.

Calculated lines (written by create and refresh; manual lines — NOTICE_PAY, ADDITION, DEDUCTION — are kept by refresh):
- Context: `employee` (must be LEFT with `leavingDate`, else 400 "Only employees who have left can be settled"); `pkg = packageAt(leavingDate)` (400 when none); `basic = pkg.basic`, `gross = packageGross(pkg)`; `t = gratuity.target(manager, tenantId, employee, periodBounds(leavingDate.slice(0, 7)).last)` — the final month's end, so `entitlement` stops service at the leaving date but still counts the final run's unpaid leave, and the result equals what that run trued the provision up to.
- Create also requires the final-month run (period `leavingDate.slice(0,7)`) to be posted with a line for the employee → 409 "Approve payroll for <Month YYYY> first: it is <name>'s final month"; a live settlement → 409 naming it.
- `GRATUITY`: `amount = settlementGratuity({ serviceDays: t.serviceDays, statutory: t.statutory, adjustments: t.adjustments })`, label "End-of-service gratuity (<years> years)".
- `LEAVE_ENCASHMENT`: `quantity = balanceDays` (on update, `leaveEncashmentDays` may lower it to between 0 and a positive balance; a negative balance cannot be changed — 400), `rate = basic / 30`, `amount = leaveEncashment({ days: quantity, basic })`.
- `NOTICE_PAY` (only when `noticeDays > 0`): `quantity = noticeDays`, `rate = gross / 30`, `amount = noticePay({ days, gross, direction })`, label "Notice pay in lieu" / "Notice not served".
- `ADVANCE_RECOVERY` (only when outstanding > 0): `amount = −min(input.advanceRecovery ?? outstanding, outstanding)`.
- `ADDITION` / `DEDUCTION` from `manualLines` (replace the set; DEDUCTION stored negative).
- Header: `serviceDays = t.serviceDays`, `basic`, `gross`, `leaveBalanceDays`, `netPay = round2(Σ amount)`, `paymentMethod = employee.paymentMethod`.

approve (one transaction: `lockSettlement`, then `lockGratuityOpening`):
- Must be DRAFT; re-check the final run is posted and no later posted run contains the employee (409).
- **Staleness:** recompute the GRATUITY amount, leave balance days and outstanding advances; if the gratuity amount or the balance days differ from the stored ones, or advance recovery exceeds outstanding → 409 "Balances changed since <number> was drafted; refresh it".
- `netPay < 0` → 400 "<name> owes more than the settlement pays; recover the difference outside payroll".
- Journal (`referenceType 'SETTLEMENT'`, `referenceId settlement.id`, `entryNumber 'JE-<number>'`, `entryDate` today UTC, base currency): with `gB = gratuity.balance`, `G` = GRATUITY amount, `lB = leave provisionBalance`, `L` = LEAVE_ENCASHMENT amount, `S = Σ` NOTICE_PAY + ADDITION + DEDUCTION, `A = |ADVANCE_RECOVERY|`:
  - `GRATUITY_PROVISION`: debit `gB` (credit `|gB|` if negative); `GRATUITY_EXPENSE`: `G − gB` (debit if positive, credit if negative).
  - `LEAVE_PROVISION`: debit `lB` (credit if negative); `LEAVE_EXPENSE`: `L − lB` signed the same way.
  - `SALARIES`: `S` signed (debit if positive).
  - `EMPLOYEE_ADVANCES`: credit `A`.
  - `SALARIES_PAYABLE`: credit `netPay`.
  - Zero lines dropped; `totalAmount` = Σ debits.
- Ledger rows: gratuity `SETTLEMENT { amount: −gB, asOf: leavingDate, settlementId, journalEntryId }` (when `gB ≠ 0`); leave `ENCASHMENT { days: −balanceDays, amount: −lB, asOf: leavingDate, settlementId, journalEntryId }` (when either is non-zero).
- Status APPROVED, `approvedAt/ById`, `journalEntryId` (targeted `update`).

void: APPROVED only (PAID → 409 "Paid settlements cannot be voided"); exact reversal dated `max(today, approval entry date)`; gratuity `REVERSAL { amount: +gB, settlementId }` and leave `REVERSAL { days, amount }` restoring both; status VOIDED, `voidJournalEntryId`.

pay: APPROVED only; base-currency account; `Dr SALARIES_PAYABLE / Cr account` for `netPay` (skip the journal when 0), balance decrement, `paymentJournalEntryId`, `financeAccountId`, `paidAt`, status PAID.

remove: DRAFT only (409 otherwise); deletes lines and the row.

`GratuityService.adjust` and `LeaveService.adjust`: an APPROVED/PAID settlement for the employee → 409 "<name> is settled".

statement: settlement DTO + employee block (masked IBAN via `maskIban`) + organization block, built like `PayrollRunsService.payslip`.

- [ ] **Step 1: Failing tests:**
  - create refuses an ACTIVE employee, a leaver whose final month is not posted, and a second live settlement.
  - create computes the gratuity (365+ days: statutory + adjustments; 200 days: 0 + adjustments), leave encashment on basic ÷ 30 (negative balance → deduction), advance recovery = −outstanding.
  - update: notice pay paid and deducted, lower encashment days, manual additions/deductions, net recomputed; raising encashment days above the balance → 400.
  - approve posts exactly these role amounts for (a) 3 years' service, positive leave balance, an advance and a notice deduction, and (b) 8 months' service (gratuity provision fully credited back to 6310); both balanced; gratuity and leave balances become 0.
  - **refuses to approve a stale settlement** after a gratuity adjustment → 409 "refresh it"; refresh then approve succeeds.
  - net < 0 → 400; approve twice → 409.
  - void restores both ledgers and the journal nets to zero; void after pay → 409; pay moves the balance and posts `Dr 2300 / Cr bank`.
  - advances: an approved settlement's recovery reduces `outstanding`.
  - gratuity/leave adjustments after settlement → 409.

- [ ] **Step 2–4:** FAIL → implement → PASS.

- [ ] **Step 5: Commit** — `feat(api): final settlement pays out gratuity and leave provisions`

---

### Task 14: API — WPS SIF export

**Files:**
- Create: `apps/api/src/modules/payroll/wps-export.service.ts`
- Test: `wps-export.service.spec.ts`, `apps/api/src/modules/audit/audit.interceptor.spec.ts` (one case)
- Modify: `payroll-runs.controller.ts`, `settlements.controller.ts`, `payroll.module.ts`

**Interfaces:**
- Consumes: `buildSif`, `sifIncomeSplit` (Task 4), `PayrollSettingsService.get`, `PayrollCryptoService.decrypt`, `baseCurrencyFor`.
- Produces: `WpsExportService.forRun(tenantId, runId): Promise<WpsSifDto>`, `.forSettlement(tenantId, settlementId): Promise<WpsSifDto>`; routes `POST /payroll-runs/:id/wps-sif` and `POST /settlements/:id/wps-sif` (`PAYROLL_PAY`, 200).

Rules:
- WPS off → 409 "WPS is switched off in payroll settings". Base currency not AED → 409 "WPS salary files are in AED; this organisation's base currency is <X>".
- Run must be APPROVED, PARTIALLY_PAID or PAID; settlement APPROVED or PAID (409 otherwise).
- Run rows: BANK lines only, ordered by employee number. Employee loaded withDeleted. `payStart = max(period first, joiningDate)`, `payEnd = min(period last, leavingDate)`, `days = line.daysEmployed`, `{ fixed, variable } = sifIncomeSplit(line.netPay, line.overtimeAmount + line.bonusAmount)`, `leaveDays = line.leaveDaysInPeriod`. Cash lines → warning "<name> is paid in cash and is not in the file".
- Settlement row: one row when the settlement's `paymentMethod` is BANK (else 409 "<number> is paid in cash"); `payStart = payEnd = leavingDate`, `days 0`, `fixed 0`, `variable = netPay`, `leaveDays 0`; `salaryMonth = leavingDate.slice(0,7)`.
- Pre-flight: each row needs `wpsPersonId`, `bankRoutingCode` and an IBAN that decrypts; collect every problem and throw `UnprocessableEntityException` with "Fix before exporting: <name>: WPS person ID missing; <name>: IBAN could not be read; …".
- `reference` = run number / settlement number; `createdAt = new Date()`.
- The SIF body never reaches the audit trail: the interceptor stores entity snapshots and request bodies, never responses (`audit.interceptor.ts` `write`). Pin it with a test.

- [ ] **Step 1: Failing tests:** a two-bank-one-cash run produces 2 EDR rows, an SCR whose total is Σ net of bank lines and a cash warning; an employee without a person ID → 422 naming them; a corrupt IBAN → 422; WPS off → 409; non-AED base → 409; DRAFT run → 409; settlement file has one row with variable = net; cash settlement → 409. In `audit.interceptor.spec.ts`: a `POST /payroll-runs/:id/wps-sif` whose handler returns `{ content: 'EDR,…' }` records an audit row whose `after` does not contain `'EDR'`.

- [ ] **Step 2–4:** FAIL → implement → PASS.

- [ ] **Step 5: Commit** — `feat(api): WPS salary information file for runs and settlements`

---

### Task 15: API — pension and settlements in the cash forecast

**Files:**
- Modify: `apps/api/src/modules/finance/finance.service.ts` (`cashForecast`), `apps/api/src/modules/finance/finance.module.ts` (register `PensionRemittance`, `Settlement` — entities only, no module import)
- Test: `apps/api/src/modules/finance/finance.service.spec.ts`

**Interfaces:**
- Produces: `CashForecastMonthDto.pensionOut` populated; `closing = opening + inflows − billsOut − recurringOut − payrollOut − pensionOut`.

Rules (computed in the service from repositories, not by calling payroll services):
- Pension: for each non-voided run that is posted, if no live remittance exists for its period: Σ (`pensionEmployee + pensionEmployer`) of its lines, bucketed on the 15th of the following month (overdue → month 1).
- Settlements: APPROVED (unpaid) settlements' `netPay` into `payrollOut`, bucketed on today (month 1).

- [ ] **Step 1: Failing tests:** an approved run with pension and no remittance shows `pensionOut` on the 15th of the next month; a remitted period shows none; an approved settlement adds its net to month 1's `payrollOut`; a paid one adds nothing; closing subtracts `pensionOut`.

- [ ] **Step 2–4:** FAIL → implement → PASS (`corepack pnpm --filter api exec jest src/modules/finance`).

- [ ] **Step 5: Commit** — `feat(api): pension remittances and settlements in the cash forecast`

---

### Task 16: API — seed compliance

**Files:**
- Modify: `apps/api/src/database/seeds/run-seed.ts` (`seedPayroll` and `assertPayrollSeeded`)

**Interfaces:**
- Consumes: `PayrollSettingsService.put`, `PensionService.list/update`, `EmployeesService.update`, `LeaveRecordsService.create`, `LeaveService.previewOpening/postOpening`, `PensionRemittanceService.remit`, `SettlementsService.create/approve/pay`, `WpsExportService.forRun`.

Changes inside `seedPayroll`, in this order (the demo org's base currency is USD, so the profile is saved but no SIF is exported — see 9):
1. Settings: `put(payrollSettingsSchema.parse({ wpsEnabled: true, employerIdType: 'MOHRE', employerId: '0000001234567', payerRoutingCode: '803320101', annualLeaveDays: 30 }))`.
2. Add a seventh employee before the openings: `Hassan Qureshi`, Technician, `yearsAgo(3)`, BANK, IBAN `AE070331234567890123454`, basic 5,500, housing 1,650, transport 500.
3. All BANK employees get `wpsPersonId` `1000000000000<n>` (14 digits) and `bankRoutingCode '803320101'` via `employees.update`.
4. `pension.list(tenantId)`; activate the `GPSSA_2023` preset (`update(id, { isActive: true })`); assign it to Mariam (`employees.update(…, { pensionSchemeId })`).
5. After the gratuity opening: leave opening at the same cut-over with each preview line's `calculatedDays − 5` (five days taken before go-live; floored at 0).
6. Hassan leaves: `employees.update(…, { status: 'LEFT', leavingDate: '<lastPeriod>-20' })` — after both openings, before the run.
7. Leave records in last month: Priya ANNUAL 3 days (the 6th–8th); Layla SICK 2 days (the 12th–13th).
8. Create, edit (as today), approve and pay the run; then `remit` last month's pension from the bank account; then Hassan's settlement: create (`RESIGNATION`), approve, pay from the bank account.
9. Do not call `forRun` against the USD org (it would 409 on currency); assert instead that the run's line for Mariam has `pensionEmployee > 0` and every BANK line's employee has a `wpsPersonId`.

`assertPayrollSeeded` changes:
- `GRATUITY_PROVISION` ledger balance must equal Σ amount of **all** gratuity rows (now includes SETTLEMENT); `LEAVE_PROVISION` balance = Σ amount of leave ledger rows; `PENSION_PAYABLE` balance = 0 (remitted).
- No line is flagged (Mariam now has a scheme) — replace the "only the national flagged" check.
- Hassan's settlement is PAID and his gratuity and leave balances are both 0.
- `JE-PENSION-<lastPeriod>` and `JE-<settlement number>` exist.

- [ ] **Step 1:** implement. **Step 2:** `corepack pnpm --filter api build && corepack pnpm --filter api test` → PASS (the seed is not runnable locally; CI's schema job runs `seed` and `check:books`). Note this in the commit body.
- [ ] **Step 3: Commit** — `feat(api): seed leave, pension, a settled leaver and WPS details`

---

### Task 17: Web — settings, pension schemes, employee fields, Leave and Pension tabs

**Files:**
- Create: `apps/web/src/app/(app)/people/settings/page.tsx`, `apps/web/src/components/people/payroll-settings-view.tsx`, `employee-leave-tab.tsx`, `leave-record-modal.tsx`, `employee-pension-tab.tsx`
- Modify: `apps/web/src/lib/api/endpoints/payroll.ts`, `apps/web/src/hooks/use-payroll.ts`, `people-nav.tsx`, `employee-detail.tsx`, `employee-form-modal.tsx`
- Test: `payroll-settings-view.spec.tsx`, `employee-leave-tab.spec.tsx`, extend `employee-detail.spec.tsx`

**Interfaces:**
- Endpoints: `api.payroll.settings()`, `.saveSettings(input)`, `.pensionSchemes()`, `.createPensionScheme(input)`, `.updatePensionScheme(id, input)`, `.deletePensionScheme(id)`; `api.employees.leave(id)`, `.createLeaveRecord(id, input)`, `.updateLeaveRecord(id, recordId, input)`, `.deleteLeaveRecord(id, recordId)`, `.adjustLeave(id, input)`.
- Hooks: `usePayrollSettings()`, `useSavePayrollSettings()`, `usePensionSchemes()`, `useCreatePensionScheme()`, `useUpdatePensionScheme()`, `useDeletePensionScheme()`, `useEmployeeLeave(id)`, `useCreateLeaveRecord()`, `useUpdateLeaveRecord()`, `useDeleteLeaveRecord()`, `useAdjustLeave()`. Leave mutations invalidate `['employees']` and `['payroll']` (drafts are re-filled).

Rules:
- Read `apps/web/AGENTS.md` first. Pages are thin `PageGuard` wrappers like `app/(app)/people/employees/page.tsx`.
- Nav: add **Settlements** (`/people/settlements`, `PAYROLL_READ`) and **Settings** (`/people/settings`, `PAYROLL_READ`) to `PEOPLE_NAV_ITEMS`.
- Settings page: WPS card (switch; when on: employer ID type select, employer ID, payer routing code; help text: "MOHRE: 13-digit establishment ID; free zone: the authority's ID"), annual leave days (30–60). Form: `useForm<PayrollSettingsInput, unknown, PayrollSettingsPayload>` with `zodResolver(payrollSettingsSchema)`; read-only without `PAYROLL_MANAGE`. Pension schemes table (name, employee %, employer %, base, min, max, active, assigned) with Activate/Deactivate, Edit (modal) and Delete (disabled with a tooltip when assigned) for `PAYROLL_MANAGE`, plus a one-line note "Presets start inactive — check the rates with the fund before activating".
- Employee form: new fields WPS person ID, bank routing code (bank payees only), probation end date, annual leave days override; pension scheme select (active schemes only) shown only when "UAE/GCC national" is ticked. `diffEmployee` includes the new fields.
- Employee detail tabs: **Leave** (`EMPLOYEE_READ`): balance in days, annual days, provision (only when present in the DTO), records table (type badge, dates, days, note) with Add/Edit/Delete for `EMPLOYEE_MANAGE` via `leave-record-modal.tsx` (`useForm<LeaveRecordFormInput, unknown, LeaveRecordPayload>`; server 409/400 messages shown inline), ledger table, "Adjust days" for `PAYROLL_APPROVE`; attachments panel per record (`ownerType="LEAVE_RECORD"`) for `EMPLOYEE_MANAGE`. **Pension** (`PAYROLL_READ`, nationals only): scheme name and rates, link to Settings.
- Profile tab shows WPS person ID, routing code, probation end.

- [ ] **Step 1: Tests** — settings view: WPS fields hidden when off, read-only without `PAYROLL_MANAGE`, Delete disabled for an assigned scheme. Leave tab: shows balance and records; Add hidden without `EMPLOYEE_MANAGE`; provision hidden when the DTO omits it. Employee detail: Pension tab only for nationals with `PAYROLL_READ`. Follow the mocking pattern in `employee-detail.spec.tsx`.
- [ ] **Step 2:** implement until `corepack pnpm --filter web exec tsc --noEmit` is clean and `corepack pnpm --filter web test` passes (pre-existing `drawers.spec.tsx` failure excepted).
- [ ] **Step 3: Commit** — `feat(web): payroll settings, pension schemes and employee leave`

---

### Task 18: Web — runs: leave and pension columns, SIF export, pension panel, opening leave, forecast series

**Files:**
- Create: `apps/web/src/app/(app)/people/payroll/opening-leave/page.tsx`, `apps/web/src/components/people/opening-leave-view.tsx`, `pension-panel.tsx`, `download-sif.ts`
- Modify: `payroll-run-detail.tsx`, `payroll-line-editor.tsx`, `payroll-runs-view.tsx`, `apps/web/src/lib/api/endpoints/payroll.ts`, `apps/web/src/hooks/use-payroll.ts`, `apps/web/src/components/finance/dashboard/cash-forecast-chart.tsx`
- Test: extend `payroll.spec.tsx`, `payroll-line-editor.spec.tsx`; `opening-leave-view.spec.tsx`; `pension-panel.spec.tsx`

**Interfaces:**
- Endpoints/hooks: `runSif(id)` / `useRunSif()`, `pensionPeriod(period)` / `usePensionPeriod(period)`, `remitPension(period, input)` / `useRemitPension()`, `voidPension(period)` / `useVoidPension()`, `previewOpeningLeave(cutover?)` / `useOpeningLeavePreview(cutover?)`, `postOpeningLeave(input)` / `usePostOpeningLeave()`.
- `download-sif.ts`: `downloadSif(dto: WpsSifDto): void` — `Blob([content], { type: 'text/plain' })`, object URL, a temporary `<a download={fileName}>`, revoke after click; warnings shown with `toast.warning`.

Rules:
- Line editor: new editable "Half-pay days" next to unpaid days; an "auto" badge on the leave cells while `leaveOverridden` is false and a "Use leave records" action (sends `{ leaveOverridden: false }`) when true; read-only columns for annual days, pension (employee share) and, after approval, leave provision change. Flag labels: `NATIONAL_NO_PENSION_SCHEME: 'No pension scheme'`, `LEAVE_IN_ADVANCE: 'Leave in advance'` (remove the old `NATIONAL_PENSION_NOT_HANDLED` label).
- Run header totals add half pay, pension (employee + employer) and leave provision.
- **Export SIF** button on APPROVED/PARTIALLY_PAID/PAID runs for `PAYROLL_PAY`; disabled with the reason "Switch on WPS in payroll settings" when `usePayrollSettings().data?.wpsEnabled` is false; a 422 shows its message in a toast.
- **Pension panel** on the run detail when the run is posted and has pension: employee/employer totals, due, remittance status; Remit (modal: base-currency finance account, date) and Void for `PAYROLL_PAY`.
- **Opening leave page** (view `PAYROLL_MANAGE`, post `PAYROLL_APPROVE`): copy `opening-gratuity-view.tsx` — cut-over date, preview with editable balance days (default calculated, negatives allowed), Post with confirm. Link from the Payroll list ("Set up opening leave balances") while no run is posted.
- Forecast chart: add the `pensionOut` series (stacked under payroll, own token colour, legend entry) and include it in the text summary and `maxDown`/`hasData`.

- [ ] **Step 1: Tests** — line editor: auto badge shown until edited; "Use leave records" sends `{ leaveOverridden: false }`; flag labels. Run detail: Export SIF disabled when WPS is off and hidden without `PAYROLL_PAY`. Pension panel: Remit hidden without `PAYROLL_PAY`, shows "Remitted" when a remittance exists. Opening leave: Post disabled without `PAYROLL_APPROVE`. Forecast summary mentions pension.
- [ ] **Step 2:** implement; web tsc clean; web tests pass.
- [ ] **Step 3: Commit** — `feat(web): leave and pension on payroll runs, SIF export, opening leave`

---

### Task 19: Web — settlements

**Files:**
- Create: `apps/web/src/app/(app)/people/settlements/page.tsx`, `.../[id]/page.tsx`, `.../[id]/statement/page.tsx`; `apps/web/src/components/people/settlements-view.tsx`, `settlement-detail.tsx`, `settlement-statement.tsx`
- Modify: `apps/web/src/lib/api/endpoints/payroll.ts`, `apps/web/src/hooks/use-payroll.ts`
- Test: `settlements.spec.tsx`

**Interfaces:**
- Endpoints/hooks: `settlements()` / `useSettlements()`, `settlement(id)` / `useSettlement(id)`, `settlementStatement(id)` / `useSettlementStatement(id)`, `createSettlement` / `useCreateSettlement()`, `updateSettlement` / `useUpdateSettlement()`, `refreshSettlement` / `useRefreshSettlement()`, `deleteSettlement` / `useDeleteSettlement()`, `approveSettlement` / `useApproveSettlement()`, `voidSettlement` / `useVoidSettlement()`, `paySettlement` / `usePaySettlement()`, `settlementSif` / `useSettlementSif()`. All mutations invalidate `['settlements']`, `['employees']`, `['payroll']`, `['finance']`.

Rules:
- List: number, employee, leaving date, reason, status badge, net. "New settlement" (`PAYROLL_MANAGE`) modal: select from LEFT employees without a live settlement (from `useEmployees({ status: 'LEFT' })` filtered against the list), reason select; server 409s (final month not posted) shown inline.
- Detail: header (service in years and days, basic, gross, leave balance), lines table; while DRAFT and `PAYROLL_MANAGE`: reason, leave encashment days (number, hidden when the balance is negative), notice days + paid/deducted toggle, advance recovery, manual lines editor (add/remove ADDITION/DEDUCTION with label and amount) — one `useForm<UpdateSettlementInput, unknown, UpdateSettlementPayload>` saved with a Save button; Refresh; Delete. Actions by status/permission: Approve (DRAFT, `PAYROLL_APPROVE`, confirm with net), Void (APPROVED, `PAYROLL_APPROVE`), Pay (APPROVED, `PAYROLL_PAY`, modal with base-currency account and date — reuse `pay-run-modal.tsx`'s account select), Export SIF (APPROVED/PAID, BANK, `PAYROLL_PAY`, same disabled rule as runs, via `downloadSif`), Statement link.
- Statement page: print layout like `payslip-view.tsx` (company, employee, service period, reason, each line, net, masked IBAN), Print button.

- [ ] **Step 1: Tests** — list renders rows; New hidden without `PAYROLL_MANAGE`; detail edits disabled when not DRAFT; Approve hidden without `PAYROLL_APPROVE`; Pay only for APPROVED; statement shows net and masked IBAN.
- [ ] **Step 2:** implement; web tsc clean; web tests pass.
- [ ] **Step 3: Commit** — `feat(web): final settlements with statements`

---

### Task 20: Docs and final verification

**Files:**
- Modify: `docs/FLAGS.md` — replace the two "open (#3)" bullets in "Employees and payroll" (GPSSA, WPS/leave/settlement) with pointers to a new "UAE payroll compliance" section, same style.

- [ ] **Step 1: FLAGS bullets** (one each, with the reason):
  - Leave is in calendar days; public holidays and working-day counting are not modelled.
  - Leave records are entered by HR; no employee self-service or approval workflow.
  - Annual leave carries forward without expiry or cap.
  - Leave records lock once their month's run is posted (void the run to change them) and once the employee is settled.
  - Sick leave beyond 90 days in a service year is refused — record the employee as having left.
  - Opening leave is not blocked by runs posted before this release (they carry no leave rows); it is refused per employee once a run has accrued their leave.
  - Pension presets start inactive and must be confirmed against the fund's current rates; the government's 2.5% GPSSA top-up is not modelled; GCC nationals need a custom scheme.
  - Approval applies each national's current active scheme; a national without one blocks approval.
  - A run cannot be voided while its month's pension is remitted or a leaver on it is settled.
  - Settlement needs the leaver's final month posted; a settlement with negative net is refused (recover outside payroll); a paid settlement cannot be voided.
  - WPS files follow the standard MOHRE SIF layout; agent-specific variants are not produced; AED base currency only; cash-paid employees are left out with a warning.
  - The SIF is returned to the browser and never stored; the export is audited.
- [ ] **Step 2: Verify** — `corepack pnpm --filter @saas/shared build && corepack pnpm --filter @saas/shared test && corepack pnpm --filter api test && corepack pnpm --filter api build && corepack pnpm --filter web exec tsc --noEmit && corepack pnpm --filter web test` (the `drawers.spec.tsx` failure is pre-existing on master). DB checks run in CI (`migration:run`, `check:drift`, `seed`, `check:books`).
- [ ] **Step 3: Commit** — `docs: flag UAE compliance trade-offs`
