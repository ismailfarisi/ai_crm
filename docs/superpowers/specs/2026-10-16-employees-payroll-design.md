# Employees and payroll

Date: 2026-10-16
Status: Approved design, awaiting spec review
Sub-project 2 of 4 in the "accurate finance" programme (1 Overheads → **2 Employees & payroll** → 3 UAE compliance → 4 Job costing).
Builds on sub-project 1 (branch `feat/overheads-recurring-posting`, PR #18): the 6300 Salaries & wages account, the recurring/prepaid scheduler pattern and the cash forecast.

## Why

Salaries are usually the largest cost and today they reach the books only as hand-entered expense claims or bills, if at all. End-of-service gratuity — a real UAE liability that grows every month — is not recorded anywhere, so the balance sheet understates what the business owes and the P&L understates monthly cost.

## Goals

- **True profit:** every month's salary cost and gratuity accrual is on the P&L, from an auditable payroll run.
- **True balance sheet:** salaries payable, the end-of-service provision (including service before go-live) and employee advances are carried as real balances.
- **Cash forecast:** payroll appears in the forecast and the runway.
- Foundations for #3 (WPS, leave, settlements read run lines and the gratuity ledger) and #4 (cost per employee from run lines).

## Decisions taken

| Decision | Choice |
|---|---|
| Shape of a month's pay | Fixed package **plus** monthly extras (overtime, bonus, unpaid leave, advance recovery, other deductions) |
| UAE/GCC nationals | Not handled now: `isNational` excludes from gratuity and flags the line; GPSSA pension is #3 |
| Gratuity before go-live | Calculated from joining dates as of a cut-over date, overridable per employee, booked against Opening balance equity |
| How salaries are paid | Mix of bank and cash; each employee has a payment method; a run settles from one account per method |
| Architecture | Payroll runs are first-class documents with frozen per-employee lines and their own postings |
| Bank details | Masked by permission **and** encrypted at rest (AES-256-GCM, `PAYROLL_DATA_KEY`) |
| Daily rate | ÷ 30 (UAE Labour Law convention) for overtime and unpaid leave |
| Gratuity accrual | From day one, monthly true-up to the full entitlement |

## 1. Employees, salary packages, access

### `employees` (new)

| Field | Notes |
|---|---|
| `employeeNumber` | `EMP-0001`, sequence `employee_number` (add to `TenantSequenceName`) |
| `firstName`, `lastName` | required |
| `jobTitle`, `department` | free text, optional |
| `userId` | optional link to a login `User`; unique per tenant where not null |
| `joiningDate` | date, required |
| `leavingDate` | date, optional |
| `status` | `ACTIVE` \| `ON_HOLD` (excluded from runs) \| `LEFT` |
| `nationality` | ISO alpha-2, optional |
| `isNational` | boolean, default false |
| `paymentMethod` | `BANK` \| `CASH` |
| `bankName` | optional |
| `ibanEncrypted` | AES-256-GCM ciphertext (iv + tag + data, base64); null when none |
| `ibanLast4` | plaintext last four characters, for masking |
| `email`, `phone` | optional |
| soft delete, timestamps, `tenantId` | standard |

A soft-deleted employee keeps their run lines and gratuity history.

### `salary_packages` (new)

`id, tenantId, employeeId, effectiveFrom (date), basic, housing, transport, otherAllowances (jsonb: [{label, amount}]), createdById, createdAt`. Amounts `numeric(14,2)`, base currency. Unique `(employeeId, effectiveFrom)`. Rows are never edited; a raise is a new row. The package for a month is the row with the greatest `effectiveFrom ≤ last day of month`. `gross = basic + housing + transport + Σ otherAllowances`.

### Permissions — new domain file `packages/shared/src/rbac/permissions/payroll.ts`

| Permission | Allows | Default grants |
|---|---|---|
| `employee:read` | Directory: names, titles, departments, status | admin, manager |
| `employee:manage` | Create/edit employees; documents; full bank details | admin |
| `payroll:read` | Salary packages, runs, payslips, gratuity, advances | admin |
| `payroll:manage` | Create runs, edit lines, refresh, add packages, prepare opening gratuity | admin |
| `payroll:approve` | Approve or void a run; post opening gratuity | admin |
| `payroll:pay` | Pay a run; record advances | admin |

Registered in `permissions/index.ts` (`PERMISSIONS` spread + `PERMISSION_DOMAINS`). The catalog sync on boot adds them.

**Masking.** Employee responses omit package, gratuity and advance fields unless the caller holds `payroll:read`, and return `iban` only to `employee:manage` holders (others get `ibanMasked: "•••• 1234"`). Implemented as one controller-level helper, following the `stripCost` precedent.

### Encryption at rest

`PayrollCryptoService` (AES-256-GCM, random 12-byte IV per value) with key from `PAYROLL_DATA_KEY` (32 bytes, base64). In production (`NODE_ENV=production`) the API refuses to boot without a valid key; in development/test a fixed dev key is used and a warning logged. The ciphertext is never returned, logged or audited.

### Documents

New attachment owner type `EMPLOYEE` in `attachment-owners.ts` and `ATTACHMENT_OWNER_TYPES`: read and write require `employee:manage`.

## 2. The payroll run

### New ledger accounts (system, backfilled to existing tenants like #1)

| Code | Name | Type | Role | Parent |
|---|---|---|---|---|
| 1450 | Employee advances | ASSET | `EMPLOYEE_ADVANCES` | — |
| 2300 | Salaries payable | LIABILITY | `SALARIES_PAYABLE` | — |
| 2400 | End-of-service provision | LIABILITY | `GRATUITY_PROVISION` | — |
| 6310 | End-of-service gratuity | EXPENSE | `GRATUITY_EXPENSE` | 6000 |

`OPERATING_EXPENSE_CHILD_ROLES` gains `GRATUITY_EXPENSE` (fallback to 6000 if missing). New journal reference type `PAYROLL` (DB enum value added by migration).

### `payroll_runs` (new)

`id, tenantId, runNumber (PR-YYYY-NNNN, sequence payroll_run_number), period (char(7) 'YYYY-MM'), payDate (date), status (DRAFT | APPROVED | PARTIALLY_PAID | PAID | VOIDED), totals (gross, overtime, bonus, unpaidLeave, advanceRecovery, otherDeductions, net, gratuityAccrual — numeric), bankPaidAt, cashPaidAt, approvedById, approvedAt, journalEntryId, createdById, timestamps`. Unique `(tenantId, period)` where status ≠ 'VOIDED'.

### `payroll_run_lines` (new)

Per employee: snapshot (`employeeName`, `employeeNumber`, `paymentMethod`, `isNational`, `packageId`, `basic`, `housing`, `transport`, `otherAllowances`), `daysEmployed`, `daysInMonth`, `proratedGross`, extras (`overtimeHours`, `overtimeHoursPremium`, `overtimeAmount`, `bonusAmount`, `bonusLabel`, `unpaidLeaveDays`, `unpaidLeaveAmount`, `advanceRecovery`, `otherDeductionAmount`, `otherDeductionLabel`), `netPay`, gratuity (`gratuityBefore`, `gratuityAccrual`, `gratuityAfter`), `flags` (text[]: e.g. `NATIONAL_PENSION_NOT_HANDLED`), `paidAt`. Unique `(runId, employeeId)`.

### Pure calculation (`packages/shared/src/payroll/calc.ts`)

- `daysEmployed` = calendar days in the period between `max(joiningDate, first)` and `min(leavingDate ?? last, last)`; `proratedGross = round2(gross × daysEmployed / daysInMonth)`.
- `overtimeAmount = round2(basic / 30 / 8 × (1.25 × overtimeHours + 1.5 × overtimeHoursPremium))`.
- `unpaidLeaveAmount = round2(gross / 30 × unpaidLeaveDays)`.
- `netPay = proratedGross + overtimeAmount + bonusAmount − unpaidLeaveAmount − advanceRecovery − otherDeductionAmount`. A line with `netPay < 0` is refused (400, names the employee).
- `advanceRecovery ≤` the employee's outstanding advance balance (refused otherwise).

### Lifecycle

- **Create** (`payroll:manage`): period + pay date (default the 28th of the period). Lines for every `ACTIVE` employee with `daysEmployed > 0`. A second non-voided run for the same period is refused (409).
- **Edit line** (DRAFT only): the extras; amounts recomputed server-side. **Refresh** re-pulls packages and employment days for all lines and adds newly eligible employees, keeping entered extras; removes lines for employees no longer eligible.
- **Approve** (`payroll:approve`, DRAFT only): computes gratuity accruals (§3), then in one transaction posts the journal dated the last day of the period:

| | Account | Amount |
|---|---|---|
| Dr | 6300 Salaries & wages | Σ (proratedGross + overtime + bonus − unpaidLeave) |
| Dr / Cr | 6310 End-of-service gratuity | Σ gratuityAccrual (negative → credit) |
| Cr | 2300 Salaries payable | Σ netPay |
| Cr | 1450 Employee advances | Σ advanceRecovery |
| Cr | 6300 Salaries & wages | Σ otherDeductionAmount |
| Cr / Dr | 2400 End-of-service provision | Σ gratuityAccrual |

  and writes one `ACCRUAL` gratuity-ledger row per line with a non-zero accrual. Status → APPROVED.
- **Pay** (`payroll:pay`): body `{ method: 'BANK' | 'CASH', financeAccountId, paidAt }`. Posts `Dr 2300 / Cr <finance account>` for Σ netPay of unpaid lines of that method, updates the finance account balance as bill payments do, sets those lines' `paidAt`, and the run's `bankPaidAt` / `cashPaidAt`. Status → PARTIALLY_PAID, then PAID when no unpaid line remains. A method with zero total is skipped.
- **Void** (`payroll:approve`, APPROVED only — not after any payment): posts the exact reversal of the approval entry, deletes nothing, writes reversing gratuity-ledger rows, status → VOIDED. A new run for the period can then be created.
- **Payslip**: `GET /payroll-runs/:id/lines/:lineId` returns the line with employee and company details; the web renders a printable page.

### Advances

`employee_advances` (new): `id, tenantId, employeeId, amount, issuedAt, financeAccountId, journalEntryId, note, createdById, createdAt`. `POST /employees/:id/advances` (`payroll:pay`) posts `Dr 1450 / Cr <finance account>`. Outstanding = Σ advances − Σ `advanceRecovery` on approved, non-voided run lines.

## 3. End-of-service gratuity

### Entitlement (`packages/shared/src/payroll/gratuity.ts`, pure)

```
serviceDays  = days from joiningDate to asOf (inclusive) − unpaid leave days on approved, non-voided runs up to asOf
years        = serviceDays / 365
gratuityDays = 21 × min(years, 5) + 30 × max(years − 5, 0)
amount       = min(round2(gratuityDays × basic / 30), 24 × basic)
```

`basic` = the basic of the package in effect at `asOf`. `isNational` → 0. Worked examples (tests): 3 years at 6,000 → 12,600; 7 years at 10,000 → 55,000; 30 years at 10,000 → capped at 240,000.

Accrual is recognised from day one; eligibility to be paid (≥ 1 year) is #3's concern.

### Gratuity ledger — `gratuity_ledger_entries` (new)

`id, tenantId, employeeId, kind (OPENING | ACCRUAL | ADJUSTMENT | REVERSAL), amount (signed), asOf (date), runLineId, journalEntryId, note, createdAt`. Balance per employee = Σ amount. `SETTLEMENT` is reserved for #3.

### Monthly true-up

At approval, for each line: `gratuityBefore = balance`, `entitlement = f(asOf = last day of period)`, `gratuityAccrual = entitlement − gratuityBefore` (may be negative), `gratuityAfter = entitlement`. This keeps the provision exact across raises, pay cuts, the five-year boundary and unpaid leave.

### Opening gratuity at go-live

- `POST /payroll/opening-gratuity/preview` (`payroll:manage`) with `{ cutoverDate }` (default: last day of the month before the earliest run, or of last month if none) → per eligible employee (joined on or before cutover, no OPENING row yet): calculated entitlement.
- `POST /payroll/opening-gratuity` (`payroll:approve`) with `{ cutoverDate, lines: [{ employeeId, amount }] }` (amounts may override the preview) → one journal `Dr 3100 Opening balance equity / Cr 2400` for the total (reference `PAYROLL`, referenceId `gratuity-opening:<cutoverDate>`), one `OPENING` row per employee. Refused if any listed employee already has an OPENING row.
- Corrections later: `POST /employees/:id/gratuity-adjustments` (`payroll:approve`) with `{ amount, note }` → `ADJUSTMENT` row and journal `Dr/Cr 3100 ↔ 2400`.
- Employees joining after go-live start at zero.

## 4. Forecast, API, web, audit

### Cash forecast and runway (extends #1)

- `CashForecastMonthDto` gains `payrollOut`. Approved runs with unpaid lines count their unpaid net on `payDate` (overdue → month 1). Months with no run project Σ current gross of `ACTIVE` employees (package in effect at month end), dated the 28th.
- Runway's committed burn adds Σ current gross of `ACTIVE` employees.

### API summary

| Route | Permission |
|---|---|
| `GET /employees`, `GET /employees/:id` | `employee:read` (masked per §1) |
| `POST /employees`, `PATCH /employees/:id` | `employee:manage` |
| `GET /employees/:id/salary-packages` / `POST` | `payroll:read` / `payroll:manage` |
| `GET /employees/:id/gratuity` | `payroll:read` |
| `POST /employees/:id/gratuity-adjustments` | `payroll:approve` |
| `GET /employees/:id/advances` / `POST` | `payroll:read` / `payroll:pay` |
| `POST /payroll/opening-gratuity/preview` / `POST /payroll/opening-gratuity` | `payroll:manage` / `payroll:approve` |
| `GET /payroll-runs`, `GET /payroll-runs/:id`, `GET /payroll-runs/:id/lines/:lineId` | `payroll:read` |
| `POST /payroll-runs`, `PATCH /payroll-runs/:id/lines/:lineId`, `POST /payroll-runs/:id/refresh` | `payroll:manage` |
| `POST /payroll-runs/:id/approve`, `POST /payroll-runs/:id/void` | `payroll:approve` |
| `POST /payroll-runs/:id/pay` | `payroll:pay` |

All bodies validated with shared zod schemas (`packages/shared/src/schemas/payroll.ts`); every query tenant-scoped; all new tables FORCE RLS with the standard policy.

### Audit

`audit-subjects.ts`: `employees` → `EMPLOYEE` (Employee), `payroll-runs` → `PAYROLL_RUN` (PayrollRun). `payroll/opening-gratuity` is audited by the interceptor under a two-segment key `payroll/opening-gratuity` → `PAYROLL`. Snapshots exclude `ibanEncrypted` (the audit snapshot helper must drop it — add an exclusion list).

### Web

- Sidebar: new **People** group (`employee:read`): **Employees**, **Payroll** (`payroll:read`).
- **Employees**: list (status filter, search) → detail with tabs Profile · Salary history · Gratuity · Advances · Documents; pay tabs hidden without `payroll:read`; IBAN field masked unless `employee:manage`.
- **Payroll**: run list → run detail: editable line grid while DRAFT (extras columns, live totals), actions Refresh / Approve / Pay (method + account) / Void, flags shown per line, payslip link per line → printable payslip page.
- **Opening gratuity** setup page (preview table with overridable amounts, cut-over date), linked from Payroll until posted.
- Cash forecast chart gains a payroll series.

## 5. Error handling

- Validation: shared zod on API and web; service checks for negative net pay, advance cap, duplicate period, illegal transitions (409/400 with the employee or run named).
- Approval, pay, void and opening posting are single transactions; a failure leaves no partial postings.
- Missing ledger role for a tenant: `GRATUITY_EXPENSE` falls back to 6000 (#1 mechanism); structural roles (2300, 2400, 1450, 3100) 404 as today.
- Missing `PAYROLL_DATA_KEY` in production: boot refused with a clear message.

## 6. Testing

- **Shared unit**: gratuity (examples, 5-year boundary, cap, unpaid leave reduces service, nationals), proration (joiner/leaver mid-month, full month), overtime, unpaid leave, net pay, masking helper, zod schemas.
- **API service**: run creation eligibility and package selection; refresh keeps extras; approval posts a balanced entry with the exact amounts above; true-up across a raise and across the 5-year mark; negative accrual on a pay cut; pay by method → PARTIALLY_PAID → PAID with finance balances moved; void reverses entry and gratuity rows and frees the period; advance recovery cap; negative net refused; duplicate period refused; opening gratuity preview/post/duplicate refusal; permission and masking rules; IBAN encrypt/decrypt round-trip and boot refusal without key.
- **Migration**: new accounts backfilled with code/role guards; new tables; enum value; RLS.
- **CI seed**: 6 employees (one national, one joined mid-last-month), opening gratuity posted, previous month's run approved and paid (bank + cash), and a seed assertion that the run posted and paid; `check:books` covers it.

## Out of scope (FLAGS or later sub-projects)

- **#3:** WPS SIF export and its identifiers, leave balances/accrual, final settlement on leaving (pays out 2400), GPSSA pension for nationals.
- **#4:** timesheets, cost per hour, labour to jobs.
- Off-cycle/bonus-only runs; multi-currency payroll; payslip email and server-side PDF; employee self-service; assistant (chat) skills for payroll; configurable pay day (fixed default 28th for projection).
