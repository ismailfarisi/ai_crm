# Overheads that post — recurring expenses, expense accounts, prepaid spreading

Date: 2026-10-16
Status: Approved design, awaiting spec review
Sub-project 1 of 4 in the "accurate finance" programme (1 Overheads → 2 Employees & payroll → 3 UAE compliance → 4 Job costing).

## Why

Finance under-reports cost. Three gaps, all confirmed in code:

1. `RecurringExpense` never reaches the ledger. It feeds the runway forecast only; nothing generates a bill or a journal entry, and nothing advances `nextBillingDate` (`finance.service.ts:53-137`, `:720-744`).
2. Every expense category posts to one account, 6000 Operating expense (`expenses.service.ts:393`, `packages/shared/src/payables/matching.ts:207`). The P&L cannot show rent, utilities or salaries separately, and direct costs (raw materials, subcontract, freight) sit below gross margin instead of in COGS.
3. Quarterly/annual costs (UAE rent is typically one annual lease paid in 1, 2, 4 or 12 cheques) would, if posted at all, land in a single month.

## Goals

- **True profit:** overheads appear on the P&L every month, by type; direct costs land in COGS.
- **Cash forecast:** a month-by-month forecast showing real outflow lumps.
- Foundations for sub-project 2 (payroll posts to 6300 Salaries & wages; payroll joins the forecast).

## Decisions taken

| Decision | Choice |
|---|---|
| What happens when a recurring expense is due | Generate a **DRAFT supplier bill** through normal payables; optional per-row **auto-approve** |
| Intervals | MONTHLY, QUARTERLY, SEMI_ANNUAL, ANNUAL |
| Costs covering more than a month | **Spread**: book to Prepaid expenses, release monthly to the expense account |
| Cost-of-sales categories | Route to **5000 COGS** (behaviour change: gross margin drops for tenants filing these as expenses — accepted as more accurate) |
| Existing recurring rows without a supplier | Match `vendorName` to a supplier by name; unmatched rows stay forecast-only, flagged "Link a supplier" — no auto-created suppliers |
| Historical journal lines in 6000 | Left in place (ledger is append-only); routing applies from deploy |

## 1. Chart of accounts and category routing

### New system accounts

Added to `SYSTEM_LEDGER_ACCOUNTS` (`packages/shared/src/finance/ledger.ts`) with new `LEDGER_ROLES`. `SystemLedgerAccount` gains an optional `parentCode`.

| Code | Name | Type | Role | Parent |
|---|---|---|---|---|
| 1400 | Prepaid expenses | ASSET | `PREPAID_EXPENSES` | — |
| 6000 | Other operating expense *(renamed)* | EXPENSE | `OPERATING_EXPENSE` | — |
| 6100 | Rent & premises | EXPENSE | `RENT` | 6000 |
| 6200 | Utilities & telecom | EXPENSE | `UTILITIES` | 6000 |
| 6300 | Salaries & wages | EXPENSE | `SALARIES` | 6000 |
| 6400 | Repairs & maintenance | EXPENSE | `REPAIRS` | 6000 |
| 6450 | Insurance | EXPENSE | `INSURANCE` | 6000 |
| 6500 | Travel & entertainment | EXPENSE | `TRAVEL` | 6000 |
| 6600 | Software & IT | EXPENSE | `SOFTWARE_IT` | 6000 |
| 6700 | Marketing | EXPENSE | `MARKETING` | 6000 |
| 6800 | Professional fees | EXPENSE | `PROFESSIONAL_FEES` | 6000 |
| 6900 | Bank charges | EXPENSE | `BANK_CHARGES` | 6000 |

`provisionChartOfAccounts` (`ledger.service.ts:71-102`) sets `parentId` from `parentCode` after inserting, and dedupes on code **or** role (today: code only).

### Category → role map

One exported map in `packages/shared/src/finance/expense-categories.ts`: `expenseCategoryRole(category): LedgerRole`, applied after `normaliseExpenseCategory`.

| Categories | Role |
|---|---|
| Raw materials, Packaging, Consumables, Subcontract, Freight & shipping, Tooling | `COGS` |
| Rent & premises | `RENT` |
| Utilities & Telecom | `UTILITIES` |
| Payroll & Contractors | `SALARIES` |
| Repairs & maintenance, Plant & machinery | `REPAIRS` |
| Insurance | `INSURANCE` |
| Travel & Lodging, Meals & Entertainment | `TRAVEL` |
| Software & SaaS, Hardware & Equipment | `SOFTWARE_IT` |
| Marketing & Advertising | `MARKETING` |
| Professional Services | `PROFESSIONAL_FEES` |
| Bank charges | `BANK_CHARGES` |
| Office Supplies, Training, Waste & recycling, Other, any free-text value | `OPERATING_EXPENSE` |

