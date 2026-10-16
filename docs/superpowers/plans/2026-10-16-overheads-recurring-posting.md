# Overheads That Post — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recurring expenses generate supplier bills when due, expense categories post to their own ledger accounts (cost-of-sales to COGS), and costs covering more than a month are spread through Prepaid expenses — so the P&L shows true monthly profit and finance has a real cash forecast.

**Architecture:** Pure logic (account list, category→role map, schedule maths, prepaid split, bill posting lines, zod schemas) lives in `packages/shared` and is unit-tested with vitest. The API adds columns/tables by migration, routes postings through existing `LedgerService.resolveLines`, creates prepaid schedules inside `PayablesService.approve`, and runs a daily `@Cron` in a new `OverheadsModule` that generates bills and releases prepaid months using the claim-by-unique-insert pattern from `invoice-overdue.service.ts`. The web app rebuilds the subscription modal on react-hook-form + shared zod and adds bill-line spreading, P&L indentation and a cash forecast chart.

**Tech Stack:** NestJS 11, TypeORM 1, Postgres 18 (FORCE RLS), `@nestjs/schedule`, zod 4, vitest (shared), jest (api), Next.js 16 + react-hook-form + TanStack Query (web).

**Spec:** `docs/superpowers/specs/2026-10-16-overheads-recurring-posting-design.md`

## Global Constraints