Unknown values fall back to `OPERATING_EXPENSE`, so posting never fails on a category.

### Call sites rerouted

- Expense claim accrual — `expenses.service.ts:393`: role from `expenseCategoryRole(claim.category)`. The workflow stub at `expense-approval.workflow.ts:194` follows the same map.
- Supplier bills — `SupplierBillLine` gains nullable `category`. `billPostingLines` (`matching.ts:173-207`) debits unmatched lines grouped by role (one debit line per role) instead of one lump to `OPERATING_EXPENSE`. PO-matched lines are unchanged. Lines with no category keep today's behaviour.
- `ledger.service.ts` fallback (`:44`, `:270-283`) unchanged — still `OPERATING_EXPENSE`.

### Backfill for existing tenants

Migration `AddExpenseAndPrepaidAccounts`:

- `SELECT set_config('app.bypass_rls','on',true)` first (RLS is FORCEd on `ledger_accounts`).
- `INSERT … SELECT` per distinct tenant in `ledger_accounts`, `NOT EXISTS` guarded on `code = X OR role = X` (pattern from `1787000000000-CurrencyBillingAndNotifications.ts:88-97`). A tenant that already has the code under another role is skipped for that account; the role is then missing and resolution would 404, so `expenseCategoryRole` resolution in `resolveLines` falls back to `OPERATING_EXPENSE` when the role row is absent (see §5 Error handling).
- `UPDATE` sets `parent_id` to that tenant's 6000 for the new 6xxx rows.
- Renames 6000 to "Other operating expense" only where `role = 'OPERATING_EXPENSE' AND is_system`.
- `down()` soft-deletes the inserted rows (pattern from 7000).

### P&L presentation

`reports.service.ts` P&L returns `parentId` per account; `reports-view.tsx` renders children indented under 6000 with a 6000 subtotal (6000's own balance + children). Balance sheet and trial balance stay flat.

## 2. Recurring expenses that generate bills

### `recurring_expenses` changes

| Column | Change |
|---|---|
| `supplierId` uuid null, FK `suppliers` SET NULL | new |
| `billingInterval` | enum gains `QUARTERLY`, `SEMI_ANNUAL` |
| `startDate` date | new; anchor for the schedule. Backfilled from `nextBillingDate` |
| `endDate` date null | new; no occurrences on or after it |
| `nextBillingDate` | kept; advanced after each generated period |
| `category` | values normalised to the shared list; old modal values mapped in the migration (Cloud Infrastructure → Software & SaaS, Marketing Tools → Marketing & Advertising, etc. — full table in the plan) |
| `taxCodeId` uuid null | new; defaults to the supplier's at bill creation |
| `autoApprove` boolean default false | new |
| `spreadOverPeriod` boolean | new; default true for QUARTERLY and longer, forced false for MONTHLY |
| `createdById` uuid null | new; recorded for audit and notifications |

Currency comes from the supplier, as for any bill.

Migration also links `supplierId` where exactly one supplier in the tenant matches `lower(trim(vendorName))`. Bypass RLS as above.

### Schedule maths

Shared helpers in `packages/shared/src/finance/recurring.ts`:

- `monthsPerInterval(interval)` → 1 / 3 / 6 / 12. Replaces the duplicated `÷12` in `finance.service.ts:70-137` and `subscriptions-view.tsx:68-78`.
- `occurrenceDate(startDate, n, interval)` = `startDate + n × months`, day clamped to month end. Always computed from the anchor, so a 31st schedule bills 28/29 Feb and 31 Mar.
- `periodFor(occurrenceDate, interval)` → `[start, nextOccurrence − 1 day]`.

### `recurring_expense_occurrences` (new)

`id, tenantId, recurringExpenseId, periodStart date, periodEnd date, amount numeric(14,2), billId null, status ('GENERATED' | 'FAILED'), error text null, attempts int, createdAt, updatedAt`.
Unique `(recurringExpenseId, periodStart)`. RLS enabled + forced, same policy as `recurring_expenses`.

### The daily job — `RecurringBillingService`

`@Cron` in the API process (the worker has no `ScheduleModule`), following `quotes/invoice-overdue.service.ts:48-90`:

1. `tenantContext.runAsSystem` → find `ACTIVE` rows with `supplierId IS NOT NULL AND nextBillingDate <= today`.
2. Per row, `runWithTenant(row.tenantId)`. For each due period, oldest first (catch-up):
   1. `INSERT … ON CONFLICT (recurringExpenseId, periodStart) DO NOTHING RETURNING id` — the claim. No row returned → another replica has it; skip. Existing `FAILED` row is re-claimed with a conditional `UPDATE … WHERE status = 'FAILED' RETURNING`.
   2. `PayablesService.create` a DRAFT bill: supplier, `billDate = periodStart`, due date from supplier terms, `supplierInvoiceNumber = REC-<first 8 of id>-<YYYY-MM-DD>`, one line (description = vendor/category + period, `category`, amount, and `servicePeriodStart/End` when `spreadOverPeriod`), tax code from row or supplier.
   3. If `autoApprove`: `PayablesService.approve` with a system actor `{ userId: null, permissions: [BILL_APPROVE] }`.
   4. Occurrence → `GENERATED`, `billId` set; advance `nextBillingDate`.
   5. `AuditService.record` with `channel: 'SYSTEM'`, `subjectType: 'RecurringExpense'`, summary naming the bill.
3. Stop at `endDate`; a row whose next occurrence is past `endDate` is left ACTIVE but generates nothing (UI shows "Ended").
4. Failure (supplier archived, tax code gone, approval throws): occurrence `FAILED` with `error`, `attempts++`, `nextBillingDate` not advanced, retried next run. On first failure notify users holding `finance:manage` via the existing notifications module.

"Today" is evaluated in the tenant's timezone if the tenant record has one, else UTC — **verify in the plan** which field exists.

### Editing rules

- Amount, category, supplier, tax code: future occurrences only; existing bills untouched.
- Pause → `PAUSED`, generation stops. Resume → `ACTIVE` with `nextBillingDate` moved to the first occurrence on/after today; paused months are **not** back-generated.
- Cancel (DELETE) → `CANCELLED`; occurrences and bills kept.
- `startDate` and `billingInterval` are editable only while no occurrence exists.

### Auto-approve escalation rule

Create/edit requires `finance:manage`. Setting `autoApprove = true` (on create, or changing it to true) additionally requires the actor to hold `bill:approve` in `req.user.permissions`; enforced in the service, not the controller (same principle as `assertActorCanGrant`). Otherwise 403.

## 3. Spreading — prepaid to expense

Spreading is a property of the **bill line**, so manual bills (annual insurance, a yearly licence) use it too.

### `supplier_bill_lines` changes

`category` (§1), `servicePeriodStart date null`, `servicePeriodEnd date null`. Both or neither; end ≥ start. Validated in `packages/shared/src/schemas/bill.ts`.

### Posting at approval

In `billPostingLines`: a line whose service period spans more than one calendar month debits `PREPAID_EXPENSES` instead of its category role. Tax and AP lines unchanged (input VAT reclaimable on bill date; full amount owed now). Within the same transaction, approval creates the schedule rows below.

### `prepaid_schedules` (new)

`id, tenantId, billId, billLineId, expenseRole, totalBase numeric(14,2), firstMonth date, months int, status ('ACTIVE' | 'COMPLETED' | 'ENDED_EARLY'), createdAt`.
`totalBase` = the base-currency amount actually debited to 1400 (bill's `fxRate`), so 1400 clears to exactly zero.

### `prepaid_amortizations` (new)

`id, tenantId, scheduleId, month date, amount numeric(14,2), journalEntryId`. Unique `(scheduleId, month)`.

### Split rule

Equal whole months: `months` = calendar months touched by the service period, the start month being month 1 (no day proration). Each month = `floor2(totalBase / months)`; the last month takes the remainder.

### Monthly release

Second pass of the same daily job: for every `ACTIVE` schedule, each month `<= current month` with no amortization row → claim via insert-on-conflict, post `Dr <expenseRole> / Cr PREPAID_EXPENSES` dated the 1st of that month, `referenceType = 'PREPAID'` (new value), `referenceId = scheduleId`. After the last month, status → `COMPLETED`. Missed months post on their own dates.

### End early

`POST /finance/prepaid-schedules/:id/end-early` (`finance:manage`): posts the unreleased remainder `Dr expense / Cr 1400` dated today, status → `ENDED_EARLY`. Append-only, books stay balanced.

### Lifecycle edges

- Draft bill cancelled → no schedule exists yet.
- Approved bills cannot be cancelled (`matching.ts:260`), so a schedule never loses its bill.
- Bill payment and payment reversal touch AP and cash only.

## 4. Forecast, API, UI, audit

### Runway (`finance.service.ts:53-137`)

- `recurringMonthly` uses `monthsPerInterval`.
- `expenseMonthly` = approved/paid claims in the trailing 90 days ÷ 3 (today: all-time sum).
- `max(observed, committed)` kept — it chooses between two estimates and does not double-count.

### Cash forecast (new)

`GET /finance/cash-forecast?months=6` (`finance:read`, 1–12). Per month: opening cash (sum of finance-account balances for month 1, carried forward), outflows = approved-unpaid bills by due date + draft bills by due date + projected not-yet-generated recurring occurrences (using `occurrenceDate`, honouring `endDate`/status), inflows = open invoice balances by due date, closing. Base currency, converting documents with their stored rate. Overdue items fall into month 1. Rendered as a 6-month bar/line chart on the finance overview.

### API (`finance.controller.ts`, zod schemas in `packages/shared/src/schemas/recurring-expense.ts`)

| Route | Permission |
|---|---|
| `GET /finance/subscriptions` (existing) — adds supplier, last occurrence status | `finance:read` |
| `POST /finance/subscriptions` (existing) — new fields, validated | `finance:manage` (+ `bill:approve` if `autoApprove`) |
| `PATCH /finance/subscriptions/:id` | same |
| `POST /finance/subscriptions/:id/pause` / `resume` | `finance:manage` |
| `DELETE /finance/subscriptions/:id` | `finance:manage` |
| `GET /finance/subscriptions/:id/occurrences` | `finance:read` |
| `GET /finance/prepaid-schedules?billId=` | `bill:read` |
| `POST /finance/prepaid-schedules/:id/end-early` | `finance:manage` |
| `GET /finance/cash-forecast` | `finance:read` |

No new permission constants.

### Audit

`audit-subjects.ts` keys on the first route segment, so every `/finance/*` route records as `FINANCE` without snapshots, and the existing `finance-accounts` / `expense-claims` keys never match. Change: try a two-segment key (`finance/subscriptions`) before the one-segment key. Register `finance/subscriptions` → `RecurringExpense`, `finance/expenses` → `ExpenseClaim`, `finance/accounts` → `FinanceAccount` (confirm segment names in the plan), `finance/prepaid-schedules` → `PrepaidSchedule`.

### Web

- Subscription modal (`create-subscription-modal.tsx`) rebuilt on react-hook-form + shared zod (`useForm<z.input, unknown, z.output>`): supplier picker, shared category combobox, 4 intervals, start/end dates, spread toggle (hidden for monthly), auto-approve toggle disabled with tooltip without `bill:approve`. Doubles as the edit modal.
- Subscriptions table: wire `onEdit`/`onDelete`, add pause/resume; badges "Link a supplier", "Failed", "Ended"; expandable occurrence history linking bills.
- Bill form: per-line category combobox and optional "Spread over" date range.
- Bill detail: per spread line, schedule with released months, remaining balance, "End early".
- P&L: 6000 children indented with subtotal.
- Finance overview: 6-month cash forecast chart.

## 5. Error handling

- Missing role for a tenant (backfill skipped due to a code collision): category routing in `resolveLines` falls back to `OPERATING_EXPENSE` and logs a warning, instead of 404-ing the whole posting. Explicit system roles (AP, tax, cash, prepaid) still 404 as today.
- Generation/approval failures: occurrence `FAILED`, retried daily, notification once.
- Amortization posting failure: no amortization row is written (same transaction), retried next run.
- Validation: shared zod on API and web; service-level checks for `autoApprove` escalation, immutable `startDate`/interval after first occurrence, service period on bill lines.

## 6. Testing

Unit (shared): `occurrenceDate` (31st anchor, leap year, all intervals), `periodFor`, `monthsPerInterval`, `expenseCategoryRole` (aliases, unknown), amortization split + remainder, `billPostingLines` (role grouping, prepaid routing, PO lines untouched, no-category lines unchanged).

Service (api): concurrent generation → one bill; catch-up of N periods; `endDate` stop; auto-approve without `bill:approve` → 403; failure → FAILED + one notification + retry succeeds; pause/resume no back-fill; approval creates schedule; release posts missed months on their own dates; end-early remainder; runway 90-day window; cash forecast buckets.

Updated tests: `ledger.service.spec.ts:229`, `expenses.service.spec.ts:376`, `matching.test.ts:137`.

Migration: backfill skips tenants with colliding code/role; supplier match only when unique; fresh DB migrates with no drift (`pnpm check:drift`).

CI: seed adds one annual rent recurring expense (auto-approve, start 3 months ago) for a seeded tenant so `check:books` covers bill, prepaid and catch-up releases.

## Out of scope (logged in `docs/FLAGS.md`)

- Budget "actual" (`CategoryBudget.spentAmount` remains manual).
- Day-based proration of spread periods.
- Billing in arrears (service period before the bill date, e.g. DEWA).
- Assistant skill for recurring expenses.
- Chart-of-accounts editor / tenant custom accounts.
- Re-routing historical 6000 lines.
- Expense claims not FX-converted (existing flag).