- Permissions come only from `PERMISSIONS` in `@saas/shared`; never hand-write a permission string. No new permission constants in this plan.
- After any edit in `packages/shared`, run `pnpm --filter @saas/shared build` before running API or web tests.
- Every tenant query is scoped by `tenantId`; background jobs scan with `tenantContext.runAsSystem` and work inside `tenantContext.runWithTenant(row.tenantId, …)`.
- Migrations touching tenant data start with `SELECT set_config('app.bypass_rls','on',true)`.
- New tenant tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` with the same policy shape as `recurring_expenses` in `1787600000000-EnablePostgresRowLevelSecurity.ts`.
- The ledger is append-only: never UPDATE `journal_entries`; corrections post new entries.
- Schema is migration-owned (`DB_SYNCHRONIZE=false`). After entity changes, `pnpm migration:generate` against a migrated DB must report no drift, and `pnpm check:drift` must pass.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Plan-time resolutions of spec "verify" items:** organizations have **no timezone column**, so "today" is the UTC calendar date. The finance audit keys are `finance/subscriptions`, `finance/expenses`, `finance/accounts`, `finance/prepaid-schedules`.
- **Plan-time refinement of the auto-approve actor:** instead of an anonymous system actor, auto-approval runs **as the user who switched auto-approve on** (`autoApproveById`), with that user's permissions re-resolved by `RbacService.resolveAccess` at run time. If they no longer hold `bill:approve` (or are gone), the bill stays DRAFT and finance managers are notified. This is stricter than the spec and keeps `approvedById` a real user.

## Review Focus

1. **Foreign-currency supplier on a spread bill** — prepaid released in base currency must clear 1400 to exactly zero. Test: Task 9 "schedule total uses the bill's fx rate".
2. **Tenant that already owns code 6100 (or any new code)** — postings must fall back to 6000 instead of 404-ing the bill approval. Test: Task 6 "falls back to operating expense when a category role is missing".
3. **Service period crossing a year boundary / starting mid-month** (15 Dec → 14 Dec next year = 13 calendar months touched; 1 Jan → 31 Dec = 12). Test: Task 4 `monthsTouched` cases.
4. **Mixed bill: PO-matched line + spread line + category line + tax** — one balanced entry with GRNI, prepaid, category role, tax, AP. Test: Task 4 "mixed bill balances".
5. **Amount edited after occurrences exist** — earlier bills unchanged, next occurrence uses the new amount; `startDate`/interval edit refused. Test: Task 10 "edit after first occurrence".

---

## File Structure

**Shared (`packages/shared/src/`)**
- Modify `finance/ledger.ts` — new roles, accounts, `parentCode`, `'PREPAID'` reference type.
- Modify `finance/expense-categories.ts` — `expenseCategoryRole()`, `LEGACY_SUBSCRIPTION_CATEGORIES`.
- Create `finance/recurring.ts` — interval maths, occurrence/period helpers, prepaid split.
- Create `schemas/recurring-expense.ts` — create/update zod schemas and types.
- Modify `schemas/bill.ts` — line `category`, `servicePeriodStart/End`.
- Modify `payables/matching.ts` — `BillLineForPosting` gains `category`/`servicePeriod*`; `billPostingLines` routes by role and to prepaid; `isSpread()`.
- Modify `finance/types.ts` — `RecurringExpenseDto`, `RecurringOccurrenceDto`, `PrepaidScheduleDto`, `CashForecastDto`, `BillingInterval`.
- Modify `finance/currency.ts` — `StatementLineDto.parentId`.
- Modify `index.ts` — export new files.

**API (`apps/api/src/`)**
- Create `database/migrations/1789900000000-ExpenseAccountsAndPrepaid.ts` — accounts backfill, rename 6000, parents.
- Create `database/migrations/1789900000001-RecurringBillingAndPrepaid.ts` — recurring columns, occurrences, bill-line columns, prepaid tables, enum values, supplier match, category mapping.
- Modify `modules/finance/ledger.service.ts` — provisioning (`parentCode`, code-or-role dedupe), category-role fallback.
- Modify `modules/finance/expenses.service.ts` — accrual uses `expenseCategoryRole`.
- Modify `modules/finance/workflows/expense-approval.workflow.ts:194` — same.
- Modify `modules/finance/entities/recurring-expense.entity.ts`; create `entities/recurring-expense-occurrence.entity.ts`.
- Modify `modules/finance/entities/journal-entry.entity.ts` — `'PREPAID'`.
- Modify `modules/payables/entities/supplier-bill.entity.ts` — line columns; create `modules/payables/entities/prepaid-schedule.entity.ts` (`PrepaidSchedule`, `PrepaidAmortization`).
- Modify `modules/payables/payables.service.ts` — persist new line fields; nullable actor on create; create schedules on approve.
- Modify `modules/finance/finance.service.ts`, `finance.controller.ts` — subscription CRUD, runway fix, cash forecast.
- Create `modules/overheads/overheads.module.ts`, `recurring-billing.service.ts`, `prepaid.service.ts`, `prepaid.controller.ts` (+ specs).
- Modify `modules/audit/audit-subjects.ts`, `audit.interceptor.ts` — two-segment keys.
- Modify `modules/finance/reports.service.ts` — `parentId` on statement lines.
- Modify `database/seeds/run-seed.ts` — annual rent recurring expense.
- Modify `app.module.ts` — import `OverheadsModule`.

**Web (`apps/web/src/`)**
- Modify `lib/api/endpoints/finance.ts`, `hooks/use-finance.ts`.
- Rewrite `components/finance/subscriptions/create-subscription-modal.tsx` → `subscription-form-modal.tsx`; modify `subscriptions-view.tsx`, `subscriptions-table.tsx`.
- Modify the bill form and bill detail components (located in Task 17 step 1).
- Modify `components/finance/reports/reports-view.tsx`.
- Create `components/finance/dashboard/cash-forecast-chart.tsx`; modify `finance-overview-view.tsx`.

**Docs:** `docs/FLAGS.md`.

---

### Task 1: Shared — new system accounts, roles, parent codes

**Files:**
- Modify: `packages/shared/src/finance/ledger.ts:37-166`, and `JournalReferenceType`
- Test: `packages/shared/src/finance/ledger.test.ts` (create)

**Interfaces:**
- Produces: `LEDGER_ROLES.{PREPAID_EXPENSES,RENT,UTILITIES,SALARIES,REPAIRS,INSURANCE,TRAVEL,SOFTWARE_IT,MARKETING,PROFESSIONAL_FEES,BANK_CHARGES}`; `SystemLedgerAccount.parentCode?: string`; `JournalReferenceType` includes `'PREPAID'`; `OPERATING_EXPENSE_CHILD_ROLES: LedgerRole[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/finance/ledger.test.ts
import { describe, expect, it } from 'vitest';
import { LEDGER_ROLES, SYSTEM_LEDGER_ACCOUNTS, OPERATING_EXPENSE_CHILD_ROLES } from './ledger';

describe('system chart of accounts', () => {
  it('has unique codes and unique roles', () => {
    const codes = SYSTEM_LEDGER_ACCOUNTS.map((a) => a.code);
    const roles = SYSTEM_LEDGER_ACCOUNTS.map((a) => a.role);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('nests every overhead account under 6000 and only those', () => {
    const children = SYSTEM_LEDGER_ACCOUNTS.filter((a) => a.parentCode === '6000');
    expect(children.map((a) => a.role).sort()).toEqual([...OPERATING_EXPENSE_CHILD_ROLES].sort());
    for (const child of children) expect(child.type).toBe('EXPENSE');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared exec vitest run src/finance/ledger.test.ts`
Expected: FAIL — `OPERATING_EXPENSE_CHILD_ROLES` is not exported.

- [ ] **Step 3: Implement**

In `LEDGER_ROLES` add after `OPERATING_EXPENSE`:

```ts
  PREPAID_EXPENSES: 'PREPAID_EXPENSES',
  RENT: 'RENT',
  UTILITIES: 'UTILITIES',
  SALARIES: 'SALARIES',
  REPAIRS: 'REPAIRS',
  INSURANCE: 'INSURANCE',
  TRAVEL: 'TRAVEL',
  SOFTWARE_IT: 'SOFTWARE_IT',
  MARKETING: 'MARKETING',
  PROFESSIONAL_FEES: 'PROFESSIONAL_FEES',
  BANK_CHARGES: 'BANK_CHARGES',
```

Extend the interface:

```ts
export interface SystemLedgerAccount {
  code: string;
  name: string;
  type: LedgerAccountType;
  role: LedgerRole;
  description: string;
  /** Code of the system account this one rolls up into on the P&L. */
  parentCode?: string;
}
```

Insert after the `1300` entry:

```ts
  {
    code: '1400',
    name: 'Prepaid expenses',
    type: 'ASSET',
    role: LEDGER_ROLES.PREPAID_EXPENSES,
    description: 'Paid or billed ahead for a period not yet used — an annual lease, a yearly policy. Released to expense one month at a time.',
  },
```

Change the `6000` entry name to `'Other operating expense'` and description to `'Overheads with no account of their own. Parent of the overhead accounts below.'`, then insert after it:

```ts
  { code: '6100', name: 'Rent & premises', type: 'EXPENSE', role: LEDGER_ROLES.RENT, parentCode: '6000', description: 'Rent, service charges and premises costs' },
  { code: '6200', name: 'Utilities & telecom', type: 'EXPENSE', role: LEDGER_ROLES.UTILITIES, parentCode: '6000', description: 'Electricity, water, cooling, internet and phones' },
  { code: '6300', name: 'Salaries & wages', type: 'EXPENSE', role: LEDGER_ROLES.SALARIES, parentCode: '6000', description: 'Payroll, allowances and contractors' },
  { code: '6400', name: 'Repairs & maintenance', type: 'EXPENSE', role: LEDGER_ROLES.REPAIRS, parentCode: '6000', description: 'Upkeep of premises, plant and machinery' },
  { code: '6450', name: 'Insurance', type: 'EXPENSE', role: LEDGER_ROLES.INSURANCE, parentCode: '6000', description: 'Insurance premiums' },
  { code: '6500', name: 'Travel & entertainment', type: 'EXPENSE', role: LEDGER_ROLES.TRAVEL, parentCode: '6000', description: 'Travel, lodging, meals and entertainment' },
  { code: '6600', name: 'Software & IT', type: 'EXPENSE', role: LEDGER_ROLES.SOFTWARE_IT, parentCode: '6000', description: 'Software subscriptions, hosting and IT equipment below the capitalisation threshold' },
  { code: '6700', name: 'Marketing', type: 'EXPENSE', role: LEDGER_ROLES.MARKETING, parentCode: '6000', description: 'Advertising and marketing' },
  { code: '6800', name: 'Professional fees', type: 'EXPENSE', role: LEDGER_ROLES.PROFESSIONAL_FEES, parentCode: '6000', description: 'Accounting, legal and consulting fees' },
  { code: '6900', name: 'Bank charges', type: 'EXPENSE', role: LEDGER_ROLES.BANK_CHARGES, parentCode: '6000', description: 'Bank and payment processing fees' },
```

After the array:

```ts
/** The overhead roles that roll up into 6000 Other operating expense. */
export const OPERATING_EXPENSE_CHILD_ROLES: LedgerRole[] = SYSTEM_LEDGER_ACCOUNTS
  .filter((a) => a.parentCode === '6000')
  .map((a) => a.role);
```

Add `| 'PREPAID'` to `JournalReferenceType`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @saas/shared test`
Expected: PASS (all shared tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/finance/ledger.ts packages/shared/src/finance/ledger.test.ts
git commit -m "feat(shared): overhead expense accounts, prepaid expenses, PREPAID reference type"
```

---

### Task 2: Shared — category → ledger role

**Files:**
- Modify: `packages/shared/src/finance/expense-categories.ts`
- Test: `packages/shared/src/finance/expense-categories.test.ts`

**Interfaces:**
- Consumes: `LEDGER_ROLES`, `LedgerRole` (Task 1).
- Produces: `expenseCategoryRole(category: string | null | undefined): LedgerRole`; `LEGACY_SUBSCRIPTION_CATEGORIES: Record<string, string>`.

- [ ] **Step 1: Write the failing tests** (append to the existing describe file)

```ts
import { expenseCategoryRole, LEGACY_SUBSCRIPTION_CATEGORIES, EXPENSE_CATEGORIES } from './expense-categories';
import { LEDGER_ROLES } from './ledger';

describe('expenseCategoryRole', () => {
  it.each([
    ['Raw materials', LEDGER_ROLES.COGS],
    ['Freight & shipping', LEDGER_ROLES.COGS],
    ['Rent & premises', LEDGER_ROLES.RENT],
    ['Utilities & Telecom', LEDGER_ROLES.UTILITIES],
    ['Payroll & Contractors', LEDGER_ROLES.SALARIES],
    ['Plant & machinery', LEDGER_ROLES.REPAIRS],
    ['Meals & Entertainment', LEDGER_ROLES.TRAVEL],
    ['Hardware & Equipment', LEDGER_ROLES.SOFTWARE_IT],
    ['Bank charges', LEDGER_ROLES.BANK_CHARGES],
    ['Office Supplies', LEDGER_ROLES.OPERATING_EXPENSE],
  ])('%s → %s', (category, role) => {
    expect(expenseCategoryRole(category)).toBe(role);
  });

  it('resolves legacy short names first', () => {
    expect(expenseCategoryRole('Travel')).toBe(LEDGER_ROLES.TRAVEL);
    expect(expenseCategoryRole(' Utilities ')).toBe(LEDGER_ROLES.UTILITIES);
  });

  it('falls back to operating expense for anything unknown or empty', () => {
    expect(expenseCategoryRole('Kiln firing')).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
    expect(expenseCategoryRole('')).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
    expect(expenseCategoryRole(null)).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
  });

  it('maps every old subscription-modal category onto the shared list', () => {
    for (const target of Object.values(LEGACY_SUBSCRIPTION_CATEGORIES)) {
      expect(EXPENSE_CATEGORIES).toContain(target);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @saas/shared exec vitest run src/finance/expense-categories.test.ts`
Expected: FAIL — `expenseCategoryRole` not exported.

- [ ] **Step 3: Implement** (append to `expense-categories.ts`)

```ts
import { LEDGER_ROLES, type LedgerRole } from './ledger';

/**
 * Which account a category posts to. Cost-of-sales categories are direct
 * costs and land in COGS so gross margin is real; overheads land in their own
 * account under 6000. Anything unrecognised — the list is open, people type
 * their own — falls back to 6000 so a posting never fails on a label.
 */
const CATEGORY_ROLE: Record<string, LedgerRole> = {
  'Raw materials': LEDGER_ROLES.COGS,
  Packaging: LEDGER_ROLES.COGS,
  Consumables: LEDGER_ROLES.COGS,
  Subcontract: LEDGER_ROLES.COGS,
  'Freight & shipping': LEDGER_ROLES.COGS,
  Tooling: LEDGER_ROLES.COGS,
  'Rent & premises': LEDGER_ROLES.RENT,
  'Utilities & Telecom': LEDGER_ROLES.UTILITIES,
  'Payroll & Contractors': LEDGER_ROLES.SALARIES,
  'Repairs & maintenance': LEDGER_ROLES.REPAIRS,
  'Plant & machinery': LEDGER_ROLES.REPAIRS,
  Insurance: LEDGER_ROLES.INSURANCE,
  'Travel & Lodging': LEDGER_ROLES.TRAVEL,
  'Meals & Entertainment': LEDGER_ROLES.TRAVEL,
  'Software & SaaS': LEDGER_ROLES.SOFTWARE_IT,
  'Hardware & Equipment': LEDGER_ROLES.SOFTWARE_IT,
  'Marketing & Advertising': LEDGER_ROLES.MARKETING,
  'Professional Services': LEDGER_ROLES.PROFESSIONAL_FEES,
  'Bank charges': LEDGER_ROLES.BANK_CHARGES,
};

export function expenseCategoryRole(category: string | null | undefined): LedgerRole {
  if (!category) return LEDGER_ROLES.OPERATING_EXPENSE;
  return CATEGORY_ROLE[normaliseExpenseCategory(category)] ?? LEDGER_ROLES.OPERATING_EXPENSE;
}

/** The subscription modal's old private list, mapped onto the shared one (used by the migration and the form). */
export const LEGACY_SUBSCRIPTION_CATEGORIES: Record<string, string> = {
  'Cloud Infrastructure': 'Software & SaaS',
  'Marketing Tools': 'Marketing & Advertising',
  'Security & Compliance': 'Software & SaaS',
  'Communication & Collaboration': 'Software & SaaS',
  'Customer Support': 'Software & SaaS',
  'Design & Creative': 'Software & SaaS',
  'Office Utilities': 'Utilities & Telecom',
};
```

Also extend `normaliseExpenseCategory` to consult `LEGACY_SUBSCRIPTION_CATEGORIES` after `LEGACY_CATEGORY_ALIASES`:

```ts
export function normaliseExpenseCategory(category: string): string {
  const trimmed = category.trim();
  return LEGACY_CATEGORY_ALIASES[trimmed] ?? LEGACY_SUBSCRIPTION_CATEGORIES[trimmed] ?? trimmed;
}
```

(Move the `LEGACY_SUBSCRIPTION_CATEGORIES` const above `normaliseExpenseCategory`.)

- [ ] **Step 4: Run tests** — `pnpm --filter @saas/shared test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/finance/expense-categories.ts packages/shared/src/finance/expense-categories.test.ts
git commit -m "feat(shared): route expense categories to their own ledger roles, cost of sales to COGS"
```

---

### Task 3: Shared — recurring schedule maths

**Files:**
- Create: `packages/shared/src/finance/recurring.ts`
- Test: `packages/shared/src/finance/recurring.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './finance/recurring';`)

**Interfaces:**
- Produces:
  - `type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL'`; `BILLING_INTERVALS: BillingInterval[]`
  - `monthsPerInterval(i: BillingInterval): number`
  - `monthlyEquivalent(amount: number, i: BillingInterval): number`
  - `addMonthsClamped(anchor: string, months: number): string` — ISO `YYYY-MM-DD` in, out; day clamped to month end, always from the anchor's day.
  - `occurrenceDate(startDate: string, n: number, i: BillingInterval): string`
  - `periodFor(startDate: string, n: number, i: BillingInterval): { start: string; end: string }` — end = next occurrence − 1 day.
  - `dueOccurrences(args: { startDate: string; endDate: string | null; interval: BillingInterval; fromIndex: number; today: string }): number[]` — indexes `n ≥ fromIndex` with `occurrenceDate ≤ today` and `< endDate`.
  - `occurrenceIndexOnOrAfter(startDate: string, i: BillingInterval, date: string): number`
  - `utcToday(now?: Date): string`
  - `isoDate(d: Date): string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/finance/recurring.test.ts
import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped, dueOccurrences, monthlyEquivalent, monthsPerInterval,
  occurrenceDate, occurrenceIndexOnOrAfter, periodFor,
} from './recurring';

describe('recurring schedule maths', () => {
  it('knows the length of each interval', () => {
    expect([monthsPerInterval('MONTHLY'), monthsPerInterval('QUARTERLY'), monthsPerInterval('SEMI_ANNUAL'), monthsPerInterval('ANNUAL')]).toEqual([1, 3, 6, 12]);
    expect(monthlyEquivalent(120_000, 'ANNUAL')).toBe(10_000);
    expect(monthlyEquivalent(30_000, 'QUARTERLY')).toBe(10_000);
  });

  it('clamps to month end without drifting off the anchor day', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(occurrenceDate('2026-01-31', 2, 'MONTHLY')).toBe('2026-03-31');
  });

  it('handles an annual schedule anchored on 29 February', () => {
    expect(occurrenceDate('2028-02-29', 1, 'ANNUAL')).toBe('2029-02-28');
    expect(occurrenceDate('2028-02-29', 4, 'ANNUAL')).toBe('2032-02-29');
  });

  it('gives each period from its occurrence to the day before the next', () => {
    expect(periodFor('2026-01-01', 0, 'ANNUAL')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodFor('2026-01-31', 0, 'MONTHLY')).toEqual({ start: '2026-01-31', end: '2026-02-27' });
    expect(periodFor('2026-04-01', 1, 'QUARTERLY')).toEqual({ start: '2026-07-01', end: '2026-09-30' });
  });

  it('lists every missed occurrence up to today for catch-up', () => {
    expect(dueOccurrences({ startDate: '2026-07-01', endDate: null, interval: 'MONTHLY', fromIndex: 0, today: '2026-10-16' })).toEqual([0, 1, 2, 3]);
    expect(dueOccurrences({ startDate: '2026-07-01', endDate: null, interval: 'MONTHLY', fromIndex: 2, today: '2026-10-16' })).toEqual([2, 3]);
  });

  it('stops at the end date (exclusive)', () => {
    expect(dueOccurrences({ startDate: '2026-07-01', endDate: '2026-09-01', interval: 'MONTHLY', fromIndex: 0, today: '2026-10-16' })).toEqual([0, 1]);
  });

  it('finds the first occurrence on or after a date (resume)', () => {
    expect(occurrenceIndexOnOrAfter('2026-01-15', 'MONTHLY', '2026-10-16')).toBe(10); // 2026-11-15
    expect(occurrenceIndexOnOrAfter('2026-01-15', 'MONTHLY', '2026-10-15')).toBe(9);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @saas/shared exec vitest run src/finance/recurring.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/finance/recurring.ts
/**
 * Schedule maths for recurring expenses. Dates are ISO calendar dates
 * (`YYYY-MM-DD`) in UTC; organizations have no timezone of their own.
 *
 * Every occurrence is computed from the anchor, never from the previous
 * occurrence, so a schedule on the 31st bills 28 Feb and then 31 Mar again.
 */
export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

export const BILLING_INTERVALS: BillingInterval[] = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

const MONTHS: Record<BillingInterval, number> = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 };

export function monthsPerInterval(interval: BillingInterval): number {
  return MONTHS[interval];
}

export function monthlyEquivalent(amount: number, interval: BillingInterval): number {
  return Math.round((amount / MONTHS[interval]) * 100) / 100;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function utcToday(now: Date = new Date()): string {
  return isoDate(now);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}

export function addMonthsClamped(anchor: string, months: number): string {
  const [y, m, d] = parts(anchor);
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return isoDate(target);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return isoDate(new Date(Date.UTC(y, m, d + days)));
}

export function occurrenceDate(startDate: string, n: number, interval: BillingInterval): string {
  return addMonthsClamped(startDate, n * MONTHS[interval]);
}

export function periodFor(startDate: string, n: number, interval: BillingInterval): { start: string; end: string } {
  return {
    start: occurrenceDate(startDate, n, interval),
    end: addDays(occurrenceDate(startDate, n + 1, interval), -1),
  };
}

export function dueOccurrences(args: {
  startDate: string;
  endDate: string | null;
  interval: BillingInterval;
  fromIndex: number;
  today: string;
}): number[] {
  const out: number[] = [];
  // 1200 periods = 100 years monthly; a hard stop against a bad anchor.
  for (let n = args.fromIndex; n < args.fromIndex + 1200; n++) {
    const date = occurrenceDate(args.startDate, n, args.interval);
    if (date > args.today) break;
    if (args.endDate && date >= args.endDate) break;
    out.push(n);
  }
  return out;
}

export function occurrenceIndexOnOrAfter(startDate: string, interval: BillingInterval, date: string): number {
  let n = 0;
  while (occurrenceDate(startDate, n, interval) < date) n++;
  return n;
}
```

Add `export * from './finance/recurring';` to `index.ts` after `./finance/expense-categories`.

- [ ] **Step 4: Run tests** — `pnpm --filter @saas/shared test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/finance/recurring.ts packages/shared/src/finance/recurring.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): recurring schedule maths anchored on the start date"
```

---

### Task 4: Shared — prepaid split and bill posting by role

**Files:**
- Modify: `packages/shared/src/finance/recurring.ts` (append prepaid helpers)
- Modify: `packages/shared/src/payables/matching.ts:145-216`
- Modify: `packages/shared/src/schemas/bill.ts`
- Test: `packages/shared/src/finance/recurring.test.ts`, `packages/shared/src/payables/matching.test.ts`

**Interfaces:**
- Consumes: `expenseCategoryRole` (Task 2), `LEDGER_ROLES.PREPAID_EXPENSES` (Task 1).
- Produces:
  - `monthsTouched(start: string, end: string): number`
  - `prepaidSplit(totalBase: number, months: number): number[]` — equal cents, remainder on last.
  - `firstOfMonth(iso: string): string`, `addMonthsToFirst(firstMonth: string, k: number): string`
  - `isSpread(line: { servicePeriodStart?: string | null; servicePeriodEnd?: string | null }): boolean` (in `matching.ts`)
  - `BillLineForPosting` gains `category?: string | null; servicePeriodStart?: string | null; servicePeriodEnd?: string | null`
  - `billLineSchema` gains `category`, `servicePeriodStart`, `servicePeriodEnd` (ISO date strings or null).

- [ ] **Step 1: Write failing tests**

Append to `recurring.test.ts`:

```ts
import { monthsTouched, prepaidSplit, addMonthsToFirst } from './recurring';

describe('prepaid split', () => {
  it('counts calendar months touched, start month is month 1', () => {
    expect(monthsTouched('2026-01-01', '2026-12-31')).toBe(12);
    expect(monthsTouched('2026-12-15', '2027-12-14')).toBe(13);
    expect(monthsTouched('2026-03-01', '2026-03-31')).toBe(1);
  });

  it('splits into equal cents with the remainder on the last month', () => {
    expect(prepaidSplit(120_000, 12)).toEqual(Array(12).fill(10_000));
    const odd = prepaidSplit(1000, 3);
    expect(odd).toEqual([333.33, 333.33, 333.34]);
    expect(odd.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 2);
  });

  it('steps month starts across a year end', () => {
    expect(addMonthsToFirst('2026-12-01', 1)).toBe('2027-01-01');
  });
});
```

Append to `matching.test.ts` inside/after the existing `describe('billPostingLines')` (reuse its `ref`):

```ts
import { LEDGER_ROLES } from '../finance/ledger';

describe('billPostingLines — categories and spreading', () => {
  const ref = { billNumber: 'BILL-2026-0001', supplierName: 'Landlord LLC' };
  const sum = (ls: ReturnType<typeof billPostingLines>, k: 'debit' | 'credit') =>
    Math.round(ls.reduce((s, l) => s + l[k], 0) * 100) / 100;

  it('debits each unmatched line to its category role, grouped', () => {
    const lines = billPostingLines([
      { description: 'DEWA Jan', qty: 1, unitCost: 800, category: 'Utilities & Telecom' },
      { description: 'Du Jan', qty: 1, unitCost: 200, category: 'Utilities' },
      { description: 'Cardboard', qty: 1, unitCost: 500, category: 'Packaging' },
    ], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.UTILITIES)!.debit).toBe(1000);
    expect(lines.find((l) => l.role === LEDGER_ROLES.COGS)!.debit).toBe(500);
    expect(lines.some((l) => l.role === LEDGER_ROLES.OPERATING_EXPENSE)).toBe(false);
  });

  it('keeps an uncategorised line on operating expense', () => {
    const lines = billPostingLines([{ description: 'Electricity', qty: 1, unitCost: 412.5 }], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.OPERATING_EXPENSE)!.debit).toBe(412.5);
  });

  it('debits a multi-month line to prepaid expenses instead of its category', () => {
    const lines = billPostingLines([
      { description: 'Lease 2026', qty: 1, unitCost: 120_000, category: 'Rent & premises', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31' },
    ], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.PREPAID_EXPENSES)!.debit).toBe(120_000);
    expect(lines.some((l) => l.role === LEDGER_ROLES.RENT)).toBe(false);
  });

  it('expenses a one-month service period directly', () => {
    const lines = billPostingLines([
      { description: 'Rent March', qty: 1, unitCost: 10_000, category: 'Rent & premises', servicePeriodStart: '2026-03-01', servicePeriodEnd: '2026-03-31' },
    ], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.RENT)!.debit).toBe(10_000);
  });

  it('mixed bill balances', () => {
    const lines = billPostingLines([
      { description: 'Board', qty: 500, unitCost: 0.45, orderUnitCost: 0.42 },
      { description: 'Insurance 2026', qty: 1, unitCost: 6000, category: 'Insurance', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31' },
      { description: 'Repairs', qty: 1, unitCost: 300, category: 'Repairs & maintenance' },
    ], 315, ref);
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
    expect(lines.find((l) => l.role === LEDGER_ROLES.ACCOUNTS_PAYABLE)!.credit).toBe(6840);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @saas/shared test` → FAIL (`monthsTouched` missing; category routing not applied).

- [ ] **Step 3: Implement**

Append to `recurring.ts`:

```ts
export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonthsToFirst(firstMonth: string, k: number): string {
  return addMonthsClamped(firstOfMonth(firstMonth), k);
}

/** Calendar months a period touches, counting the start month as month 1. No day proration. */
export function monthsTouched(start: string, end: string): number {
  const [ys, ms] = parts(start);
  const [ye, me] = parts(end);
  return (ye - ys) * 12 + (me - ms) + 1;
}

/** Equal whole-cent months; the last month takes the remainder so the total clears exactly. */
export function prepaidSplit(totalBase: number, months: number): number[] {
  const totalCents = Math.round(totalBase * 100);
  const each = Math.floor(totalCents / months);
  const out = Array<number>(months).fill(each / 100);
  out[months - 1] = (totalCents - each * (months - 1)) / 100;
  return out;
}
```

In `matching.ts`, extend the interface and add `isSpread`:

```ts
import { expenseCategoryRole } from '../finance/expense-categories';
import { monthsTouched } from '../finance/recurring';

export interface BillLineForPosting {
  description: string;
  qty: number;
  unitCost: number;
  orderUnitCost?: number | null;
  /** Expense category for a line with no order; picks the account. */
  category?: string | null;
  /** When both are set and span more than one calendar month, the line is booked to prepaid and released monthly. */
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
}

export function isSpread(line: { servicePeriodStart?: string | null; servicePeriodEnd?: string | null }): boolean {
  return Boolean(line.servicePeriodStart && line.servicePeriodEnd) &&
    monthsTouched(line.servicePeriodStart!, line.servicePeriodEnd!) > 1;
}
```

Replace the body of `billPostingLines` loop and the expense push. Replace `let expense = 0;` with `const expenseByRole = new Map<LedgerRole, number>();` and in the loop's `else` branch:

```ts
    } else {
      const role = isSpread(line) ? LEDGER_ROLES.PREPAID_EXPENSES : expenseCategoryRole(line.category);
      expenseByRole.set(role, money((expenseByRole.get(role) ?? 0) + billed));
    }
```

Compute `const expense = money([...expenseByRole.values()].reduce((s, v) => s + v, 0));` before `payable`, and replace the single `OPERATING_EXPENSE` push with:

```ts
  for (const [role, amount] of expenseByRole) {
    if (amount === 0) continue;
    out.push({
      role,
      accountName: role === LEDGER_ROLES.PREPAID_EXPENSES ? 'Prepaid expenses' : 'Operating expense',
      debit: amount,
      credit: 0,
      description: label,
    });
  }
```

Import `type LedgerRole` from `'../finance/ledger'` if not already. Update the doc comment: "Lines with no order debit the account their category maps to (operating expense when uncategorised), or prepaid expenses when they cover more than a month."

In `schemas/bill.ts`, extend `billLineSchema`:

```ts
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const billLineSchema = z
  .object({
    purchaseOrderLineId: z.string().uuid().nullish().transform((v) => v ?? null),
    description: z.string().trim().min(1, 'Each line needs a description').max(255),
    qty: z.coerce.number().positive('Quantity must be above zero'),
    unitCost: z.coerce.number().min(0, 'Unit cost cannot be negative'),
    /** Which account an unordered line posts to; ignored on order lines. */
    category: optionalText(100),
    servicePeriodStart: isoDay.nullish().transform((v) => v ?? null),
    servicePeriodEnd: isoDay.nullish().transform((v) => v ?? null),
  })
  .refine((l) => (l.servicePeriodStart == null) === (l.servicePeriodEnd == null), {
    message: 'Give both the start and the end of the period, or neither',
    path: ['servicePeriodEnd'],
  })
  .refine((l) => !l.servicePeriodStart || !l.servicePeriodEnd || l.servicePeriodEnd >= l.servicePeriodStart, {
    message: 'The period cannot end before it starts',
    path: ['servicePeriodEnd'],
  })
  .refine((l) => !(l.purchaseOrderLineId && l.servicePeriodStart), {
    message: 'Order lines cannot be spread',
    path: ['servicePeriodStart'],
  });
```

(`optionalText` is already declared above in the file; move `billLineSchema` below it if needed.)

- [ ] **Step 4: Run tests** — `pnpm --filter @saas/shared test` → PASS, including the pre-existing `matching.test.ts:136` ("Electricity" line still on `OPERATING_EXPENSE`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/finance/recurring.ts packages/shared/src/finance/recurring.test.ts packages/shared/src/payables/matching.ts packages/shared/src/payables/matching.test.ts packages/shared/src/schemas/bill.ts
git commit -m "feat(shared): bill lines post by category and spread multi-month periods through prepaid"
```

---

### Task 5: Shared — recurring expense schemas and DTOs

**Files:**
- Create: `packages/shared/src/schemas/recurring-expense.ts`
- Test: `packages/shared/src/schemas/recurring-expense.test.ts`
- Modify: `packages/shared/src/finance/types.ts` (`RecurringExpenseDto`, payload types, new DTOs), `packages/shared/src/finance/currency.ts` (`StatementLineDto.parentId`), `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `createRecurringExpenseSchema`, `updateRecurringExpenseSchema`; `CreateRecurringExpensePayload = z.output<typeof createRecurringExpenseSchema>`, `UpdateRecurringExpensePayload`, `RecurringExpenseFormInput = z.input<typeof createRecurringExpenseSchema>`.
  - `RecurringExpenseDto` (fields below), `RecurringOccurrenceDto`, `PrepaidScheduleDto`, `CashForecastDto`, `CashForecastMonthDto`.
  - `StatementLineDto.parentId: string | null`.
- Remove the old hand-written `CreateRecurringExpensePayload` interface from `finance/types.ts` (the zod output type replaces it under the same name).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/schemas/recurring-expense.test.ts
import { describe, expect, it } from 'vitest';
import { createRecurringExpenseSchema, updateRecurringExpenseSchema } from './recurring-expense';

const base = {
  supplierId: '11111111-1111-4111-8111-111111111111',
  vendorName: 'Al Barsha Properties',
  category: 'Rent & premises',
  amount: '120000',
  billingInterval: 'ANNUAL',
  startDate: '2026-01-01',
};

describe('createRecurringExpenseSchema', () => {
  it('coerces and defaults', () => {
    const out = createRecurringExpenseSchema.parse(base);
    expect(out).toMatchObject({ amount: 120000, endDate: null, autoApprove: false, spreadOverPeriod: true, taxCodeId: null });
  });

  it('defaults spreading off for monthly and forces it off when sent', () => {
    expect(createRecurringExpenseSchema.parse({ ...base, billingInterval: 'MONTHLY' }).spreadOverPeriod).toBe(false);
    expect(createRecurringExpenseSchema.parse({ ...base, billingInterval: 'MONTHLY', spreadOverPeriod: true }).spreadOverPeriod).toBe(false);
  });

  it('normalises legacy categories', () => {
    expect(createRecurringExpenseSchema.parse({ ...base, category: 'Cloud Infrastructure' }).category).toBe('Software & SaaS');
  });

  it('accepts null supplier (forecast-only) and nulls from a loaded row', () => {
    const out = createRecurringExpenseSchema.parse({ ...base, supplierId: null, endDate: null, taxCodeId: null });
    expect(out.supplierId).toBeNull();
  });

  it('rejects an end date on or before the start', () => {
    expect(() => createRecurringExpenseSchema.parse({ ...base, endDate: '2026-01-01' })).toThrow();
  });

  it('update is partial', () => {
    expect(updateRecurringExpenseSchema.parse({ amount: '9000' })).toEqual({ amount: 9000 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @saas/shared exec vitest run src/schemas/recurring-expense.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/schemas/recurring-expense.ts
import { z } from 'zod';
import { BILLING_INTERVALS } from '../finance/recurring';
import { normaliseExpenseCategory } from '../finance/expense-categories';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const nullableUuid = z.string().uuid().nullish().transform((v) => v ?? null);

const fields = {
  /** Null keeps the row in the forecast without generating bills. */
  supplierId: nullableUuid,
  vendorName: z.string().trim().min(1, 'Name the vendor').max(255),
  category: z.string().trim().min(1).max(100).transform(normaliseExpenseCategory),
  amount: z.coerce.number().positive('Amount must be above zero'),
  billingInterval: z.enum(BILLING_INTERVALS as [string, ...string[]]).transform((v) => v as (typeof BILLING_INTERVALS)[number]),
  startDate: isoDay,
  endDate: isoDay.nullish().transform((v) => v ?? null),
  taxCodeId: nullableUuid,
  autoApprove: z.boolean().default(false),
  spreadOverPeriod: z.boolean().optional(),
};

export const createRecurringExpenseSchema = z
  .object(fields)
  .refine((v) => !v.endDate || v.endDate > v.startDate, { message: 'The end date must be after the start', path: ['endDate'] })
  .transform((v) => ({
    ...v,
    spreadOverPeriod: v.billingInterval === 'MONTHLY' ? false : (v.spreadOverPeriod ?? true),
  }));

export const updateRecurringExpenseSchema = z
  .object({
    supplierId: fields.supplierId.optional(),
    vendorName: fields.vendorName.optional(),
    category: fields.category.optional(),
    amount: fields.amount.optional(),
    billingInterval: fields.billingInterval.optional(),
    startDate: isoDay.optional(),
    endDate: fields.endDate.optional(),
    taxCodeId: fields.taxCodeId.optional(),
    autoApprove: z.boolean().optional(),
    spreadOverPeriod: z.boolean().optional(),
  })
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as typeof v);

export type CreateRecurringExpensePayload = z.output<typeof createRecurringExpenseSchema>;
export type RecurringExpenseFormInput = z.input<typeof createRecurringExpenseSchema>;
export type UpdateRecurringExpensePayload = z.output<typeof updateRecurringExpenseSchema>;
```

In `finance/types.ts`, replace `RecurringExpenseDto` and delete the old `CreateRecurringExpensePayload` interface:

```ts
import type { BillingInterval } from './recurring';

export interface RecurringExpenseDto {
  id: string;
  tenantId: string;
  supplierId: string | null;
  supplierName: string | null;
  vendorName: string;
  category: string;
  amount: number;
  currency: string | null;
  billingInterval: BillingInterval;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string;
  taxCodeId: string | null;
  autoApprove: boolean;
  spreadOverPeriod: boolean;
  financeAccountId?: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  /** Status of the most recent occurrence, for the table badge. */
  lastOccurrenceStatus: 'GENERATED' | 'FAILED' | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringOccurrenceDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  billId: string | null;
  billNumber: string | null;
  status: 'GENERATED' | 'FAILED';
  error: string | null;
  attempts: number;
  createdAt: string;
}

export interface PrepaidScheduleDto {
  id: string;
  billId: string;
  billLineId: string;
  expenseRole: string;
  totalBase: number;
  firstMonth: string;
  months: number;
  releasedMonths: number;
  releasedAmount: number;
  remainingAmount: number;
  status: 'ACTIVE' | 'COMPLETED' | 'ENDED_EARLY';
}

export interface CashForecastMonthDto {
  month: string; // YYYY-MM
  opening: number;
  inflows: number;
  billsOut: number;
  recurringOut: number;
  closing: number;
}

export interface CashForecastDto {
  baseCurrency: string;
  months: CashForecastMonthDto[];
}
```

Also replace `'MONTHLY' | 'ANNUAL'` in any remaining type in this file with `BillingInterval`, and extend `JournalEntryDto.referenceType` to `JournalReferenceType` (import from `./ledger`).

In `finance/currency.ts`, `StatementLineDto` add `parentId: string | null;`.

In `index.ts` add `export * from './schemas/recurring-expense';`.

- [ ] **Step 4: Build & test** — `pnpm --filter @saas/shared test && pnpm --filter @saas/shared build` → PASS, build succeeds. Then `pnpm --filter api exec tsc --noEmit -p tsconfig.json` and `pnpm --filter web exec tsc --noEmit` — record the errors (expected: `CreateRecurringExpenseDto`/modal type mismatches); they are fixed in Tasks 10 and 16. Do not fix them here.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/recurring-expense.ts packages/shared/src/schemas/recurring-expense.test.ts packages/shared/src/finance/types.ts packages/shared/src/finance/currency.ts packages/shared/src/index.ts
git commit -m "feat(shared): recurring expense schemas, occurrence/prepaid/forecast DTOs"
```

---

### Task 6: API — chart provisioning, backfill migration, category fallback

**Files:**
- Modify: `apps/api/src/modules/finance/ledger.service.ts:71-102` (provisioning), `:262-283` (resolution)
- Create: `apps/api/src/database/migrations/1789900000000-ExpenseAccountsAndPrepaid.ts`
- Test: `apps/api/src/modules/finance/ledger.service.spec.ts`

**Interfaces:**
- Consumes: `SYSTEM_LEDGER_ACCOUNTS` with `parentCode`, `OPERATING_EXPENSE_CHILD_ROLES` (Task 1).
- Produces: `provisionChartOfAccounts` links parents and dedupes on code **or** role; `resolveLines` falls back to `OPERATING_EXPENSE` (with a warning) when the line's role is one of `OPERATING_EXPENSE_CHILD_ROLES` and missing for the tenant.

- [ ] **Step 1: Write failing tests** — open `ledger.service.spec.ts`, reuse its existing repository mocks (see `:83-111`). Add:

```ts
describe('provisionChartOfAccounts — hierarchy', () => {
  it('sets parentId on the overhead accounts to the tenant 6000', async () => {
    const { service, saved } = makeLedger({ existing: [] }); // existing helper in this spec; returns saved rows
    await service.provisionChartOfAccounts(tenantId);
    const byCode = new Map(saved.map((a: any) => [a.code, a]));
    expect(byCode.get('6100')!.parentId).toBe(byCode.get('6000')!.id);
    expect(byCode.get('1400')!.parentId ?? null).toBeNull();
  });

  it('does not add a second account for a role the tenant already has under another code', async () => {
    const { service, saved } = makeLedger({ existing: [{ id: 'x', code: '6150', role: 'RENT' }] });
    await service.provisionChartOfAccounts(tenantId);
    expect(saved.filter((a: any) => a.role === 'RENT')).toHaveLength(0);
  });
});

describe('resolveLines — category fallback', () => {
  it('falls back to operating expense when a category role is missing', async () => {
    const { service } = makeLedger({ existing: [
      { id: 'opex', code: '6000', role: 'OPERATING_EXPENSE' },
      { id: 'ap', code: '2100', role: 'ACCOUNTS_PAYABLE' },
    ] });
    const lines = await service.resolveLines(tenantId, [
      { role: 'RENT', accountName: 'Rent', debit: 100, credit: 0, description: 'x' },
      { role: 'ACCOUNTS_PAYABLE', accountName: 'AP', debit: 0, credit: 100, description: 'x' },
    ]);
    expect(lines[0].ledgerAccountCode).toBe('6000');
  });

  it('still refuses a missing structural role', async () => {
    const { service } = makeLedger({ existing: [{ id: 'opex', code: '6000', role: 'OPERATING_EXPENSE' }] });
    await expect(service.resolveLines(tenantId, [
      { role: 'OPERATING_EXPENSE', accountName: 'x', debit: 1, credit: 0, description: 'x' },
      { role: 'ACCOUNTS_PAYABLE', accountName: 'AP', debit: 0, credit: 1, description: 'x' },
    ])).rejects.toThrow(/ACCOUNTS_PAYABLE/);
  });
});
```

If the spec has no `makeLedger` helper, write one at the top of the new describe blocks: an in-memory repo whose `find`/`findOne({ where: { role } })`/`save`/`create`/`update` operate on an array, passed via a fake `EntityManager` (`getRepository: () => repo`) and `dataSource.manager`. Assign `id = 'acc-' + code` on save; `saved` = rows saved during the call.

Also update the existing assertion at `ledger.service.spec.ts:229` only if it now fails (an unrecognised label still lands on `6000`; it should still pass).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter api exec jest src/modules/finance/ledger.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement provisioning**

```ts
  async provisionChartOfAccounts(
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<LedgerAccount[]> {
    const repo = manager.getRepository(LedgerAccount);
    const existing = await repo.find({ where: { tenantId } });
    const byCode = new Map(existing.map((a) => [a.code, a]));
    const byRole = new Map(existing.filter((a) => a.role).map((a) => [a.role!, a]));

    const created: LedgerAccount[] = [];
    // Codes of system accounts this call resolved, for linking parents below.
    const resolved = new Map<string, LedgerAccount>();
    for (const definition of SYSTEM_LEDGER_ACCOUNTS) {
      // A tenant that already uses the code or the role keeps what it has:
      // two accounts for one role would break the unique index, and taking
      // over their code would rename their account.
      const already = byRole.get(definition.role) ?? byCode.get(definition.code);
      if (already) {
        created.push(already);
        resolved.set(definition.code, already);
        continue;
      }
      const parent = definition.parentCode ? resolved.get(definition.parentCode) : undefined;
      const row = await repo.save(
        repo.create({
          tenantId,
          code: definition.code,
          name: definition.name,
          type: definition.type,
          role: definition.role,
          description: definition.description,
          parentId: parent?.id ?? null,
          isSystem: true,
          isActive: true,
        }),
      );
      created.push(row);
      resolved.set(definition.code, row);
    }
    return created;
  }
```

Implement the fallback in `resolveLines` — replace the final `else` branch's `ledger = await this.byRole(...)` with:

```ts
        const wanted = role ?? LEDGER_ROLES.OPERATING_EXPENSE;
        ledger = await this.byRoleWithOverheadFallback(tenantId, wanted, manager);
```

and add the method under `byRole`:

```ts
  /**
   * An overhead role (rent, utilities…) can be missing for a tenant whose own
   * chart already used that code when the account was introduced. Posting to
   * 6000 is the same answer the ledger gave before those accounts existed;
   * failing the whole bill would not be. Structural roles still 404.
   */
  private async byRoleWithOverheadFallback(
    tenantId: string,
    role: LedgerRole,
    manager: EntityManager,
  ): Promise<LedgerAccount> {
    try {
      return await this.byRole(tenantId, role, manager);
    } catch (err) {
      if (!(err instanceof NotFoundException) || !OPERATING_EXPENSE_CHILD_ROLES.includes(role)) throw err;
      this.logger.warn(`Tenant ${tenantId} has no ${role} account; posting to operating expense`);
      return this.byRole(tenantId, LEDGER_ROLES.OPERATING_EXPENSE, manager);
    }
  }
```

Import `OPERATING_EXPENSE_CHILD_ROLES` from `@saas/shared`.

Note: `byRole` runs inside the caller's transaction; a failed `findOne` that returns null does not abort the transaction (it is a SELECT returning no rows, then a thrown JS error), so catching is safe.

- [ ] **Step 4: Write the migration**

```ts
// apps/api/src/database/migrations/1789900000000-ExpenseAccountsAndPrepaid.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Overhead accounts under 6000, and 1400 Prepaid expenses, for every existing
 * tenant. New tenants get them from provisionChartOfAccounts.
 *
 * A tenant that already uses a code or a role is skipped for that account;
 * postings for that role fall back to 6000 (LedgerService). History stays in
 * 6000 — the ledger is append-only.
 */
const ACCOUNTS: Array<[code: string, name: string, type: 'ASSET' | 'EXPENSE', role: string, parent: string | null, description: string]> = [
  ['1400', 'Prepaid expenses', 'ASSET', 'PREPAID_EXPENSES', null, 'Paid or billed ahead for a period not yet used — an annual lease, a yearly policy. Released to expense one month at a time.'],
  ['6100', 'Rent & premises', 'EXPENSE', 'RENT', '6000', 'Rent, service charges and premises costs'],
  ['6200', 'Utilities & telecom', 'EXPENSE', 'UTILITIES', '6000', 'Electricity, water, cooling, internet and phones'],
  ['6300', 'Salaries & wages', 'EXPENSE', 'SALARIES', '6000', 'Payroll, allowances and contractors'],
  ['6400', 'Repairs & maintenance', 'EXPENSE', 'REPAIRS', '6000', 'Upkeep of premises, plant and machinery'],
  ['6450', 'Insurance', 'EXPENSE', 'INSURANCE', '6000', 'Insurance premiums'],
  ['6500', 'Travel & entertainment', 'EXPENSE', 'TRAVEL', '6000', 'Travel, lodging, meals and entertainment'],
  ['6600', 'Software & IT', 'EXPENSE', 'SOFTWARE_IT', '6000', 'Software subscriptions, hosting and IT equipment below the capitalisation threshold'],
  ['6700', 'Marketing', 'EXPENSE', 'MARKETING', '6000', 'Advertising and marketing'],
  ['6800', 'Professional fees', 'EXPENSE', 'PROFESSIONAL_FEES', '6000', 'Accounting, legal and consulting fees'],
  ['6900', 'Bank charges', 'EXPENSE', 'BANK_CHARGES', '6000', 'Bank and payment processing fees'],
];

export class ExpenseAccountsAndPrepaid1789900000000 implements MigrationInterface {
  name = 'ExpenseAccountsAndPrepaid1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);

    for (const [code, name, type, role, parent, description] of ACCOUNTS) {
      await queryRunner.query(
        `INSERT INTO "ledger_accounts" ("tenant_id", "code", "name", "type", "role", "is_system", "description", "parent_id")
         SELECT t."tenant_id", $1, $2, $3::ledger_accounts_type_enum, $4, true, $5,
                (SELECT p."id" FROM "ledger_accounts" p
                  WHERE p."tenant_id" = t."tenant_id" AND p."code" = $6 AND p."role" = 'OPERATING_EXPENSE' AND p."deletedAt" IS NULL)
         FROM (SELECT DISTINCT "tenant_id" FROM "ledger_accounts") t
         WHERE NOT EXISTS (
           SELECT 1 FROM "ledger_accounts" x
           WHERE x."tenant_id" = t."tenant_id" AND (x."role" = $4 OR x."code" = $1) AND x."deletedAt" IS NULL
         )`,
        [code, name, type, role, description, parent],
      );
    }

    await queryRunner.query(
      `UPDATE "ledger_accounts"
          SET "name" = 'Other operating expense',
              "description" = 'Overheads with no account of their own. Parent of the overhead accounts below.'
        WHERE "role" = 'OPERATING_EXPENSE' AND "is_system" AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "deletedAt" = now()
        WHERE "is_system" AND "role" = ANY($1) AND "deletedAt" IS NULL`,
      [ACCOUNTS.map((a) => a[3])],
    );
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "name" = 'Operating expense', "description" = 'Overheads and employee expense claims'
        WHERE "role" = 'OPERATING_EXPENSE' AND "is_system" AND "deletedAt" IS NULL`,
    );
  }
}
```

Before running, confirm column names with `grep -n "Column" apps/api/src/modules/finance/entities/ledger-account.entity.ts` — the 7000 migration uses `tenant_id`, `is_system`, `deletedAt`; `parent_id` is per `1786300000000…:60`. Adjust if any differ.

- [ ] **Step 5: Run tests and the migration**

Run: `pnpm --filter api exec jest src/modules/finance/ledger.service.spec.ts` → PASS.
Run: `pnpm db:up && pnpm migration:run && pnpm check:drift` → migration applies, drift check passes.
Run (spot check): `docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select code,name,parent_id is not null as has_parent from ledger_accounts where code in ('1400','6000','6100') order by code limit 6"` → 6100 has a parent; 6000 renamed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/finance/ledger.service.ts apps/api/src/modules/finance/ledger.service.spec.ts apps/api/src/database/migrations/1789900000000-ExpenseAccountsAndPrepaid.ts
git commit -m "feat(api): overhead accounts for every tenant, parent links, overhead role fallback"
```

---

### Task 7: API — expense claims post by category

**Files:**
- Modify: `apps/api/src/modules/finance/expenses.service.ts:357-412`
- Modify: `apps/api/src/modules/finance/workflows/expense-approval.workflow.ts:194`
- Test: `apps/api/src/modules/finance/expenses.service.spec.ts:376`

**Interfaces:**
- Consumes: `expenseCategoryRole` (Task 2).

- [ ] **Step 1: Update the failing test.** At `expenses.service.spec.ts:376` the assertion expects `role: 'OPERATING_EXPENSE'`. Change that test's claim fixture to `category: 'Travel'` and assert `role: 'TRAVEL'`. Add:

```ts
it('posts a cost-of-sales claim to COGS', async () => {
  // reuse the arrangement of the test at :376 with category 'Raw materials'
  // and assert the debit line passed to ledger.resolveLines has role 'COGS'
});
```

Fill it by copying the arrange/act block of the `:376` test verbatim and changing only the category and the expected role (the arrange block mocks `ledger.resolveLines` and inspects its second argument).

- [ ] **Step 2: Run** — `pnpm --filter api exec jest src/modules/finance/expenses.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement.** In `postExpenseAccrual` replace the debit line role:

```ts
          {
            role: expenseCategoryRole(claim.category),
            accountName: claim.category || 'Operating expense',
```

Update the doc comment: "The category picks the account (`expenseCategoryRole`): cost-of-sales categories land in COGS, overheads in their own account under 6000, anything else in 6000."

In `expense-approval.workflow.ts:194` replace `LEDGER_ROLES.OPERATING_EXPENSE` with `expenseCategoryRole(<the category variable in scope>)`. Workflows are deterministic; `expenseCategoryRole` is pure, so this is allowed. Import it from `@saas/shared`.

- [ ] **Step 4: Run** — same jest command → PASS. Also `pnpm --filter api exec jest src/modules/finance` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance/expenses.service.ts apps/api/src/modules/finance/expenses.service.spec.ts apps/api/src/modules/finance/workflows/expense-approval.workflow.ts
git commit -m "feat(api): expense claims post to the account their category maps to"
```

---

### Task 8: API — schema for recurring billing and prepaid

**Files:**
- Modify: `apps/api/src/modules/finance/entities/recurring-expense.entity.ts`
- Create: `apps/api/src/modules/finance/entities/recurring-expense-occurrence.entity.ts`
- Modify: `apps/api/src/modules/finance/entities/journal-entry.entity.ts` (enum list)
- Modify: `apps/api/src/modules/payables/entities/supplier-bill.entity.ts` (`SupplierBillLine`)
- Create: `apps/api/src/modules/payables/entities/prepaid-schedule.entity.ts`
- Create: `apps/api/src/database/migrations/1789900000001-RecurringBillingAndPrepaid.ts`
- Modify: `apps/api/src/modules/finance/finance.module.ts`, `apps/api/src/modules/payables/payables.module.ts` (register entities)

**Interfaces:**
- Produces entities:
  - `RecurringExpense` adds `supplierId: string | null`, `supplier?: Supplier`, `startDate: string` (`date`), `endDate: string | null` (`date`), `taxCodeId: string | null`, `autoApprove: boolean`, `autoApproveById: string | null`, `spreadOverPeriod: boolean`, `createdById: string | null`, `billingInterval: BillingInterval`.
  - `RecurringExpenseOccurrence { id, tenantId, recurringExpenseId, occurrenceIndex: number, periodStart: string, periodEnd: string, amount: number, billId: string | null, status: 'GENERATED' | 'FAILED', error: string | null, attempts: number, createdAt, updatedAt }` — unique `(recurringExpenseId, periodStart)`.
  - `SupplierBillLine` adds `category: string | null`, `servicePeriodStart: string | null`, `servicePeriodEnd: string | null` (`date`).
  - `PrepaidSchedule { id, tenantId, billId, billLineId, expenseRole: string, totalBase: number, firstMonth: string, months: number, status: 'ACTIVE' | 'COMPLETED' | 'ENDED_EARLY', createdAt }`; `PrepaidAmortization { id, tenantId, scheduleId, month: string, amount: number, journalEntryId: string, createdAt }` — unique `(scheduleId, month)`.

- [ ] **Step 1: Entities.** Recurring expense — change/add columns (camelCase column names, matching the existing table):

```ts
  @Column({ type: 'uuid', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;

  @Column({
    type: 'enum',
    enum: ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'],
    enumName: 'recurring_expenses_billing_interval_enum',
    default: 'MONTHLY',
  })
  billingInterval: BillingInterval;

  /** Anchor every occurrence is computed from. */
  @Column({ type: 'date' })
  startDate: string;

  /** No occurrence on or after this date. */
  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'uuid', nullable: true })
  taxCodeId: string | null;

  @Column({ type: 'boolean', default: false })
  autoApprove: boolean;

  /** Who switched auto-approve on; approvals run as them, with their current permissions. */
  @Column({ type: 'uuid', nullable: true })
  autoApproveById: string | null;

  @Column({ type: 'boolean', default: false })
  spreadOverPeriod: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;
```

Import `Supplier` from `../../purchasing/entities/supplier.entity` and `type BillingInterval` from `@saas/shared`.

```ts
// apps/api/src/modules/finance/entities/recurring-expense-occurrence.entity.ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from './finance-account.entity';

/**
 * One period of a recurring expense. The unique (recurringExpenseId,
 * periodStart) row is the claim: whoever inserts it generates the bill, so two
 * replicas or a re-run can never bill a period twice.
 */
@Entity('recurring_expense_occurrences')
@Index('uq_recurring_occurrence_period', ['recurringExpenseId', 'periodStart'], { unique: true })
@Index('idx_recurring_occurrences_tenant', ['tenantId'])
export class RecurringExpenseOccurrence {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) recurringExpenseId: string;
  @Column({ type: 'int' }) occurrenceIndex: number;
  @Column({ type: 'date' }) periodStart: string;
  @Column({ type: 'date' }) periodEnd: string;
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) amount: number;
  @Column({ type: 'uuid', nullable: true }) billId: string | null;
  @Column({ type: 'varchar', length: 20 }) status: 'GENERATED' | 'FAILED';
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
```

`SupplierBillLine` — add after `lineTotal`:

```ts
  /** Which account an unordered line posts to. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @Column({ name: 'service_period_start', type: 'date', nullable: true })
  servicePeriodStart: string | null;

  @Column({ name: 'service_period_end', type: 'date', nullable: true })
  servicePeriodEnd: string | null;
```

```ts
// apps/api/src/modules/payables/entities/prepaid-schedule.entity.ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/** A bill line booked to prepaid expenses, released to its expense account one month at a time. */
@Entity('prepaid_schedules')
@Index('idx_prepaid_schedules_tenant', ['tenantId'])
@Index('uq_prepaid_schedules_bill_line', ['billLineId'], { unique: true })
export class PrepaidSchedule {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'bill_id', type: 'uuid' }) billId: string;
  @Column({ name: 'bill_line_id', type: 'uuid' }) billLineId: string;
  @Column({ name: 'expense_role', type: 'varchar', length: 40 }) expenseRole: string;
  /** Exactly what was debited to 1400, in base currency, so the account clears to zero. */
  @Column({ name: 'total_base', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) totalBase: number;
  @Column({ name: 'first_month', type: 'date' }) firstMonth: string;
  @Column({ type: 'int' }) months: number;
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' }) status: 'ACTIVE' | 'COMPLETED' | 'ENDED_EARLY';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('prepaid_amortizations')
@Index('uq_prepaid_amortization_month', ['scheduleId', 'month'], { unique: true })
@Index('idx_prepaid_amortizations_tenant', ['tenantId'])
export class PrepaidAmortization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'schedule_id', type: 'uuid' }) scheduleId: string;
  @Column({ type: 'date' }) month: string;
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) amount: number;
  @Column({ name: 'journal_entry_id', type: 'uuid' }) journalEntryId: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
```

`JournalEntry` enum: add `'PREPAID'` to the `enum` array.

Register `RecurringExpenseOccurrence` and `Supplier` in `FinanceModule`'s `forFeature`; `PrepaidSchedule`, `PrepaidAmortization` in `PayablesModule`'s `forFeature`.

- [ ] **Step 2: Generate, then hand-finish the migration.** Run `pnpm migration:generate RecurringBillingAndPrepaid`, rename the file to `1789900000001-RecurringBillingAndPrepaid.ts` (class `RecurringBillingAndPrepaid1789900000001`), and keep the generated DDL. Then:

1. Generated SQL will try to recreate `recurring_expenses_billing_interval_enum`. Replace that with:
   ```ts
   await queryRunner.query(`ALTER TYPE "recurring_expenses_billing_interval_enum" ADD VALUE IF NOT EXISTS 'QUARTERLY'`);
   await queryRunner.query(`ALTER TYPE "recurring_expenses_billing_interval_enum" ADD VALUE IF NOT EXISTS 'SEMI_ANNUAL'`);
   await queryRunner.query(`ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'PREPAID'`);
   ```
   (Postgres 18 permits ADD VALUE inside a transaction; the new values are not *used* in this migration.)
2. For `startDate` NOT NULL on existing rows: add it nullable, backfill, then set NOT NULL:
   ```ts
   await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD "startDate" date`);
   await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);
   await queryRunner.query(`UPDATE "recurring_expenses" SET "startDate" = ("nextBillingDate" AT TIME ZONE 'UTC')::date`);
   await queryRunner.query(`ALTER TABLE "recurring_expenses" ALTER COLUMN "startDate" SET NOT NULL`);
   await queryRunner.query(`UPDATE "recurring_expenses" SET "spreadOverPeriod" = ("billingInterval" <> 'MONTHLY')`);
   ```
3. Supplier match (exactly one match only):
   ```ts
   await queryRunner.query(`
     UPDATE "recurring_expenses" r SET "supplierId" = s.id
       FROM "suppliers" s
      WHERE s."tenant_id" = r."tenantId" AND s."deletedAt" IS NULL
        AND lower(trim(s."company_name")) = lower(trim(r."vendorName"))
        AND (SELECT count(*) FROM "suppliers" s2
              WHERE s2."tenant_id" = r."tenantId" AND s2."deletedAt" IS NULL
                AND lower(trim(s2."company_name")) = lower(trim(r."vendorName"))) = 1`);
   ```
   Confirm `suppliers` column names first: `grep -n "Column" apps/api/src/modules/purchasing/entities/supplier.entity.ts` (expected `tenant_id`, `company_name`, `deletedAt`; adjust if not).
4. Category mapping — one `UPDATE … SET "category" = $2 WHERE "category" = $1` per entry in `LEGACY_SUBSCRIPTION_CATEGORIES` (import it from `@saas/shared`; migrations already import shared constants elsewhere — if not, inline the 7 pairs).
5. RLS for the three new tables:
   ```ts
   for (const [table, col] of [['recurring_expense_occurrences', '"tenantId"'], ['prepaid_schedules', '"tenant_id"'], ['prepaid_amortizations', '"tenant_id"']]) {
     await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
     await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
     await queryRunner.query(`CREATE POLICY tenant_isolation ON "${table}" USING (current_setting('app.bypass_rls', true) = 'on' OR ${col} = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR ${col} = current_setting('app.current_tenant_id', true)::uuid)`);
   }
   ```
   **Copy the exact policy name and expression from `1787600000000-EnablePostgresRowLevelSecurity.ts:85-100`** rather than the text above if they differ — the policy must match the existing ones.
6. FKs (migrations own them): occurrences → `recurring_expenses(id)` CASCADE, → `supplier_bills(id)` SET NULL; prepaid_schedules → `supplier_bills(id)` CASCADE, → `supplier_bill_lines(id)` CASCADE; prepaid_amortizations → `prepaid_schedules(id)` CASCADE, → `journal_entries(id)` RESTRICT; all three → `organizations(id)` CASCADE on the tenant column; `recurring_expenses.supplierId` → `suppliers(id)` SET NULL.
7. `down()`: drop the three tables, the new columns, and restore `startDate`-less shape. Enum values cannot be dropped — leave a comment saying so.

- [ ] **Step 3: Run**

Run: `pnpm migration:run && pnpm check:drift`
Expected: migration applies; drift check passes. Then `pnpm migration:generate Probe` → "No changes in database schema were found" (delete nothing was created).

- [ ] **Step 4: Run the API test suite** — `pnpm --filter api test` → PASS (entity changes only).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance/entities apps/api/src/modules/payables/entities apps/api/src/database/migrations/1789900000001-RecurringBillingAndPrepaid.ts apps/api/src/modules/finance/finance.module.ts apps/api/src/modules/payables/payables.module.ts
git commit -m "feat(api): schema for recurring bill generation and prepaid schedules"
```

---

### Task 9: API — bills carry category/service period; approval creates prepaid schedules

**Files:**
- Modify: `apps/api/src/modules/payables/payables.service.ts:362-470` (create), `:523-660` (approve)
- Test: `apps/api/src/modules/payables/payables.service.spec.ts`

**Interfaces:**
- Consumes: `billPostingLines`, `isSpread`, `monthsTouched`, `firstOfMonth`, `expenseCategoryRole` (Tasks 2–4); `PrepaidSchedule` (Task 8).
- Produces: `PayablesService.create(tenantId, actorId: string | null, input)`; on approval, one `PrepaidSchedule` per spread line with `totalBase = round2(lineTotal × billRate)`.

- [ ] **Step 1: Failing tests.** Using the spec's `makeService(seed)` (extend it so its fake manager returns a repo for `PrepaidSchedule` that records `save` calls into `seed.savedSchedules`), add:

```ts
describe('spread lines', () => {
  it('creates a prepaid schedule on approval', async () => {
    const saved: any[] = [];
    const { service } = makeService({
      savedSchedules: saved,
      bill: draftBill({ lines: [{ id: 'l1', description: 'Lease', qty: 1, unitCost: 120000, lineTotal: 120000, category: 'Rent & premises', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31', purchaseOrderLineId: null, orderUnitCost: null }] }),
    });
    await service.approve(tenantId, 'bill-1', { userId: 'u1', permissions: APPROVER });
    expect(saved).toEqual([expect.objectContaining({ billLineId: 'l1', expenseRole: 'RENT', totalBase: 120000, firstMonth: '2026-01-01', months: 12 })]);
  });

  it('schedule total uses the bill\'s fx rate', async () => {
    const saved: any[] = [];
    const { service } = makeService({
      savedSchedules: saved,
      fxRate: 3.6725,
      bill: draftBill({ currency: 'USD', lines: [{ id: 'l1', description: 'Policy', qty: 1, unitCost: 1000, lineTotal: 1000, category: 'Insurance', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-06-30', purchaseOrderLineId: null, orderUnitCost: null }] }),
    });
    await service.approve(tenantId, 'bill-1', { userId: 'u1', permissions: APPROVER });
    expect(saved[0].totalBase).toBe(3672.5);
  });

  it('creates no schedule for a single-month line', async () => {
    const saved: any[] = [];
    const { service } = makeService({ savedSchedules: saved, bill: draftBill({ lines: [{ id: 'l1', description: 'Rent Mar', qty: 1, unitCost: 10000, lineTotal: 10000, category: 'Rent & premises', servicePeriodStart: '2026-03-01', servicePeriodEnd: '2026-03-31', purchaseOrderLineId: null, orderUnitCost: null }] }) });
    await service.approve(tenantId, 'bill-1', { userId: 'u1', permissions: APPROVER });
    expect(saved).toHaveLength(0);
  });
});
```

`draftBill(overrides)` — add a helper in the spec returning the same shape the existing approve tests use for `seed.bill`, status `'DRAFT'`, merged with overrides. `fxRate` in the seed controls what the mocked `fxRateFor` returns — if `fxRateFor` is imported as a module function, `jest.mock('../finance/fx', …)` as the existing spec does (check the top of the spec; follow its mocking of `fxRateFor`).

Also add to the existing `create` tests: lines persisted with `category`/`servicePeriodStart`/`servicePeriodEnd` from input.

- [ ] **Step 2: Run** — `pnpm --filter api exec jest src/modules/payables/payables.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement.**

`create`: change the signature to `actorId: string | null`, and in the line mapping add:

```ts
              category: line.purchaseOrderLineId ? null : line.category,
              servicePeriodStart: line.purchaseOrderLineId ? null : line.servicePeriodStart,
              servicePeriodEnd: line.purchaseOrderLineId ? null : line.servicePeriodEnd,
```

`approve`: pass the new fields into `billPostingLines`:

```ts
        (bill.lines ?? []).map((l) => ({
          description: l.description,
          qty: l.qty,
          unitCost: l.unitCost,
          orderUnitCost: l.purchaseOrderLineId ? l.orderUnitCost : null,
          category: l.category,
          servicePeriodStart: l.servicePeriodStart,
          servicePeriodEnd: l.servicePeriodEnd,
        })),
```

After saving the journal `entry` and before `bill.status = 'APPROVED'`:

```ts
      // A line covering more than a month went to prepaid expenses; record how
      // it is released. Same transaction as the posting, so a schedule exists
      // exactly when the prepaid debit does.
      const schedules = manager.getRepository(PrepaidSchedule);
      for (const line of bill.lines ?? []) {
        if (line.purchaseOrderLineId || !isSpread(line)) continue;
        await schedules.save(
          schedules.create({
            tenantId,
            billId: bill.id,
            billLineId: line.id,
            expenseRole: expenseCategoryRole(line.category),
            totalBase: money(line.lineTotal * billRate),
            firstMonth: firstOfMonth(line.servicePeriodStart!),
            months: monthsTouched(line.servicePeriodStart!, line.servicePeriodEnd!),
            status: 'ACTIVE',
          }),
        );
      }
```

Important: `resolveLines` converts the prepaid debit at the same `billRate` with `money()` rounding per line, so `totalBase` equals the 1400 debit when the bill has one spread line. With several spread lines `resolveLines` sums them into one prepaid line; the per-line `money(lineTotal × rate)` values can differ from that by a cent. Guard against that: after creating schedules, compute `prepaidPosted = lines.filter(l => l.ledgerAccountCode === <tenant 1400 code>)…` — simpler: look up the resolved line whose `accountName === 'Prepaid expenses'`, and if `sum(totalBase) !== its debit`, add the difference to the last schedule's `totalBase` before saving. Implement by building the schedule objects first, adjusting, then saving.

Import `PrepaidSchedule`, `isSpread`, `monthsTouched`, `firstOfMonth`, `expenseCategoryRole`.

- [ ] **Step 4: Run** — same jest command → PASS; `pnpm --filter api test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payables/payables.service.ts apps/api/src/modules/payables/payables.service.spec.ts
git commit -m "feat(api): bill lines keep category and service period; approval schedules prepaid release"
```

---

### Task 10: API — subscription CRUD with validation and the auto-approve rule

**Files:**
- Modify: `apps/api/src/modules/finance/finance.service.ts:720-744`
- Modify: `apps/api/src/modules/finance/finance.controller.ts:167-190`
- Delete: `apps/api/src/modules/finance/dto/create-recurring-expense.dto.ts` (and its export in `dto/index.ts`)
- Test: `apps/api/src/modules/finance/finance.service.spec.ts`

**Interfaces:**
- Consumes: `createRecurringExpenseSchema`, `updateRecurringExpenseSchema`, payload types (Task 5); `occurrenceIndexOnOrAfter`, `occurrenceDate`, `utcToday` (Task 3).
- Produces (`FinanceService`):
  - `findAllSubscriptions(tenantId): Promise<RecurringExpenseDto[]>`
  - `createSubscription(tenantId, actor: { userId: string; permissions: Permission[] }, input: CreateRecurringExpensePayload)`
  - `updateSubscription(tenantId, id, actor, input: UpdateRecurringExpensePayload)`
  - `pauseSubscription(tenantId, id)`, `resumeSubscription(tenantId, id)`, `cancelSubscription(tenantId, id)`
  - `listOccurrences(tenantId, id): Promise<RecurringOccurrenceDto[]>`

- [ ] **Step 1: Failing tests** (in `finance.service.spec.ts`, using its existing repo mocks; add a mock repo for `RecurringExpenseOccurrence` with `count`/`find`):

```ts
const manager = { userId: 'u-fin', permissions: [PERMISSIONS.FINANCE_MANAGE] };
const managerApprover = { userId: 'u-boss', permissions: [PERMISSIONS.FINANCE_MANAGE, PERMISSIONS.BILL_APPROVE] };
const input = createRecurringExpenseSchema.parse({ supplierId: SUPPLIER, vendorName: 'Landlord', category: 'Rent & premises', amount: 120000, billingInterval: 'ANNUAL', startDate: '2026-01-01' });

it('refuses auto-approve from someone who cannot approve bills', async () => {
  await expect(service.createSubscription(tenantId, manager, { ...input, autoApprove: true })).rejects.toThrow(ForbiddenException);
});

it('records who switched auto-approve on', async () => {
  const row = await service.createSubscription(tenantId, managerApprover, { ...input, autoApprove: true });
  expect(row).toMatchObject({ autoApprove: true, autoApproveById: 'u-boss', createdById: 'u-boss', nextBillingDate: new Date('2026-01-01T00:00:00Z') });
});

it('edit after first occurrence: amount changes, start date and interval are refused', async () => {
  seedRecurring({ id: 'r1', startDate: '2026-01-01', billingInterval: 'ANNUAL', amount: 120000 });
  occurrences.count.mockResolvedValue(1);
  const updated = await service.updateSubscription(tenantId, 'r1', manager, { amount: 126000 });
  expect(updated.amount).toBe(126000);
  await expect(service.updateSubscription(tenantId, 'r1', manager, { startDate: '2026-02-01' })).rejects.toThrow(BadRequestException);
  await expect(service.updateSubscription(tenantId, 'r1', manager, { billingInterval: 'QUARTERLY' })).rejects.toThrow(BadRequestException);
});

it('turning auto-approve off clears who it runs as', async () => {
  seedRecurring({ id: 'r1', autoApprove: true, autoApproveById: 'u-boss' });
  const updated = await service.updateSubscription(tenantId, 'r1', manager, { autoApprove: false });
  expect(updated).toMatchObject({ autoApprove: false, autoApproveById: null });
});

it('resume moves the next date to the first occurrence on or after today, no back-fill', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-16T08:00:00Z'));
  seedRecurring({ id: 'r1', status: 'PAUSED', startDate: '2026-01-15', billingInterval: 'MONTHLY' });
  const row = await service.resumeSubscription(tenantId, 'r1');
  expect(row.status).toBe('ACTIVE');
  expect(row.nextBillingDate.toISOString().slice(0, 10)).toBe('2026-11-15');
  jest.useRealTimers();
});
```

(`seedRecurring` puts a row into the recurring repo mock's backing array; write it alongside the existing helpers.)

- [ ] **Step 2: Run** — `pnpm --filter api exec jest src/modules/finance/finance.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement** in `FinanceService` (inject `@InjectRepository(RecurringExpenseOccurrence) private readonly occurrences: Repository<RecurringExpenseOccurrence>`):

```ts
  private assertCanAutoApprove(actor: { permissions: Permission[] }, wants: boolean | undefined) {
    // Same rule as assertActorCanGrant: compared with what this actor holds.
    // A finance manager who cannot approve bills must not be able to set up
    // bills that approve themselves.
    if (wants && !actor.permissions.includes(PERMISSIONS.BILL_APPROVE)) {
      throw new ForbiddenException('Only someone who can approve bills can turn on auto-approve.');
    }
  }

  private toDto(row: RecurringExpense, last?: RecurringExpenseOccurrence | null): RecurringExpenseDto {
    return {
      id: row.id, tenantId: row.tenantId,
      supplierId: row.supplierId, supplierName: row.supplier?.companyName ?? null,
      vendorName: row.vendorName, category: row.category, amount: row.amount,
      currency: row.supplier?.currency ?? null,
      billingInterval: row.billingInterval, startDate: row.startDate, endDate: row.endDate,
      nextBillingDate: row.nextBillingDate.toISOString(),
      taxCodeId: row.taxCodeId, autoApprove: row.autoApprove, spreadOverPeriod: row.spreadOverPeriod,
      financeAccountId: row.financeAccountId, status: row.status,
      lastOccurrenceStatus: last?.status ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async findAllSubscriptions(tenantId: string): Promise<RecurringExpenseDto[]> {
    const rows = await this.recurringRepository.find({
      where: { tenantId },
      order: { nextBillingDate: 'ASC' },
      relations: { financeAccount: true, supplier: true },
    });
    const last = rows.length
      ? await this.occurrences
          .createQueryBuilder('o')
          .distinctOn(['o.recurringExpenseId'])
          .where('o.tenantId = :tenantId', { tenantId })
          .orderBy('o.recurringExpenseId')
          .addOrderBy('o.periodStart', 'DESC')
          .getMany()
      : [];
    const byId = new Map(last.map((o) => [o.recurringExpenseId, o]));
    return rows.map((r) => this.toDto(r, byId.get(r.id)));
  }

  async createSubscription(
    tenantId: string,
    actor: { userId: string; permissions: Permission[] },
    input: CreateRecurringExpensePayload,
  ): Promise<RecurringExpenseDto> {
    this.assertCanAutoApprove(actor, input.autoApprove);
    const saved = await this.recurringRepository.save(
      this.recurringRepository.create({
        tenantId,
        ...input,
        nextBillingDate: new Date(`${input.startDate}T00:00:00Z`),
        autoApproveById: input.autoApprove ? actor.userId : null,
        createdById: actor.userId,
        status: 'ACTIVE',
      }),
    );
    return this.findSubscription(tenantId, saved.id);
  }

  private async findSubscriptionRow(tenantId: string, id: string): Promise<RecurringExpense> {
    const row = await this.recurringRepository.findOne({ where: { id, tenantId }, relations: { supplier: true } });
    if (!row) throw new NotFoundException('Recurring expense not found');
    return row;
  }

  async findSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    const last = await this.occurrences.findOne({ where: { tenantId, recurringExpenseId: id }, order: { periodStart: 'DESC' } });
    return this.toDto(row, last);
  }

  async updateSubscription(
    tenantId: string,
    id: string,
    actor: { userId: string; permissions: Permission[] },
    input: UpdateRecurringExpensePayload,
  ): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    const reshapes =
      (input.startDate !== undefined && input.startDate !== row.startDate) ||
      (input.billingInterval !== undefined && input.billingInterval !== row.billingInterval);
    if (reshapes && (await this.occurrences.count({ where: { tenantId, recurringExpenseId: id } })) > 0) {
      throw new BadRequestException('The start date and interval cannot change once a bill has been generated. Cancel this one and create a new schedule.');
    }
    if (input.autoApprove === true && !row.autoApprove) {
      this.assertCanAutoApprove(actor, true);
      row.autoApproveById = actor.userId;
    }
    if (input.autoApprove === false) row.autoApproveById = null;

    Object.assign(row, input);
    if (row.billingInterval === 'MONTHLY') row.spreadOverPeriod = false;
    if (input.startDate !== undefined && reshapes) row.nextBillingDate = new Date(`${row.startDate}T00:00:00Z`);
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async pauseSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    if (row.status !== 'ACTIVE') throw new BadRequestException('Only an active schedule can be paused');
    row.status = 'PAUSED';
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async resumeSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    if (row.status !== 'PAUSED') throw new BadRequestException('Only a paused schedule can be resumed');
    // Paused months are deliberately not back-generated.
    const n = occurrenceIndexOnOrAfter(row.startDate, row.billingInterval, utcToday());
    row.nextBillingDate = new Date(`${occurrenceDate(row.startDate, n, row.billingInterval)}T00:00:00Z`);
    row.status = 'ACTIVE';
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async cancelSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    row.status = 'CANCELLED';
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async listOccurrences(tenantId: string, id: string): Promise<RecurringOccurrenceDto[]> {
    await this.findSubscriptionRow(tenantId, id);
    const rows = await this.occurrences.find({ where: { tenantId, recurringExpenseId: id }, order: { periodStart: 'DESC' } });
    const billIds = rows.map((r) => r.billId).filter((v): v is string => Boolean(v));
    const bills = billIds.length
      ? await this.recurringRepository.manager.getRepository(SupplierBill).find({ where: { tenantId, id: In(billIds) }, select: { id: true, billNumber: true } })
      : [];
    const numbers = new Map(bills.map((b) => [b.id, b.billNumber]));
    return rows.map((r) => ({
      id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, amount: r.amount,
      billId: r.billId, billNumber: r.billId ? (numbers.get(r.billId) ?? null) : null,
      status: r.status, error: r.error, attempts: r.attempts, createdAt: r.createdAt.toISOString(),
    }));
  }
```

Controller — replace the two subscription handlers and add the rest:

```ts
  @Get('subscriptions')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  findAllSubscriptions(@CurrentUser() user: AuthenticatedUser): Promise<RecurringExpenseDto[]> {
    return this.financeService.findAllSubscriptions(user.organizationId);
  }

  @Post('subscriptions')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  createSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createRecurringExpenseSchema)) body: CreateRecurringExpensePayload,
  ): Promise<RecurringExpenseDto> {
    return this.financeService.createSubscription(user.organizationId, { userId: user.id, permissions: user.permissions }, body);
  }

  @Patch('subscriptions/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  updateSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateRecurringExpenseSchema)) body: UpdateRecurringExpensePayload,
  ): Promise<RecurringExpenseDto> {
    return this.financeService.updateSubscription(user.organizationId, id, { userId: user.id, permissions: user.permissions }, body);
  }

  @Post('subscriptions/:id/pause')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  pauseSubscription(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.pauseSubscription(user.organizationId, id);
  }

  @Post('subscriptions/:id/resume')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  resumeSubscription(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.resumeSubscription(user.organizationId, id);
  }

  @Delete('subscriptions/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  cancelSubscription(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.cancelSubscription(user.organizationId, id);
  }

  @Get('subscriptions/:id/occurrences')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  listOccurrences(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.listOccurrences(user.organizationId, id);
  }
```

Import `Delete`, `zodBody` (`@/common/pipes/zod-validation.pipe`), the schemas and types. Remove `CreateRecurringExpenseDto` imports.

- [ ] **Step 4: Run** — `pnpm --filter api exec jest src/modules/finance` → PASS (update `finance.controller.spec.ts` if it called `createSubscription` with the old signature: pass `{ userId, permissions }`). `pnpm --filter api exec tsc --noEmit` → no errors in finance.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance
git commit -m "feat(api): validated recurring expense CRUD, pause/resume/cancel, auto-approve permission rule"
```

---

### Task 11: API — daily recurring bill generation

**Files:**
- Create: `apps/api/src/modules/overheads/overheads.module.ts`
- Create: `apps/api/src/modules/overheads/recurring-billing.service.ts`
- Test: `apps/api/src/modules/overheads/recurring-billing.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `OverheadsModule`)

**Interfaces:**
- Consumes: `PayablesService.create(tenantId, actorId | null, CreateBillPayload)`, `PayablesService.approve(tenantId, id, Actor)` (Task 9); `RbacService.resolveAccess(userId, organizationId): Promise<{ permissions: Permission[] }>`; `NotificationsService.notifyHolders(tenantId, permission, input)`; `AuditService.record(input)`; `TenantContextService`; `dueOccurrences`, `periodFor`, `occurrenceDate`, `utcToday` (Task 3).
- Produces: `RecurringBillingService.run(today?: string): Promise<void>` (the cron calls it), `RecurringBillingService.generateFor(row: RecurringExpense, today: string): Promise<void>`.

- [ ] **Step 1: Failing tests**

```ts
// apps/api/src/modules/overheads/recurring-billing.service.spec.ts
import { PERMISSIONS } from '@saas/shared';
import { RecurringBillingService } from './recurring-billing.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

function setup(over: Partial<any> = {}) {
  const claimed = new Set<string>();
  const occurrences: any[] = [];
  const row = {
    id: 'rec-1', tenantId, supplierId: 'sup-1', vendorName: 'Landlord', category: 'Rent & premises',
    amount: 10000, billingInterval: 'MONTHLY', startDate: '2026-07-01', endDate: null, taxCodeId: null,
    autoApprove: false, autoApproveById: null, spreadOverPeriod: false, createdById: 'u1',
    status: 'ACTIVE', nextBillingDate: new Date('2026-07-01T00:00:00Z'),
    ...over,
  };
  const occurrenceRepo = {
    // Emulates INSERT … ON CONFLICT DO NOTHING RETURNING
    claim: jest.fn(async (o: any) => {
      const key = `${o.recurringExpenseId}:${o.periodStart}`;
      if (claimed.has(key)) return null;
      claimed.add(key);
      const saved = { id: `occ-${occurrences.length + 1}`, attempts: 0, ...o };
      occurrences.push(saved);
      return saved;
    }),
    reclaimFailed: jest.fn(async () => null),
    update: jest.fn(async (id: string, patch: any) => Object.assign(occurrences.find((x) => x.id === id), patch)),
    countFailed: jest.fn(async () => 0),
  };
  const payables = {
    create: jest.fn(async (_t: string, _a: string | null, input: any) => ({ id: `bill-${input.supplierInvoiceNumber}`, billNumber: 'BILL-1', ...input })),
    approve: jest.fn(async () => ({})),
  };
  const rbac = { resolveAccess: jest.fn(async () => ({ permissions: [PERMISSIONS.BILL_APPROVE] })) };
  const notifications = { notifyHolders: jest.fn(async () => 1) };
  const audit = { record: jest.fn(async () => undefined) };
  const recurring = { save: jest.fn(async (r: any) => r), find: jest.fn(async () => [row]) };
  const tenantContext = { runAsSystem: (fn: any) => fn(), runWithTenant: (_t: string, fn: any) => fn() };
  const service = new RecurringBillingService(
    recurring as any, occurrenceRepo as any, payables as any, rbac as any,
    notifications as any, audit as any, tenantContext as any,
  );
  return { service, row, occurrences, payables, rbac, notifications, audit, recurring, occurrenceRepo };
}

describe('RecurringBillingService', () => {
  it('catches up every missed period with one draft bill each, oldest first', async () => {
    const { service, row, payables } = setup();
    await service.generateFor(row as any, '2026-10-16');
    expect(payables.create).toHaveBeenCalledTimes(4);
    expect(payables.create.mock.calls.map((c) => c[2].billDate.toISOString().slice(0, 10)))
      .toEqual(['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
    expect(row.nextBillingDate.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(payables.approve).not.toHaveBeenCalled();
  });

  it('two concurrent runs produce one bill per period', async () => {
    const { service, row, payables } = setup();
    await Promise.all([service.generateFor({ ...row } as any, '2026-07-02'), service.generateFor({ ...row } as any, '2026-07-02')]);
    expect(payables.create).toHaveBeenCalledTimes(1);
  });

  it('builds the bill line with category, period and a stable invoice number', async () => {
    const { service, row, payables } = setup({ billingInterval: 'ANNUAL', spreadOverPeriod: true, amount: 120000, startDate: '2026-01-01' });
    await service.generateFor(row as any, '2026-01-01');
    const input = payables.create.mock.calls[0][2];
    expect(input.supplierInvoiceNumber).toBe('REC-rec-1-2026-01-01');
    expect(input.lines).toEqual([expect.objectContaining({ qty: 1, unitCost: 120000, category: 'Rent & premises', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31' })]);
  });

  it('approves as the user who switched auto-approve on, with their current permissions', async () => {
    const { service, row, payables, rbac } = setup({ autoApprove: true, autoApproveById: 'u-boss' });
    await service.generateFor(row as any, '2026-07-01');
    expect(rbac.resolveAccess).toHaveBeenCalledWith('u-boss', tenantId);
    expect(payables.approve).toHaveBeenCalledWith(tenantId, expect.any(String), { userId: 'u-boss', permissions: [PERMISSIONS.BILL_APPROVE] });
  });

  it('leaves the bill as a draft and notifies when the approver lost bill:approve', async () => {
    const { service, row, payables, rbac, notifications } = setup({ autoApprove: true, autoApproveById: 'u-boss' });
    rbac.resolveAccess.mockResolvedValue({ permissions: [] });
    await service.generateFor(row as any, '2026-07-01');
    expect(payables.approve).not.toHaveBeenCalled();
    expect(notifications.notifyHolders).toHaveBeenCalledWith(tenantId, PERMISSIONS.FINANCE_MANAGE, expect.objectContaining({ title: expect.stringContaining('auto-approve') }));
  });

  it('marks a failed period FAILED, keeps the next date, notifies once', async () => {
    const { service, row, payables, occurrences, notifications } = setup();
    payables.create.mockRejectedValueOnce(new Error('Supplier not found'));
    await service.generateFor(row as any, '2026-07-01');
    expect(occurrences[0]).toMatchObject({ status: 'FAILED', error: 'Supplier not found', attempts: 1 });
    expect(row.nextBillingDate.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(notifications.notifyHolders).toHaveBeenCalledTimes(1);
  });

  it('stops at the end date', async () => {
    const { service, row, payables } = setup({ endDate: '2026-09-01' });
    await service.generateFor(row as any, '2026-10-16');
    expect(payables.create).toHaveBeenCalledTimes(2);
  });

  it('uses the amount at generation time (edits apply to future periods only)', async () => {
    const { service, row, payables } = setup();
    await service.generateFor(row as any, '2026-07-01');
    row.amount = 10500;
    await service.generateFor(row as any, '2026-08-01');
    expect(payables.create.mock.calls.map((c) => c[2].lines[0].unitCost)).toEqual([10000, 10500]);
  });

  it('records an audit row per generated bill', async () => {
    const { service, row, audit } = setup();
    await service.generateFor(row as any, '2026-07-01');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId, subjectType: 'RECURRING_EXPENSE', subjectId: 'rec-1', channel: 'SYSTEM' }));
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter api exec jest src/modules/overheads` → FAIL (module missing).

- [ ] **Step 3: Implement**

The `occurrenceRepo` in the test is a thin port; implement it as a small class in the same folder so the service stays testable:

```ts
// apps/api/src/modules/overheads/occurrence.store.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecurringExpenseOccurrence } from '../finance/entities/recurring-expense-occurrence.entity';

/** The claim: whoever inserts the (recurring expense, period) row bills it. */
@Injectable()
export class OccurrenceStore {
  constructor(@InjectRepository(RecurringExpenseOccurrence) private readonly repo: Repository<RecurringExpenseOccurrence>) {}

  async claim(o: Pick<RecurringExpenseOccurrence, 'tenantId' | 'recurringExpenseId' | 'occurrenceIndex' | 'periodStart' | 'periodEnd' | 'amount'>): Promise<RecurringExpenseOccurrence | null> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(RecurringExpenseOccurrence)
      .values({ ...o, status: 'FAILED', attempts: 0, error: 'in progress' })
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning('*')
      .execute();
    const raw = (result.raw as RecurringExpenseOccurrence[])[0];
    return raw ? this.repo.create(raw) : null;
  }

  /** A FAILED period is retried by whoever flips it back to in-progress first. */
  async reclaimFailed(recurringExpenseId: string, periodStart: string): Promise<RecurringExpenseOccurrence | null> {
    const result = await this.repo
      .createQueryBuilder()
      .update(RecurringExpenseOccurrence)
      .set({ error: 'in progress' })
      .where('"recurringExpenseId" = :recurringExpenseId AND "periodStart" = :periodStart', { recurringExpenseId, periodStart })
      .andWhere(`status = 'FAILED' AND (error IS NULL OR error <> 'in progress')`)
      .returning('*')
      .execute();
    const raw = (result.raw as RecurringExpenseOccurrence[])[0];
    return raw ? this.repo.create(raw) : null;
  }

  async update(id: string, patch: Partial<RecurringExpenseOccurrence>): Promise<void> {
    await this.repo.update({ id }, patch);
  }
}
```

Note: a claimed-but-crashed row stays `FAILED` with `error = 'in progress'`. Document this in FLAGS.md (Task 18); recovering it is a manual `UPDATE … SET error = 'stale'`. Keep it — it can never double-bill.

```ts
// apps/api/src/modules/overheads/recurring-billing.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { dueOccurrences, occurrenceDate, periodFor, PERMISSIONS, utcToday } from '@saas/shared';
import { RecurringExpense } from '../finance/entities/recurring-expense.entity';
import { PayablesService } from '../payables/payables.service';
import { RbacService } from '../rbac/rbac.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { OccurrenceStore } from './occurrence.store';

/**
 * Turns recurring expenses into supplier bills when they fall due.
 *
 * Runs in the API process (the Temporal worker has no ScheduleModule). Each
 * period is claimed by inserting its occurrence row first, so replicas and
 * re-runs cannot bill a period twice; a missed day catches up oldest first.
 */
@Injectable()
export class RecurringBillingService {
  private readonly logger = new Logger(RecurringBillingService.name);

  constructor(
    @InjectRepository(RecurringExpense) private readonly recurring: Repository<RecurringExpense>,
    private readonly occurrences: OccurrenceStore,
    private readonly payables: PayablesService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cron(): Promise<void> {
    await this.run();
  }

  async run(today: string = utcToday()): Promise<void> {
    const due = await this.tenantContext.runAsSystem(() =>
      this.recurring.find({
        where: { status: 'ACTIVE', supplierId: Not(IsNull()), nextBillingDate: LessThanOrEqual(new Date(`${today}T23:59:59Z`)) },
      }),
    );
    for (const row of due) {
      try {
        await this.tenantContext.runWithTenant(row.tenantId, () => this.generateFor(row, today));
      } catch (err) {
        this.logger.warn(`Recurring expense ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async generateFor(row: RecurringExpense, today: string): Promise<void> {
    const fromIndex = this.indexOf(row);
    for (const n of dueOccurrences({ startDate: row.startDate, endDate: row.endDate, interval: row.billingInterval, fromIndex, today })) {
      const period = periodFor(row.startDate, n, row.billingInterval);
      const claim =
        (await this.occurrences.claim({
          tenantId: row.tenantId, recurringExpenseId: row.id, occurrenceIndex: n,
          periodStart: period.start, periodEnd: period.end, amount: row.amount,
        })) ?? (await this.occurrences.reclaimFailed(row.id, period.start));
      if (!claim) {
        // Someone else has it (or it is already generated): move past it.
        row.nextBillingDate = new Date(`${occurrenceDate(row.startDate, n + 1, row.billingInterval)}T00:00:00Z`);
        await this.recurring.save(row);
        continue;
      }

      try {
        const bill = await this.payables.create(row.tenantId, row.createdById, {
          supplierId: row.supplierId!,
          purchaseOrderId: null,
          supplierInvoiceNumber: `REC-${row.id.slice(0, 8)}-${period.start}`,
          billDate: new Date(`${period.start}T00:00:00Z`),
          dueDate: null,
          taxAmount: 0,
          taxCodeId: row.taxCodeId,
          notes: `Generated from recurring expense "${row.vendorName}" for ${period.start} – ${period.end}`,
          lines: [{
            purchaseOrderLineId: null,
            description: `${row.vendorName} — ${row.category} (${period.start} – ${period.end})`,
            qty: 1,
            unitCost: row.amount,
            category: row.category,
            servicePeriodStart: row.spreadOverPeriod ? period.start : null,
            servicePeriodEnd: row.spreadOverPeriod ? period.end : null,
          }],
        });
        await this.occurrences.update(claim.id, { status: 'GENERATED', billId: bill.id, error: null, attempts: claim.attempts + 1 });
        row.nextBillingDate = new Date(`${occurrenceDate(row.startDate, n + 1, row.billingInterval)}T00:00:00Z`);
        await this.recurring.save(row);

        await this.audit.record({
          tenantId: row.tenantId,
          action: 'recurring_expense.generate',
          subjectType: 'RECURRING_EXPENSE',
          subjectId: row.id,
          actorId: null,
          actorName: 'Recurring billing',
          channel: 'SYSTEM',
          summary: `${bill.billNumber} for ${row.vendorName}, ${period.start} – ${period.end}`,
          after: { billId: bill.id, periodStart: period.start, amount: row.amount },
        });

        if (row.autoApprove) await this.autoApprove(row, bill.id, bill.billNumber);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.occurrences.update(claim.id, { status: 'FAILED', error: message.slice(0, 1000), attempts: claim.attempts + 1 });
        if (claim.attempts === 0) {
          await this.notifications.notifyHolders(row.tenantId, PERMISSIONS.FINANCE_MANAGE, {
            type: 'RECURRING_EXPENSE_FAILED',
            title: `Could not create the ${row.vendorName} bill for ${period.start}`,
            body: message,
            link: '/finance/subscriptions',
            entityType: 'RECURRING_EXPENSE',
            entityId: row.id,
          });
        }
        // Later periods wait for this one: bills stay in order.
        return;
      }
    }
  }

  private indexOf(row: RecurringExpense): number {
    // nextBillingDate is always an occurrence date; find its index from the anchor.
    const target = row.nextBillingDate.toISOString().slice(0, 10);
    let n = 0;
    while (occurrenceDate(row.startDate, n, row.billingInterval) < target) n++;
    return n;
  }

  private async autoApprove(row: RecurringExpense, billId: string, billNumber: string): Promise<void> {
    const approverId = row.autoApproveById;
    const access = approverId ? await this.rbac.resolveAccess(approverId, row.tenantId).catch(() => null) : null;
    if (!approverId || !access?.permissions.includes(PERMISSIONS.BILL_APPROVE)) {
      await this.notifications.notifyHolders(row.tenantId, PERMISSIONS.FINANCE_MANAGE, {
        type: 'RECURRING_EXPENSE_FAILED',
        title: `${billNumber} was left as a draft: auto-approve is set up by someone who can no longer approve bills`,
        link: `/purchasing/bills/${billId}`,
        entityType: 'RECURRING_EXPENSE',
        entityId: row.id,
      });
      return;
    }
    try {
      await this.payables.approve(row.tenantId, billId, { userId: approverId, permissions: access.permissions });
    } catch (err) {
      await this.notifications.notifyHolders(row.tenantId, PERMISSIONS.FINANCE_MANAGE, {
        type: 'RECURRING_EXPENSE_FAILED',
        title: `${billNumber} could not be auto-approved`,
        body: err instanceof Error ? err.message : String(err),
        link: `/purchasing/bills/${billId}`,
        entityType: 'RECURRING_EXPENSE',
        entityId: row.id,
      });
    }
  }
}
```

Check before finishing:
- `NotificationType` is a union in `@saas/shared` — add `'RECURRING_EXPENSE_FAILED'` to it (find with `grep -rn "NotificationType" packages/shared/src`), rebuild shared. If the notifications table has a CHECK/enum on `type`, extend it in the Task 8 migration (or a new one) — check with `grep -rn "notifications_type\|\"type\"" apps/api/src/database/migrations/1787000000000-CurrencyBillingAndNotifications.ts`.
- The bill detail route in web — confirm with `ls apps/web/src/app/\(app\)` and fix `link` paths to the real bill URL.
- `AuditRecordInput.actorId` must accept `null` and `channel` must accept `'SYSTEM'` (`packages/shared/src/platform/audit.ts:10-21` lists it).

Module:

```ts
// apps/api/src/modules/overheads/overheads.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringExpense } from '../finance/entities/recurring-expense.entity';
import { RecurringExpenseOccurrence } from '../finance/entities/recurring-expense-occurrence.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { PrepaidAmortization, PrepaidSchedule } from '../payables/entities/prepaid-schedule.entity';
import { FinanceModule } from '../finance/finance.module';
import { PayablesModule } from '../payables/payables.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuditModule } from '../audit/audit.module';
import { OccurrenceStore } from './occurrence.store';
import { RecurringBillingService } from './recurring-billing.service';

/** Overheads that post: recurring bills and prepaid release. */
@Module({
  imports: [
    TypeOrmModule.forFeature([RecurringExpense, RecurringExpenseOccurrence, JournalEntry, PrepaidSchedule, PrepaidAmortization]),
    FinanceModule,
    PayablesModule,
    NotificationsModule,
    RbacModule,
    AuditModule,
  ],
  providers: [OccurrenceStore, RecurringBillingService],
})
export class OverheadsModule {}
```

Check that `RbacModule` exports `RbacService`, `AuditModule` exports `AuditService`, and `FinanceModule` exports `LedgerService` (grep each module's `exports`). Also confirm `TenantContextService` is globally provided (it is injected in `InvoiceOverdueService` without a module import — follow the same). Add `OverheadsModule` to `app.module.ts` imports.

Update the test's constructor call order to match (`recurring, occurrences, payables, rbac, notifications, audit, tenantContext`) — it already does.

- [ ] **Step 4: Run** — `pnpm --filter api exec jest src/modules/overheads` → PASS. `pnpm --filter api build` → compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overheads apps/api/src/app.module.ts packages/shared/src
git commit -m "feat(api): daily job turns recurring expenses into bills, with catch-up and auto-approve"
```

---

### Task 12: API — prepaid release, end early, schedule listing

**Files:**
- Create: `apps/api/src/modules/overheads/prepaid.service.ts`, `apps/api/src/modules/overheads/prepaid.controller.ts`
- Test: `apps/api/src/modules/overheads/prepaid.service.spec.ts`
- Modify: `apps/api/src/modules/overheads/overheads.module.ts`, `recurring-billing.service.ts` (cron calls release)

**Interfaces:**
- Consumes: `prepaidSplit`, `addMonthsToFirst`, `firstOfMonth`, `utcToday` (Tasks 3–4); `LedgerService.resolveLines`; `PrepaidSchedule`, `PrepaidAmortization`, `JournalEntry`.
- Produces: `PrepaidService.releaseDue(today?: string)`, `PrepaidService.releaseSchedule(schedule, today)`, `PrepaidService.endEarly(tenantId, id, actorId)`, `PrepaidService.list(tenantId, billId?) : Promise<PrepaidScheduleDto[]>`. Routes `GET /finance/prepaid-schedules?billId=` (`bill:read`) and `POST /finance/prepaid-schedules/:id/end-early` (`finance:manage`).

- [ ] **Step 1: Failing tests**

```ts
// apps/api/src/modules/overheads/prepaid.service.spec.ts
import { PrepaidService } from './prepaid.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

function setup(schedule: any, already: string[] = []) {
  const amortizations: any[] = already.map((m) => ({ scheduleId: schedule.id, month: m, amount: 10000 }));
  const entries: any[] = [];
  const manager = {
    getRepository: (e: any) => {
      if (e.name === 'PrepaidAmortization') return {
        find: async () => amortizations,
        insertClaim: undefined,
        createQueryBuilder: () => ({ insert: () => ({ into: () => ({ values: (v: any) => ({ orIgnore: () => ({ returning: () => ({ execute: async () => {
          if (amortizations.some((a) => a.month === v.month)) return { raw: [] };
          amortizations.push(v); return { raw: [v] };
        } }) }) }) }) }) }),
        update: async () => undefined,
      };
      if (e.name === 'JournalEntry') return { create: (x: any) => x, save: async (x: any) => { const s = { id: `je-${entries.length + 1}`, ...x }; entries.push(s); return s; } };
      if (e.name === 'PrepaidSchedule') return { save: async (x: any) => x, findOne: async () => schedule, find: async () => [schedule] };
      throw new Error(e.name);
    },
  };
  const dataSource = { transaction: (fn: any) => fn(manager), manager };
  const ledger = { resolveLines: jest.fn(async (_t: string, lines: any[]) => lines.map((l) => ({ ...l, ledgerAccountId: l.role, ledgerAccountCode: l.role }))) };
  const tenantContext = { runAsSystem: (fn: any) => fn(), runWithTenant: (_t: string, fn: any) => fn() };
  const service = new PrepaidService(dataSource as any, ledger as any, tenantContext as any);
  return { service, amortizations, entries, ledger };
}

const annual = { id: 's1', tenantId, billId: 'b1', billLineId: 'l1', expenseRole: 'RENT', totalBase: 120000, firstMonth: '2026-01-01', months: 12, status: 'ACTIVE' };

describe('PrepaidService', () => {
  it('releases every month that has arrived, each dated the 1st of its month', async () => {
    const { service, entries } = setup({ ...annual });
    await service.releaseSchedule({ ...annual } as any, '2026-03-16');
    expect(entries.map((e) => e.entryDate.toISOString().slice(0, 10))).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(entries[0].lines).toEqual([
      expect.objectContaining({ role: 'RENT', debit: 10000, credit: 0 }),
      expect.objectContaining({ role: 'PREPAID_EXPENSES', debit: 0, credit: 10000 }),
    ]);
    expect(entries[0].referenceType).toBe('PREPAID');
  });

  it('skips months already released', async () => {
    const { service, entries } = setup({ ...annual }, ['2026-01-01']);
    await service.releaseSchedule({ ...annual } as any, '2026-02-10');
    expect(entries).toHaveLength(1);
  });

  it('completes after the last month, last month takes the remainder', async () => {
    const odd = { ...annual, totalBase: 1000, months: 3 };
    const sched = { ...odd };
    const { service, entries } = setup(sched);
    await service.releaseSchedule(sched as any, '2026-12-01');
    expect(entries.map((e) => e.totalAmount)).toEqual([333.33, 333.33, 333.34]);
    expect(sched.status).toBe('COMPLETED');
  });

  it('end early posts the unreleased remainder today and closes', async () => {
    const sched = { ...annual };
    const { service, entries } = setup(sched, ['2026-01-01', '2026-02-01']);
    await service.endEarly(tenantId, 's1', 'u1', '2026-03-05');
    expect(entries).toHaveLength(1);
    expect(entries[0].totalAmount).toBe(100000);
    expect(sched.status).toBe('ENDED_EARLY');
  });
});
```

(If the hand-rolled query-builder mock is too brittle, put the claim insert behind a tiny `AmortizationStore` like `OccurrenceStore` and mock that instead — preferred. The tests then mock `store.claim(v)` returning `v | null`.)

- [ ] **Step 2: Run** — `pnpm --filter api exec jest src/modules/overheads/prepaid` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/overheads/prepaid.service.ts
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  addMonthsToFirst, firstOfMonth, LEDGER_ROLES, prepaidSplit, utcToday,
  type LedgerRole, type PrepaidScheduleDto,
} from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { PrepaidAmortization, PrepaidSchedule } from '../payables/entities/prepaid-schedule.entity';
import { TenantContextService } from '@/common/context/tenant-context.service';

/**
 * Releases prepaid expenses to their expense account, one month at a time.
 * The (schedule, month) unique row is the claim, so a month posts once.
 */
@Injectable()
export class PrepaidService {
  private readonly logger = new Logger(PrepaidService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async releaseDue(today: string = utcToday()): Promise<void> {
    const active = await this.tenantContext.runAsSystem(() =>
      this.dataSource.manager.getRepository(PrepaidSchedule).find({ where: { status: 'ACTIVE' } }),
    );
    for (const schedule of active) {
      try {
        await this.tenantContext.runWithTenant(schedule.tenantId, () => this.releaseSchedule(schedule, today));
      } catch (err) {
        this.logger.warn(`Prepaid schedule ${schedule.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async releaseSchedule(schedule: PrepaidSchedule, today: string): Promise<void> {
    const split = prepaidSplit(schedule.totalBase, schedule.months);
    const currentMonth = firstOfMonth(today);
    for (let k = 0; k < schedule.months; k++) {
      const month = addMonthsToFirst(schedule.firstMonth, k);
      if (month > currentMonth) break;
      await this.dataSource.transaction((manager) => this.postMonth(manager, schedule, month, split[k], `Release ${k + 1} of ${schedule.months}`));
    }
    if (addMonthsToFirst(schedule.firstMonth, schedule.months - 1) <= currentMonth) {
      schedule.status = 'COMPLETED';
      await this.dataSource.manager.getRepository(PrepaidSchedule).save(schedule);
    }
  }

  /** Inserts the claim row and the journal entry together; returns false if the month was already posted. */
  private async postMonth(manager: EntityManager, schedule: PrepaidSchedule, month: string, amount: number, label: string): Promise<boolean> {
    const journal = manager.getRepository(JournalEntry);
    const lines = await this.ledger.resolveLines(schedule.tenantId, [
      { role: schedule.expenseRole as LedgerRole, accountName: 'Released from prepaid', debit: amount, credit: 0, description: `${label} — bill line ${schedule.billLineId}` },
      { role: LEDGER_ROLES.PREPAID_EXPENSES, accountName: 'Prepaid expenses', debit: 0, credit: amount, description: `${label} — bill line ${schedule.billLineId}` },
    ], manager);
    const entry = await journal.save(journal.create({
      tenantId: schedule.tenantId,
      entryNumber: `JE-PRE-${schedule.id.slice(0, 8)}-${month.slice(0, 7)}`,
      referenceType: 'PREPAID',
      referenceId: schedule.id,
      entryDate: new Date(`${month}T00:00:00Z`),
      totalAmount: amount,
      lines,
    }));
    const claimed = await manager
      .getRepository(PrepaidAmortization)
      .createQueryBuilder()
      .insert()
      .into(PrepaidAmortization)
      .values({ tenantId: schedule.tenantId, scheduleId: schedule.id, month, amount, journalEntryId: entry.id })
      .orIgnore()
      .returning('*')
      .execute();
    if (!(claimed.raw as unknown[]).length) {
      // Another run posted this month first. Throwing rolls back our entry.
      throw new MonthAlreadyPosted();
    }
    return true;
  }
```

Wrap the per-month `transaction` call in `releaseSchedule` with `try { … } catch (e) { if (!(e instanceof MonthAlreadyPosted)) throw e; }`, and declare `class MonthAlreadyPosted extends Error {}` at module scope. (The entry is inserted before the claim so the claim row can carry `journalEntryId`; losing the race rolls both back.)

Continue the class:

```ts
  async endEarly(tenantId: string, id: string, actorId: string, today: string = utcToday()): Promise<PrepaidScheduleDto> {
    return this.dataSource.transaction(async (manager) => {
      const schedule = await manager.getRepository(PrepaidSchedule).findOne({ where: { id, tenantId } });
      if (!schedule) throw new NotFoundException('Prepaid schedule not found');
      if (schedule.status !== 'ACTIVE') throw new BadRequestException('This schedule is already closed');
      const released = await manager.getRepository(PrepaidAmortization).find({ where: { tenantId, scheduleId: id } });
      const releasedAmount = Math.round(released.reduce((s, a) => s + Number(a.amount), 0) * 100) / 100;
      const remainder = Math.round((schedule.totalBase - releasedAmount) * 100) / 100;
      if (remainder > 0) {
        await this.postMonth(manager, schedule, today, remainder, `Ended early by ${actorId}`);
      }
      schedule.status = 'ENDED_EARLY';
      await manager.getRepository(PrepaidSchedule).save(schedule);
      return this.toDto(schedule, [...released, { amount: remainder } as PrepaidAmortization]);
    });
  }

  async list(tenantId: string, billId?: string): Promise<PrepaidScheduleDto[]> {
    const repo = this.dataSource.manager.getRepository(PrepaidSchedule);
    const schedules = await repo.find({ where: billId ? { tenantId, billId } : { tenantId }, order: { createdAt: 'DESC' } });
    const amortizations = schedules.length
      ? await this.dataSource.manager.getRepository(PrepaidAmortization).find({ where: { tenantId } })
      : [];
    return schedules.map((s) => this.toDto(s, amortizations.filter((a) => a.scheduleId === s.id)));
  }

  private toDto(s: PrepaidSchedule, released: Pick<PrepaidAmortization, 'amount'>[]): PrepaidScheduleDto {
    const releasedAmount = Math.round(released.reduce((sum, a) => sum + Number(a.amount), 0) * 100) / 100;
    return {
      id: s.id, billId: s.billId, billLineId: s.billLineId, expenseRole: s.expenseRole,
      totalBase: s.totalBase, firstMonth: s.firstMonth, months: s.months,
      releasedMonths: released.length, releasedAmount,
      remainingAmount: Math.round((s.totalBase - releasedAmount) * 100) / 100,
      status: s.status,
    };
  }
}
```

Note: the end-early entry is keyed by `today` as `month`; if today's month was already released by the monthly pass, the unique `(scheduleId, month)` would collide. Use `month = today` (a full date, not a first-of-month) for end-early — the column is `date`, so `2026-03-05` ≠ `2026-03-01`. That is what the code above does.

Controller:

```ts
// apps/api/src/modules/overheads/prepaid.controller.ts
import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type PrepaidScheduleDto } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { PrepaidService } from './prepaid.service';

@ApiTags('finance')
@Controller('finance/prepaid-schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrepaidController {
  constructor(private readonly prepaid: PrepaidService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILL_READ)
  list(@CurrentUser() user: AuthenticatedUser, @Query('billId', new ParseUUIDPipe({ optional: true })) billId?: string): Promise<PrepaidScheduleDto[]> {
    return this.prepaid.list(user.organizationId, billId);
  }

  @Post(':id/end-early')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  endEarly(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<PrepaidScheduleDto> {
    return this.prepaid.endEarly(user.organizationId, id, user.id);
  }
}
```

Register `PrepaidService` (provider) and `PrepaidController` (controller) in `OverheadsModule`. In `RecurringBillingService.cron()` call `await this.prepaid.releaseDue();` after `await this.run();` — inject `PrepaidService` (add it to the spec's constructor call as an extra `{ releaseDue: jest.fn() }` argument at the end, and to the constructor at the end).

- [ ] **Step 4: Run** — `pnpm --filter api exec jest src/modules/overheads` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overheads
git commit -m "feat(api): release prepaid expenses monthly, end-early, schedule listing"
```

---

### Task 13: API — runway fix and cash forecast

**Files:**
- Modify: `apps/api/src/modules/finance/finance.service.ts:53-137`
- Modify: `apps/api/src/modules/finance/finance.controller.ts` (new route)
- Test: `apps/api/src/modules/finance/finance.service.spec.ts`

**Interfaces:**
- Consumes: `monthlyEquivalent`, `occurrenceDate`, `dueOccurrences`, `utcToday`, `isoDate` (Task 3); `CashForecastDto` (Task 5); `Invoice`, `SupplierBill` repos (already registered in `FinanceModule`).
- Produces: `FinanceService.cashForecast(tenantId, months: number): Promise<CashForecastDto>`; `GET /finance/cash-forecast?months=` (`finance:read`).

- [ ] **Step 1: Failing tests**

```ts
describe('runway', () => {
  it('counts quarterly recurring at a third and only the last 90 days of claims', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
    seedAccounts([{ balance: 100000 }]);
    seedRecurringRows([{ amount: 3000, billingInterval: 'QUARTERLY', status: 'ACTIVE' }]);
    seedClaims([
      { amount: 900, status: 'APPROVED', expenseDate: '2026-09-01' },
      { amount: 50000, status: 'PAID', expenseDate: '2025-01-01' },
    ]);
    const o = await service.getOverview(tenantId);
    expect(o.monthlyOutflow).toBe(1000 + 300);
    jest.useRealTimers();
  });
});

describe('cashForecast', () => {
  it('buckets bills by due date, projects recurring, adds receivables, carries the balance', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
    seedAccounts([{ balance: 50000 }]);
    seedBills([
      { status: 'APPROVED', totalAmount: 8000, paidAmount: 0, dueDate: '2026-10-30', fxRate: 1 },
      { status: 'DRAFT', totalAmount: 2000, paidAmount: 0, dueDate: '2026-09-01', fxRate: 1 }, // overdue → month 1
    ]);
    seedRecurringRows([{ amount: 120000, billingInterval: 'ANNUAL', status: 'ACTIVE', startDate: '2026-01-01', nextBillingDate: new Date('2027-01-01T00:00:00Z'), endDate: null }]);
    seedInvoices([{ status: 'ISSUED', amount: 30000, paidAmount: 0, dueDate: '2026-11-10', fxRate: 1 }]);
    const f = await service.cashForecast(tenantId, 4);
    expect(f.months.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(f.months[0]).toMatchObject({ opening: 50000, billsOut: 10000, inflows: 0, closing: 40000 });
    expect(f.months[1]).toMatchObject({ opening: 40000, inflows: 30000, closing: 70000 });
    expect(f.months[3]).toMatchObject({ recurringOut: 120000, closing: -50000 });
    jest.useRealTimers();
  });
});
```

Write `seedBills`/`seedInvoices` helpers next to the existing ones; register mock repos for `SupplierBill` and `Invoice` in the spec's testing module.

- [ ] **Step 2: Run** — `pnpm --filter api exec jest src/modules/finance/finance.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement.** In `getOverview`:

```ts
    const recurringMonthly = recurringExpenses.reduce(
      (sum, rec) => sum + monthlyEquivalent(Number(rec.amount || 0), rec.billingInterval),
      0,
    );

    // A month's worth of claims, averaged over the last quarter. Summing
    // every claim ever approved made the burn rate grow for ever.
    const claimsSince = new Date();
    claimsSince.setUTCDate(claimsSince.getUTCDate() - 90);
    const expenseMonthly =
      approvedExpenses
        .filter((e) => e.expenseDate && new Date(e.expenseDate) >= claimsSince)
        .reduce((sum, exp) => sum + Number(exp.amount || 0), 0) / 3;
```

(Check the claim date field name in `expense-claim.entity.ts` — `expenseDate` is used in `postExpenseAccrual`; fall back to `createdAt` when null: `new Date(e.expenseDate ?? e.createdAt)`.)

Add `cashForecast` (inject `@InjectRepository(SupplierBill) bills` and `@InjectRepository(Invoice) invoices`):

```ts
  async cashForecast(tenantId: string, months: number): Promise<CashForecastDto> {
    const today = utcToday();
    const monthKeys = Array.from({ length: months }, (_, k) => addMonthsClamped(`${today.slice(0, 7)}-01`, k).slice(0, 7));
    const last = monthKeys[monthKeys.length - 1];
    const bucket = (iso: string | null) => {
      const key = (iso ?? today).slice(0, 7);
      if (key < monthKeys[0]) return monthKeys[0]; // overdue lands now
      return key <= last ? key : null;
    };

    const [accounts, bills, invoices, recurring] = await Promise.all([
      this.accountRepository.find({ where: { tenantId } }),
      this.bills.find({ where: { tenantId, status: In(['DRAFT', 'APPROVED', 'PARTIALLY_PAID']) } }),
      this.invoices.find({ where: { tenantId, status: In([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID]) } }),
      this.recurringRepository.find({ where: { tenantId, status: 'ACTIVE' } }),
    ]);

    const rows = new Map(monthKeys.map((m) => [m, { inflows: 0, billsOut: 0, recurringOut: 0 }]));
    for (const b of bills) {
      const key = bucket(b.dueDate ? isoDate(b.dueDate) : isoDate(b.billDate));
      if (!key) continue;
      // Drafts have no posted rate yet; use 1 for same-currency, else today's rate is out of scope — see FLAGS.
      rows.get(key)!.billsOut += (Number(b.totalAmount) - Number(b.paidAmount)) * Number(b.fxRate || 1);
    }
    for (const inv of invoices) {
      const key = bucket(inv.dueDate ? isoDate(inv.dueDate) : today);
      if (!key) continue;
      rows.get(key)!.inflows += (Number(inv.amount) - Number(inv.paidAmount ?? 0)) * Number((inv as any).fxRate || 1);
    }
    for (const r of recurring) {
      // Only periods not yet generated: from nextBillingDate on.
      const fromIndex = occurrenceIndexOnOrAfter(r.startDate, r.billingInterval, isoDate(r.nextBillingDate));
      for (const n of dueOccurrences({ startDate: r.startDate, endDate: r.endDate, interval: r.billingInterval, fromIndex, today: `${last}-31` })) {
        const key = bucket(occurrenceDate(r.startDate, n, r.billingInterval));
        if (key) rows.get(key)!.recurringOut += Number(r.amount);
      }
    }

    let opening = round2(accounts.reduce((s, a) => s + Number(a.balance || 0), 0));
    const out = monthKeys.map((month) => {
      const r = rows.get(month)!;
      const closing = round2(opening + r.inflows - r.billsOut - r.recurringOut);
      const row = { month, opening, inflows: round2(r.inflows), billsOut: round2(r.billsOut), recurringOut: round2(r.recurringOut), closing };
      opening = closing;
      return row;
    });
    return { baseCurrency: accounts[0]?.currency || 'USD', months: out };
  }
```

Define `const round2 = (n: number) => Math.round(n * 100) / 100;` at module scope. Confirm `Invoice` field names (`amount`, `paidAmount`, `dueDate`, `fxRate`) with `grep -n "Column" apps/api/src/modules/quotes/entities/invoice.entity.ts` and adjust. Note `dueOccurrences`'s `today` param is compared as a string, so `'2027-01-31'`-style end bounds work; use `` `${last}-31` `` (string comparison is safe even for 30-day months).

Controller:

```ts
  @Get('cash-forecast')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  cashForecast(
    @CurrentUser() user: AuthenticatedUser,
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
  ): Promise<CashForecastDto> {
    return this.financeService.cashForecast(user.organizationId, Math.min(12, Math.max(1, months)));
  }
```

- [ ] **Step 4: Run** — same jest → PASS; `pnpm --filter api exec jest src/modules/finance` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance
git commit -m "fix(api): runway counts every interval and a 90-day claim window; add cash forecast"
```

---

### Task 14: API — audit subjects for /finance routes

**Files:**
- Modify: `apps/api/src/modules/audit/audit-subjects.ts`
- Modify: `apps/api/src/modules/audit/audit.interceptor.ts:68-140`
- Test: `apps/api/src/modules/audit/audit-subjects.spec.ts` (create, or extend existing if present: `ls apps/api/src/modules/audit/*.spec.ts`)

**Interfaces:**
- Produces: `auditSubjectFor(segments: string[]): { key: string; mapped?: { subject; entity }; idSegment: string | undefined }`.

- [ ] **Step 1: Failing test**

```ts
import { auditSubjectFor, subjectForSegment } from './audit-subjects';

describe('auditSubjectFor', () => {
  it('prefers a two-segment key under /finance', () => {
    const s = auditSubjectFor(['finance', 'subscriptions', 'abc', 'pause']);
    expect(s.key).toBe('finance/subscriptions');
    expect(s.mapped?.subject).toBe('RECURRING_EXPENSE');
    expect(s.idSegment).toBe('abc');
  });

  it('keeps one-segment keys working', () => {
    const s = auditSubjectFor(['bills', 'xyz', 'approve']);
    expect(s.key).toBe('bills');
    expect(s.idSegment).toBe('xyz');
  });

  it('maps finance expenses and accounts', () => {
    expect(auditSubjectFor(['finance', 'expenses', 'e1']).mapped?.subject).toBe('EXPENSE_CLAIM');
    expect(auditSubjectFor(['finance', 'accounts', 'a1']).mapped?.subject).toBe('FINANCE_ACCOUNT');
    expect(auditSubjectFor(['finance', 'prepaid-schedules', 'p1', 'end-early']).mapped?.subject).toBe('PREPAID_SCHEDULE');
  });

  it('names an unmapped two-segment key by its last segment', () => {
    expect(subjectForSegment('finance/budgets')).toBe('BUDGET');
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter api exec jest src/modules/audit` → FAIL.

- [ ] **Step 3: Implement.** In `audit-subjects.ts` replace the `'expense-claims'` and `'finance-accounts'` keys (they never matched) with:

```ts
  'finance/expenses': { subject: 'EXPENSE_CLAIM', entity: ExpenseClaim },
  'finance/accounts': { subject: 'FINANCE_ACCOUNT', entity: FinanceAccount },
  'finance/subscriptions': { subject: 'RECURRING_EXPENSE', entity: RecurringExpense },
  'finance/prepaid-schedules': { subject: 'PREPAID_SCHEDULE', entity: PrepaidSchedule },
```

Update the doc comment ("first segment, or the first two for routes nested under a module prefix such as /finance"). Add:

```ts
export function auditSubjectFor(segments: string[]): {
  key: string;
  mapped?: { subject: string; entity: EntityTarget<ObjectLiteral> };
  idSegment: string | undefined;
} {
  const two = segments.length > 1 ? `${segments[0]}/${segments[1]}` : null;
  if (two && AUDIT_SUBJECTS[two]) return { key: two, mapped: AUDIT_SUBJECTS[two], idSegment: segments[2] };
  if (two && segments[0] === 'finance') return { key: two, mapped: undefined, idSegment: segments[2] };
  return { key: segments[0], mapped: AUDIT_SUBJECTS[segments[0]], idSegment: segments[1] };
}

export function subjectForSegment(segment: string): string {
  const mapped = AUDIT_SUBJECTS[segment];
  if (mapped) return mapped.subject;
  const last = segment.split('/').pop()!;
  return last.replace(/s$/, '').replace(/-/g, '_').toUpperCase();
}
```

In the interceptor, after computing `head` and the skip check, replace `const mapped = AUDIT_SUBJECTS[head];` and `const paramId = idFrom(req.params?.id) ?? idFrom(segments[1]);` with:

```ts
    const subject = auditSubjectFor(segments);
    const mapped = subject.mapped;
    const paramId = idFrom(req.params?.id) ?? idFrom(subject.idSegment);
```

and pass `subject.key` instead of `head` into `this.write(...)`; inside `write`, replace `AUDIT_SUBJECTS[head]` with `AUDIT_SUBJECTS[head]` → keep, since `head` is now the key (rename the param to `key` for clarity). Bodyless/skip checks keep using `segments[0]`. `auditActionFor(req.method, segments)` is unchanged — check its output for `/finance/subscriptions/:id/pause` is acceptable (expected `finance.pause` or similar); if it produces something unhelpful, leave as-is and note in FLAGS.

- [ ] **Step 4: Run** — `pnpm --filter api exec jest src/modules/audit` → PASS (including any existing interceptor spec).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/audit
git commit -m "fix(audit): snapshot /finance routes by their two-segment subject"
```

---

### Task 15: API — P&L parents, seed, books check

**Files:**
- Modify: `apps/api/src/modules/finance/reports.service.ts:61-94`
- Modify: `apps/api/src/database/seeds/run-seed.ts`
- Test: `apps/api/src/modules/finance/reports.service.spec.ts` if it exists (else add a focused test to `reports.csv.spec.ts`'s module setup — check with `ls`)

**Interfaces:**
- Produces: `StatementLineDto.parentId` populated.

- [ ] **Step 1: Failing test** — assert `profitAndLoss` returns `parentId` for a child account:

```ts
it('carries the parent account on each statement line', async () => {
  ledger.list.mockResolvedValue([
    { id: 'p', code: '6000', name: 'Other operating expense', type: 'EXPENSE', parentId: null },
    { id: 'c', code: '6100', name: 'Rent & premises', type: 'EXPENSE', parentId: 'p' },
  ]);
  journal.find.mockResolvedValue([{ lines: [{ ledgerAccountId: 'c', debit: 100, credit: 0 }, { ledgerAccountId: 'p', debit: 5, credit: 0 }] }]);
  const pl = await service.profitAndLoss(tenantId, new Date('2026-01-01'), new Date('2026-12-31'));
  expect(pl.expenses.find((l) => l.code === '6100')!.parentId).toBe('p');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — in `balances()` map add `parentId: account.parentId ?? null,`.

Seed — in `run-seed.ts`, after the first tenant is registered (find the variable holding its id and an admin user id), add:

```ts
  // One annual lease, started three months ago and set to auto-approve, so
  // CI's books check covers bill generation, prepaid and the release catch-up.
  const supplier = await ds.getRepository(Supplier).save(ds.getRepository(Supplier).create({ tenantId, companyName: 'Seed Properties LLC', currency: baseCurrency }));
  const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 3); start.setUTCDate(1);
  await ds.getRepository(RecurringExpense).save(ds.getRepository(RecurringExpense).create({
    tenantId, supplierId: supplier.id, vendorName: 'Seed Properties LLC', category: 'Rent & premises',
    amount: 120000, billingInterval: 'ANNUAL', startDate: isoDate(start), endDate: null,
    nextBillingDate: start, autoApprove: true, autoApproveById: adminUserId, spreadOverPeriod: true,
    createdById: adminUserId, status: 'ACTIVE',
  }));
  await app.get(RecurringBillingService).run();
  await app.get(PrepaidService).releaseDue();
```

Use the seed's existing way of getting the Nest app / DataSource and its tenant context (it calls `auth.register`; check whether it runs inside `tenantContext.runAsSystem` — `run()` and `releaseDue()` set their own context, so call them outside any tenant context). Check `Supplier` required columns (`grep -n "Column" apps/api/src/modules/purchasing/entities/supplier.entity.ts`) and fill the non-nullable ones.

- [ ] **Step 4: Verify end-to-end**

```bash
pnpm db:reset && pnpm migration:run && pnpm seed && pnpm --filter api check:books
```

(The script name — see `.github/workflows/ci.yml:110-119`; use the same command CI runs.)
Expected: books balanced for every tenant. Spot check: `select code, ... from journal_entries` contains one `BILL` entry debiting 1400 for 120000 and four `PREPAID` entries (3 past months + current) of 10000 to 6100.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance/reports.service.ts apps/api/src/modules/finance/*.spec.ts apps/api/src/database/seeds/run-seed.ts
git commit -m "feat(api): P&L carries parent accounts; seed an annual lease through the books check"
```

---

### Task 16: Web — subscriptions: client, hooks, form, table

**Files:**
- Modify: `apps/web/src/lib/api/endpoints/finance.ts:39-41`
- Modify: `apps/web/src/hooks/use-finance.ts:162-176`
- Create: `apps/web/src/components/finance/subscriptions/subscription-form-modal.tsx` (replaces `create-subscription-modal.tsx`, delete it)
- Modify: `apps/web/src/components/finance/subscriptions/subscriptions-view.tsx`, `subscriptions-table.tsx`

**Interfaces:**
- Consumes: shared schemas/types (Task 5), `monthlyEquivalent`, `BILLING_INTERVALS`, `EXPENSE_CATEGORY_GROUPS`, routes (Tasks 10, 13).
- Produces: hooks `useRecurringExpenses`, `useCreateRecurringExpense`, `useUpdateRecurringExpense`, `usePauseRecurringExpense`, `useResumeRecurringExpense`, `useCancelRecurringExpense`, `useRecurringOccurrences(id)`, `useCashForecast(months)`, `usePrepaidSchedules(billId)`, `useEndPrepaidEarly()`.

- [ ] **Step 1: API client**

```ts
    listSubscriptions: () => apiFetch<RecurringExpenseDto[]>('/finance/subscriptions'),
    createSubscription: (payload: CreateRecurringExpensePayload) =>
      apiFetch<RecurringExpenseDto>('/finance/subscriptions', { method: 'POST', body: payload }),
    updateSubscription: (id: string, payload: UpdateRecurringExpensePayload) =>
      apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}`, { method: 'PATCH', body: payload }),
    pauseSubscription: (id: string) => apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}/pause`, { method: 'POST' }),
    resumeSubscription: (id: string) => apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}/resume`, { method: 'POST' }),
    cancelSubscription: (id: string) => apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}`, { method: 'DELETE' }),
    listOccurrences: (id: string) => apiFetch<RecurringOccurrenceDto[]>(`/finance/subscriptions/${id}/occurrences`),
    cashForecast: (months = 6) => apiFetch<CashForecastDto>('/finance/cash-forecast', { query: { months } }),
    listPrepaidSchedules: (billId: string) => apiFetch<PrepaidScheduleDto[]>('/finance/prepaid-schedules', { query: { billId } }),
    endPrepaidEarly: (id: string) => apiFetch<PrepaidScheduleDto>(`/finance/prepaid-schedules/${id}/end-early`, { method: 'POST' }),
```

- [ ] **Step 2: Hooks** — follow the existing `useCreateRecurringExpense` shape for each mutation (invalidate subscriptions; for prepaid also invalidate the bill query key — find it in `use-payables` or similar with `grep -rn "queryKeys.bill" apps/web/src/hooks`). Add `queryKeys.financeOccurrences(id)`, `queryKeys.financeCashForecast(months)`, `queryKeys.prepaidSchedules(billId)` to the query-key file (`grep -rn "financeSubscriptions" apps/web/src/lib`).

```ts
export function useUpdateRecurringExpense() {
  const { invalidateSubscriptions } = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRecurringExpensePayload }) => api.finance.updateSubscription(id, input),
    onSuccess: async (sub) => { await invalidateSubscriptions(); toast.success(`"${sub.vendorName}" updated`); },
    onError: (error) => toast.error(describe(error, 'Could not update recurring expense')),
  });
}
// pause / resume / cancel: same shape, toast "Paused" / "Resumed" / "Cancelled"

export function useRecurringOccurrences(id: string | null) {
  return useQuery({ queryKey: queryKeys.financeOccurrences(id ?? ''), queryFn: () => api.finance.listOccurrences(id!), enabled: Boolean(id) });
}

export function useCashForecast(months = 6) {
  return useQuery({ queryKey: queryKeys.financeCashForecast(months), queryFn: () => api.finance.cashForecast(months) });
}
```

- [ ] **Step 3: Form modal** (react-hook-form + shared zod, per CLAUDE.md "Zod schemas transform"). Use the existing UI primitives the old modal used (`Dialog`, `Button`, `Input`, `Select` from `@/components/ui/...`). Find the supplier picker used by the bill form (`grep -rln "supplierId" apps/web/src/components/purchasing apps/web/src/components/payables`) and reuse it; same for the category combobox used by `submit-expense-modal.tsx:254`. Find the hook exposing the current user's permissions (`grep -rn "usePermissions\|hasPermission" apps/web/src/hooks | head`).

```tsx
'use client';

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  BILLING_INTERVALS, PERMISSIONS, createRecurringExpenseSchema, monthlyEquivalent,
  type CreateRecurringExpensePayload, type RecurringExpenseDto,
} from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
// + the supplier picker, category combobox and permission hook found above

type FormIn = z.input<typeof createRecurringExpenseSchema>;
type FormOut = z.output<typeof createRecurringExpenseSchema>;

const INTERVAL_LABEL: Record<(typeof BILLING_INTERVALS)[number], string> = {
  MONTHLY: 'Monthly', QUARTERLY: 'Quarterly (4 a year)', SEMI_ANNUAL: 'Every 6 months', ANNUAL: 'Annually',
};

export interface SubscriptionFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing. */
  existing?: RecurringExpenseDto | null;
  /** True once a bill has been generated — start date and interval lock. */
  hasOccurrences?: boolean;
  onSubmit: (payload: CreateRecurringExpensePayload) => Promise<void>;
  isLoading?: boolean;
}

export function SubscriptionFormModal({ open, onClose, existing, hasOccurrences, onSubmit, isLoading }: SubscriptionFormModalProps) {
  const canApproveBills = useHasPermission(PERMISSIONS.BILL_APPROVE);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createRecurringExpenseSchema),
    defaultValues: toDefaults(existing),
  });
  useEffect(() => form.reset(toDefaults(existing)), [existing, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const interval = form.watch('billingInterval');
  const amount = Number(form.watch('amount') || 0);

  return (
    <Dialog open={open} onClose={onClose} title={existing ? 'Edit recurring expense' : 'New recurring expense'}>
      <form onSubmit={form.handleSubmit(async (v) => { await onSubmit(v); onClose(); })} className="space-y-4">
        <Controller control={form.control} name="supplierId" render={({ field }) => (
          <SupplierPicker value={field.value ?? null} onChange={(id, supplier) => { field.onChange(id); if (supplier && !form.getValues('vendorName')) form.setValue('vendorName', supplier.companyName); }} />
        )} />
        {!form.watch('supplierId') && <p className="text-xs text-warning">Without a supplier this stays in the forecast but no bills are created.</p>}
        <Input label="Name" {...form.register('vendorName')} error={form.formState.errors.vendorName?.message} />
        <Controller control={form.control} name="category" render={({ field }) => <CategoryCombobox value={field.value} onChange={field.onChange} />} />
        <Input label="Amount per bill" type="number" step="0.01" {...form.register('amount')} error={form.formState.errors.amount?.message} />
        <Select label="Billed" disabled={hasOccurrences} {...form.register('billingInterval')}>
          {BILLING_INTERVALS.map((i) => <option key={i} value={i}>{INTERVAL_LABEL[i]}</option>)}
        </Select>
        {interval !== 'MONTHLY' && amount > 0 && (
          <p className="text-xs text-ink-muted">≈ {monthlyEquivalent(amount, interval as never).toLocaleString()} a month</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="First bill on" type="date" disabled={hasOccurrences} {...form.register('startDate')} error={form.formState.errors.startDate?.message} />
          <Input label="Ends (optional)" type="date" {...form.register('endDate')} error={form.formState.errors.endDate?.message} />
        </div>
        {interval !== 'MONTHLY' && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" {...form.register('spreadOverPeriod')} />
            <span>Spread over the period<br /><span className="text-xs text-ink-muted">Book to prepaid and expense an equal amount each month, so each month's profit carries its share.</span></span>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm" title={canApproveBills ? undefined : 'Only someone who can approve bills can turn this on'}>
          <input type="checkbox" disabled={!canApproveBills} {...form.register('autoApprove')} />
          <span>Approve bills automatically<br /><span className="text-xs text-ink-muted">For fixed amounts like rent. Leave off for bills that vary, like DEWA.</span></span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isLoading}>{existing ? 'Save' : 'Create'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function toDefaults(e?: RecurringExpenseDto | null): FormIn {
  if (!e) return { supplierId: null, vendorName: '', category: 'Rent & premises', amount: '' as unknown as number, billingInterval: 'MONTHLY', startDate: new Date().toISOString().slice(0, 10), endDate: null, taxCodeId: null, autoApprove: false };
  return { supplierId: e.supplierId, vendorName: e.vendorName, category: e.category, amount: e.amount, billingInterval: e.billingInterval, startDate: e.startDate, endDate: e.endDate, taxCodeId: e.taxCodeId, autoApprove: e.autoApprove, spreadOverPeriod: e.spreadOverPeriod };
}
```

Adapt prop names of `Dialog`/`Input`/`Select`/`Button` to what those components actually accept (open `apps/web/src/components/ui/dialog.tsx` and `field.tsx` first). On edit, the view diffs the output against `existing` and sends only changed keys to `updateSubscription`.

- [ ] **Step 4: View and table**
  - `subscriptions-view.tsx:68-78`: replace the inline ÷12 with `monthlyEquivalent(sub.amount, sub.billingInterval)`. Hold `editing: RecurringExpenseDto | null` state; open `SubscriptionFormModal` for create and edit; on edit call `useUpdateRecurringExpense`.
  - `subscriptions-table.tsx:106`: wire `onEdit`/`onDelete` (delete → confirm dialog → `useCancelRecurringExpense`); add a Pause/Resume action per status; badges: `!supplierId` → "Link a supplier" (warning), `lastOccurrenceStatus === 'FAILED'` → "Failed" (danger), `endDate && endDate <= nextBillingDate` → "Ended" (muted); show interval label. Expandable row renders `useRecurringOccurrences(row.id)`: period, amount, status, bill number linking to the bill page (confirm the route with `ls apps/web/src/app/\(app\)/purchasing` or wherever bills live).

- [ ] **Step 5: Verify**

Run: `pnpm --filter web exec tsc --noEmit` → no errors. `pnpm --filter web lint` (non-blocking; fix new errors in touched files only).
Run the app (`pnpm dev`), log in as the seeded admin, open `/finance/subscriptions`: create a quarterly rent with auto-approve, edit its amount, pause/resume, cancel; log in as a seeded manager without `bill:approve` and confirm the auto-approve checkbox is disabled. Use the `run` skill or Playwright to screenshot.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): recurring expense form with suppliers, intervals, spreading and auto-approve; table actions"
```

---

### Task 17: Web — bill spreading, P&L hierarchy, cash forecast chart

**Files:**
- Modify: the bill create form and bill detail components (locate in Step 1)
- Modify: `apps/web/src/components/finance/reports/reports-view.tsx:105-140`
- Create: `apps/web/src/components/finance/dashboard/cash-forecast-chart.tsx`
- Modify: `apps/web/src/components/finance/dashboard/finance-overview-view.tsx`

- [ ] **Step 1: Locate bill UI** — `grep -rln "createBillSchema\|BILL_APPROVE" apps/web/src/components apps/web/src/app | head`. Read the form and detail component fully before editing.

- [ ] **Step 2: Bill form lines** — for lines without `purchaseOrderLineId`, add a category combobox (same component as the subscription form) and a "Spread over" toggle that reveals two date inputs bound to `servicePeriodStart`/`servicePeriodEnd`. The form already uses `createBillSchema`, so validation (both-or-neither, end ≥ start, not on order lines) comes from Task 4.

- [ ] **Step 3: Bill detail** — when `bill.status !== 'DRAFT'`, render `usePrepaidSchedules(bill.id)`: per schedule show the line description, "Released X of N months", released/remaining amounts, a progress bar, and an "End early" button (only with `finance:manage`, confirm dialog: "Post the remaining {amount} to {account} today?") calling `useEndPrepaidEarly`. Show each line's category and service period in the lines table.

- [ ] **Step 4: P&L hierarchy** — in `Section`, order lines so children follow their parent and indent them:

```tsx
function nest(lines: StatementLineDto[]) {
  const byParent = new Map<string | null, StatementLineDto[]>();
  for (const l of lines) {
    const key = l.parentId && lines.some((p) => p.ledgerAccountId === l.parentId) ? l.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), l]);
  }
  const out: Array<{ line: StatementLineDto; depth: number; subtotal?: number }> = [];
  for (const top of byParent.get(null) ?? []) {
    const kids = byParent.get(top.ledgerAccountId) ?? [];
    out.push({ line: top, depth: 0, subtotal: kids.length ? round2(top.amount + kids.reduce((s, k) => s + k.amount, 0)) : undefined });
    for (const k of kids) out.push({ line: k, depth: 1 });
  }
  return out;
}
```

A child whose parent has a zero balance is filtered out by the API; to keep the group header, the API must not drop zero-balance parents that have non-zero children. In `reports.service.ts` `balances()`, change the final filter to keep an account if its amount is non-zero **or** any account with `parentId === account.id` is non-zero (do this in Task 17 with a small API change + a test in `reports` spec: "keeps a zero parent that has a non-zero child"). Render: depth 1 rows get `pl-6`; a parent with children shows its own amount in the row and a "Total {name}" subtotal row after its children.

- [ ] **Step 5: Cash forecast chart** — load the `dataviz` skill before writing the chart. Use the charting library already used by `cashflow-trend-chart.tsx` (open it and copy its imports and styling). Bars: inflows (positive), billsOut + recurringOut stacked (negative); line: closing balance. Title "Next 6 months", subtitle in base currency. Add it to `finance-overview-view.tsx` below the existing cashflow chart, driven by `useCashForecast(6)`.

- [ ] **Step 6: Verify** — `pnpm --filter web exec tsc --noEmit`; `pnpm --filter api exec jest src/modules/finance` (for the `balances()` change); run the app: approve a bill with a spread line, see its schedule; open Reports → P&L and see 6100 indented under 6000 with a subtotal; see the forecast chart on Finance overview with the seeded rent lump. Screenshot each.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/api/src/modules/finance/reports.service.ts apps/api/src/modules/finance/*.spec.ts
git commit -m "feat(web): spread bill lines, prepaid schedule on bills, P&L hierarchy, cash forecast chart"
```

---

### Task 18: Docs and final verification

**Files:**
- Modify: `docs/FLAGS.md`

- [ ] **Step 1: FLAGS.md** — add a section "Overheads and recurring bills" listing, one bullet each with the reason:
  - Budget actuals still manual (`CategoryBudget.spentAmount`).
  - Spreading splits by whole months, no day proration.
  - No billing in arrears (service period before bill date, e.g. DEWA).
  - No assistant skill for recurring expenses.
  - No chart-of-accounts editor; tenants cannot add accounts.
  - Journal lines posted to 6000 before this change were not re-routed.
  - A recurring period claimed by a run that crashed mid-way stays `FAILED / in progress` and is not retried automatically (it can never double-bill); clear with `UPDATE recurring_expense_occurrences SET error = 'stale' WHERE id = …`.
  - Cash forecast converts draft bills at their stored rate (1 until approved) — foreign-currency drafts are understated/overstated.
  - Auto-approve runs as the user who enabled it; if they lose `bill:approve`, bills stay draft and finance managers are notified.
  - Existing open flag: expense claims not FX-converted.

- [ ] **Step 2: Full verification**

```bash
pnpm --filter @saas/shared build
pnpm --filter @saas/shared test
pnpm --filter api test
pnpm --filter api build
pnpm --filter web exec tsc --noEmit
pnpm db:reset && pnpm migration:run && pnpm check:drift && pnpm seed && <books check command from ci.yml>
```

Expected: all pass; drift check clean; books balanced.

- [ ] **Step 3: Commit**

```bash
git add docs/FLAGS.md
git commit -m "docs: flag what overheads posting leaves out"
```
