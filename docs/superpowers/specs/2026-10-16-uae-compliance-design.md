# UAE payroll compliance: leave, pension, settlement and WPS

Date: 2026-10-16
Status: Approved design, awaiting spec review
Sub-project 3 of 4 in the "accurate finance" programme (1 Overheads → 2 Employees & payroll → **3 UAE compliance** → 4 Job costing).
Builds on sub-project 2 (branch `feat/employees-payroll`, PR #19): employees, salary packages, payroll runs and lines, the gratuity ledger and its monthly true-up, and the per-tenant `gratuity-opening` advisory lock. This branch (`feat/uae-compliance`) is stacked on it.

## Why

Payroll (#2) books salary and gratuity, but it leaves four holes that keep the books and the business non-compliant. It has no leave balances, so the liability for untaken leave is missing and sick or unpaid days must be typed in by hand. Nationals are only flagged, so no pension is deducted or owed. Leavers are never settled, so the 2400 gratuity provision grows forever. And there is no WPS salary file, so mainland tenants cannot use Kerf to pay salaries.

## Goals

- **True profit:** leave salary and employer pension are monthly costs; sick and unpaid leave reduce pay automatically from recorded leave.
- **True balance sheet:** leave salary provision (2410) and pension payable (2420) are carried; settlements clear 2400 and 2410 for leavers.
- **Cash forecast:** pension remittances and approved, unpaid settlements appear.
- **Compliance:** a MOHRE-format SIF per run and per settlement; statutory leave accrual and sick-pay split; GPSSA/ADPF contributions.

## Decisions taken

| Decision | Choice |
|---|---|
| WPS | Per-tenant profile: on/off, employer ID type (MOHRE or free zone), employer ID, payer routing code. Kerf serves all three kinds of tenant |
| Leave | HR records leave as dated records (A); balances computed; records feed run lines. No self-service yet |
| Leave in the books | Leave salary provision (2410/6320), monthly true-up like gratuity |
| Final settlement | A separate document per leaver: draft → approved → paid; final-month salary stays on the normal run |
| Pension | Tenant-level schemes (presets editable), one per national; employee share deducted, employer share expensed, both to 2420; remitted monthly |
| Architecture | Extend the payroll module with `LeaveService`, `PensionService`, `SettlementService`, `WpsExportService`; posting stays inside the existing approval transaction and locks |

## 1. Settings and data model

### `payroll_settings` (new, one row per tenant, created lazily)

`tenantId (unique), wpsEnabled (bool, default false), employerIdType ('MOHRE' | 'FREE_ZONE', nullable), employerId (varchar 20, nullable), payerRoutingCode (char 9, nullable), annualLeaveDays (int, default 30, 30..60), updatedAt`.

When `wpsEnabled`, `employerId` and `payerRoutingCode` are required (zod refine + service check). `employerId` is 13 digits for MOHRE; free-zone IDs are free text up to 20.

### Employee additions

`wpsPersonId (varchar 14, nullable, digits)`, `bankRoutingCode (char 9, nullable, digits)`, `pensionSchemeId (uuid, nullable)`, `annualLeaveDaysOverride (int, nullable, 30..60)`, `probationEndDate (date, nullable)`. All on `employee:manage`; returned to `employee:read`.

### `pension_schemes` (new)

`id, tenantId, name, employeePct (numeric 5,2), employerPct (numeric 5,2), base ('BASIC' | 'BASIC_HOUSING' | 'GROSS'), minSalary (numeric, nullable), maxSalary (numeric, nullable), isActive, createdAt`. Presets created the first time the schemes list is read for a tenant, inactive until confirmed (an admin activates after checking the rates):

| Preset | Employee | Employer | Base | Min | Max |
|---|---|---|---|---|---|
| GPSSA (joined from 31 Oct 2023) | 11 | 15 | GROSS | 3,000 | 70,000 |
| GPSSA (legacy, joined earlier) | 5 | 12.5 | GROSS | 3,000 | 70,000 |
| ADPF (new member, from 1 Dec 2023) | 11 | 15 | GROSS | — | 100,000 |
| ADPF (in-service member) | 5 | 15 | GROSS | — | — |

An inactive scheme cannot be assigned. A scheme assigned to an employee cannot be deleted, only deactivated (deactivated + assigned → run line warning, approval refused).

### New ledger accounts (system, backfilled with the code-or-role guard as in #1 and #2)

| Code | Name | Role | Type | Parent |
|---|---|---|---|---|
| 2410 | Leave salary provision | `LEAVE_PROVISION` | liability | — |
| 2420 | Pension contributions payable | `PENSION_PAYABLE` | liability | — |
| 6320 | Leave salary expense | `LEAVE_EXPENSE` | expense | 6000 |
| 6330 | Employer pension contribution | `PENSION_EXPENSE` | expense | 6000 |

New reference types: `SETTLEMENT`, `PENSION_REMITTANCE`.

## 2. Leave

### `leave_records` (new)

`id, tenantId, employeeId, type ('ANNUAL' | 'SICK' | 'UNPAID' | 'MATERNITY' | 'OTHER_PAID'), startDate, endDate, days (numeric 5,1 — defaults to the calendar-day count, editable down for half days), note, createdById, createdAt`. Attachments via the existing storage module (owner type `LEAVE_RECORD`, inheriting `employee:read` / `employee:manage`).

Days are calendar days (UAE law counts annual leave in calendar days). A record spanning months contributes to each month the calendar days that fall in it, scaled by `days / calendarDays` when edited down.

**Lock:** creating, editing or deleting a record that touches a period with an approved (non-voided) run, or a date on or before an approved settlement's leaving date, is refused (409, naming the run). Overlapping records for the same employee are refused.

### Statutory accrual (`packages/shared/src/payroll/leave.ts`, pure)

```
serviceDays = days joiningDate..asOf inclusive − unpaid days (UNPAID records + sick no-pay days) up to asOf
months      = serviceDays / (365 / 12)
accrued     = months < 6  ? 0
            : months < 12 ? 2 × floor(months)
            : annualDays × serviceDays / 365        (round to 2 dp)
```

`annualDays` = employee override ?? tenant `annualLeaveDays`. Nationals accrue like everyone else (leave is not part of the pension exemption). Tests pin: 5 months → 0; 7.5 months → 14; 11 months → 22; exactly 1 year → 30; 3 years with 10 unpaid days → 30 × (1095−10)/365.

### Leave days ledger — `leave_ledger_entries` (new)

`id, tenantId, employeeId, kind ('OPENING' | 'ACCRUAL' | 'TAKEN' | 'ADJUSTMENT' | 'ENCASHMENT' | 'REVERSAL'), days (numeric 7,2, signed), amount (numeric, the provision value posted with it, signed, nullable), asOf, runLineId, settlementId, journalEntryId, note, createdAt`.

- Balance (days) = Σ days.
- On run approval, per line: `ACCRUAL` = `accrued(asOf = min(period end, leavingDate)) − Σ prior OPENING + ACCRUAL days`; `TAKEN` = −(ANNUAL days in the period). Rows reference the run line. The ACCRUAL row is written for every line, even when its days are 0, because it carries the provision change (below).
- Void inserts `REVERSAL` rows for that line's ACCRUAL and TAKEN.
- Balance may go negative (leave in advance); the run line carries a warning.

### Sick pay split (pure, same file)

Sick days are ordered within each service year (joining-date anniversary to anniversary). Days before `probationEndDate` are unpaid. After probation, the first 15 sick days of the service year are full pay, the next 30 half pay, the next 45 unpaid; beyond 90 the record is refused at creation (the law ends employment, which HR handles by recording a leaver). Maternity: the first 45 days of a record full pay, the next 15 half pay.

`leaveForPeriod({ records, joiningDate, probationEndDate, period }) → { annualDays, sickFullDays, halfPayDays, unpaidDays, otherPaidDays }` where `halfPayDays` covers sick and maternity half-pay and `unpaidDays` covers UNPAID records, sick no-pay and probation sick.

### Feeding the run

At draft creation and refresh, each line's `unpaidLeaveDays` and new `halfPayDays` are filled from `leaveForPeriod`, unless the line has `leaveOverridden = true` (set when someone edits either field on the line; refresh then keeps the manual value as it keeps other extras today). `computeLine` gains `halfPayDays`: `halfPayAmount = round2(gross / 30 × 0.5 × halfPayDays)`, subtracted like `unpaidLeaveAmount`. Line columns: `half_pay_days`, `half_pay_amount`, `leave_overridden`, `leave_days_in_period` (annual + sick + unpaid + other, for the SIF).

Gratuity's unpaid-leave service reduction keeps reading `unpaidLeaveDays` from approved lines (no change).

### Leave provision true-up

At approval, in the same journal and under the same per-tenant advisory lock as gratuity, per line:

```
target     = round2(balanceDaysAfter × basic / 30) + Σ ADJUSTMENT amounts for the employee
before     = Σ amount of the employee's leave ledger rows
change     = target − before                     → Dr 6320 / Cr 2410 (or reverse if negative)
```

`basic` = the line's basic (package in effect at period end). Line columns: `leave_provision_before`, `leave_provision_change`, `leave_provision_after`. The `amount` of the run's ACCRUAL row carries `change` (TAKEN rows carry null), so Σ amount stays equal to the 2410 balance per employee.

### Opening leave at go-live

Mirrors opening gratuity. `POST /payroll/opening-leave/preview` (`payroll:manage`) with `{ cutoverDate }` lists eligible employees (no leave OPENING row and no posted ACCRUAL row) with `calculatedAccrued` days. `POST /payroll/opening-leave` (`payroll:approve`) with `{ cutoverDate, lines: [{ employeeId, balanceDays }] }` writes per employee an `OPENING` row of calculated accrued days and, if `balanceDays` differs, an `ADJUSTMENT` row for the difference (note "Opening balance: leave taken before go-live"), with `amount` on OPENING = `round2(balanceDays × basic / 30)`; one journal `Dr 3100 / Cr 2410`. Same cut-over rule as gratuity: runs for months on or before the cut-over are refused once a leave opening exists.

Day adjustments later: `POST /employees/:id/leave-adjustments` (`payroll:approve`) `{ days, note }` → ADJUSTMENT row (days only, amount null); the next run trues the provision up.

## 3. Pension for nationals

### Calculation (`packages/shared/src/payroll/pension.ts`, pure)

```
contractBase = BASIC → basic; BASIC_HOUSING → basic + housing; GROSS → package gross
clamped      = clamp(contractBase, minSalary ?? 0, maxSalary ?? ∞)
base         = round2(clamped × daysEmployed / daysInMonth)
employee     = round2(base × employeePct / 100)
employer     = round2(base × employerPct / 100)
```

Unpaid leave does not reduce the base (contributions follow the contract salary).

Applied when the line's employee `isNational` and has an active scheme. Line columns (frozen at draft/refresh): `pension_scheme_id`, `pension_scheme_name`, `pension_base`, `pension_employee`, `pension_employer`. `netPay` subtracts `pension_employee`. A national without an active scheme → line warning; approval refused (409 naming the employees).

### Postings

Approval journal gains: `Cr 2420` Σ employee shares (net pay is lower by the same amount, so the entry balances), and `Dr 6330 / Cr 2420` Σ employer shares. Void reverses as today (exact reversal).

### Remittance — `pension_remittances` (new)

`id, tenantId, period, amount, financeAccountId, paidAt, journalEntryId, voidJournalEntryId, voidedAt, createdById`. Unique live remittance per (tenant, period).

- `GET /payroll/pension/:period` (`payroll:read`): due amount = Σ (employee + employer) on approved, non-voided lines of that period, plus the remittance if any, per-employee breakdown for the fund portal.
- `POST /payroll/pension/:period/remit` (`payroll:pay`) `{ financeAccountId, paidAt }` → `Dr 2420 / Cr bank`, base-currency accounts only; refused if nothing is due.
- `POST /payroll/pension/:period/void` (`payroll:pay`) → exact reversal.
- Voiding an approved run whose period has a live remittance is refused (409: void the remittance first).

## 4. Final settlement

### `settlements` (new) and `settlement_lines` (new)

`settlements`: `id, tenantId, settlementNumber (FS-0001 sequence), employeeId, employeeName, leavingDate, reason ('RESIGNATION' | 'TERMINATION' | 'END_OF_CONTRACT' | 'DEATH' | 'OTHER'), serviceDays, status ('DRAFT' | 'APPROVED' | 'PAID' | 'VOIDED'), netPay, paymentMethod, financeAccountId, paidAt, journalEntryId, voidJournalEntryId, approvedById, approvedAt, createdById, createdAt, updatedAt`. One live (non-voided) settlement per employee (partial unique index).

`settlement_lines`: `id, settlementId, tenantId, kind ('GRATUITY' | 'LEAVE_ENCASHMENT' | 'NOTICE_PAY' | 'ADVANCE_RECOVERY' | 'ADDITION' | 'DEDUCTION'), label, quantity (days, nullable), rate (nullable), amount (signed: + paid to the employee, − deducted), sortOrder`.

### Lifecycle

- **Create** `POST /settlements` (`payroll:manage`) `{ employeeId, reason }`: the employee must be LEFT with a `leavingDate`. Computes:
  - **Gratuity:** `gratuityEntitlement(asOf = leavingDate)` (statutory, existing) **zero if serviceDays < 365**, plus Σ gratuity ADJUSTMENT amounts. Not editable (correct via a gratuity adjustment before approval).
  - **Leave encashment:** leave balance days at the leaving date × basic ÷ 30 (negative balance → negative amount, i.e. a deduction for leave taken in advance). Days editable (encashment may legally be capped by contract); amount recomputed.
  - **Notice pay:** default 0; HR enters days and direction; amount = days × gross ÷ 30, positive (paid in lieu) or negative (employee did not serve notice).
  - **Advance recovery:** −(outstanding advances), editable between 0 and outstanding.
  - **Additions / deductions:** free lines (air ticket, damages, final commission…).
- **Edit** `PATCH /settlements/:id` (`payroll:manage`) while DRAFT; `POST /settlements/:id/refresh` recomputes the calculated lines, keeping manual ones.
- **Approve** `POST /settlements/:id/approve` (`payroll:approve`), in one transaction, under the settlement row lock and the per-tenant advisory lock:
  - Refused unless the run for the leaving date's month is approved (or paid) and contains the employee; refused if net < 0 (recover outside Kerf; message says so); refused if any later approved run contains the employee.
  - Journal (reference `SETTLEMENT`):
    - `Dr 2400` the employee's gratuity ledger balance; gratuity line − balance → `Dr/Cr 6310` (a credit when under a year).
    - `Dr 2410` the employee's leave provision balance; leave encashment line − balance → `Dr/Cr 6320`.
    - Notice pay and additions → `Dr 6300` (negative notice pay and deductions → `Cr 6300`).
    - Advance recovery → `Cr 1450` (and the employee's advances are marked recovered as in #2).
    - Net → `Cr 2300`.
  - Writes a gratuity `SETTLEMENT` row (−balance) and a leave `ENCASHMENT` row (−balance days, −balance amount), so both balances are zero.
- **Void** `POST /settlements/:id/void` (`payroll:approve`) while APPROVED (not PAID): exact reversal dated max(today, approval date); REVERSAL rows restore both ledgers; status VOIDED (a new settlement may then be drafted).
- **Pay** `POST /settlements/:id/pay` (`payroll:pay`) `{ financeAccountId, paidAt }` → `Dr 2300 / Cr account`; status PAID.
- **Delete** a DRAFT: `DELETE /settlements/:id` (`payroll:manage`).
- Voiding the leaver's final-month run is refused while a live APPROVED/PAID settlement exists.
- **Statement:** printable page (like the payslip) with service period, reason, every line and net.

## 5. WPS salary information file

`POST /payroll-runs/:id/wps-sif` and `POST /settlements/:id/wps-sif` (`payroll:pay`), POST so the audit row records each export (IBANs are decrypted). Refused (409) unless `wpsEnabled`. Runs must be APPROVED or later; settlements APPROVED or later.

Pure formatter `packages/shared/src/payroll/wps.ts`: `buildSif({ employer, rows, salaryMonth, createdAt }) → { fileName, content }`.

- File name: `{employerId}{YYMMDDHHMMSS}.SIF` (employer ID zero-padded to 13 for MOHRE).
- One `EDR` row per BANK-paid line: `EDR,{personId 14},{employee routing 9},{IBAN},{payStart yyyy-mm-dd},{payEnd yyyy-mm-dd},{days},{fixed},{variable},{leaveDays}`.
  - Run: payStart/payEnd = the employee's employed days in the period; days = days employed; variable = overtime + bonus; fixed = netPay − variable (if that is negative: fixed 0, variable = netPay); leaveDays = `leave_days_in_period`.
  - Settlement: payStart = payEnd = leaving date, days = 0, fixed = 0, variable = net, leaveDays = 0.
- One `SCR` row: `SCR,{employerId},{payerRoutingCode},{fileDate yyyy-mm-dd},{HHMM},{MMYYYY},{edrCount},{total 2dp},AED,{reference}` where reference is the run/settlement number.
- Amounts with two decimals, no thousands separators; CRLF line endings.
- **Pre-flight:** every BANK line needs `wpsPersonId`, `bankRoutingCode` and a decryptable IBAN; otherwise 422 listing each employee and what is missing. Cash-paid lines are excluded. The endpoint returns JSON `{ fileName, content, warnings }` (warnings name the cash-paid employees left out); the web saves `content` as the file.

## 6. Forecast, API, permissions, audit, web

### Cash forecast

- Pension: for each period with approved lines and no live remittance, an outflow of the due amount on the 15th of the following month (overdue → month 1). New `pensionOut` on `CashForecastMonthDto`.
- Settlements APPROVED and unpaid: outflow of net on today (month 1), in `payrollOut`.

### Permissions (no new constants)

| Route | Permission |
|---|---|
| `GET/PUT /payroll/settings` | `payroll:read` / `payroll:manage` |
| `GET /payroll/pension-schemes`, `POST`, `PATCH /:id` | `payroll:read` / `payroll:manage` |
| `GET /employees/:id/leave` (records + ledger + balance), `POST/PATCH/DELETE /employees/:id/leave-records[/:rid]` | `employee:read` / `employee:manage` |
| `POST /employees/:id/leave-adjustments` | `payroll:approve` |
| `POST /payroll/opening-leave/preview` / `POST /payroll/opening-leave` | `payroll:manage` / `payroll:approve` |
| `GET /payroll/pension/:period`, `POST …/remit`, `POST …/void` | `payroll:read` / `payroll:pay` |
| `GET /settlements`, `GET /settlements/:id` | `payroll:read` |
| `POST /settlements`, `PATCH`, `POST …/refresh`, `DELETE` | `payroll:manage` |
| `POST /settlements/:id/approve`, `…/void` | `payroll:approve` |
| `POST /settlements/:id/pay`, `POST /settlements/:id/wps-sif`, `POST /payroll-runs/:id/wps-sif` | `payroll:pay` |

The leave balance in days is visible to `employee:read`; provision amounts only to `payroll:read` (masked in the controller).

### Audit

Subjects: `settlements` → `SETTLEMENT`; `payroll/settings`, `payroll/pension-schemes`, `payroll/opening-leave`, `payroll/pension` as two-segment keys; leave records under `employees`. The SIF response body is never stored (the interceptor records the action and run id only — add the `wps-sif` action to the response-body exclusion).

### Web

- Employee detail gains **Leave** (balance, records table with add/edit/delete, ledger, adjustments) and **Pension** (scheme picker, read-only for non-nationals) tabs; Profile gains WPS person ID, bank routing code, probation end, leave-days override.
- Run detail: half-pay and pension columns; leave columns show an "auto" badge until overridden; **Export SIF** action (disabled with a reason when WPS is off or data is missing).
- **Settlements** page under People: list, create from a leaver, editor (calculated lines + manual lines), Approve / Void / Pay / Export SIF, printable statement.
- **Payroll settings** page: WPS profile, annual leave days, pension schemes (activate presets).
- **Pension** panel on the Payroll page: per month due / remitted, Remit and Void.
- **Opening leave** setup page, linked from Payroll until posted (like opening gratuity).
- Forecast chart gains a pension series.

## 7. Error handling

- Shared zod schemas for every body (`packages/shared/src/schemas/payroll-compliance.ts`); service re-checks that zod cannot (locks, overlaps, ordering, permissions).
- Approval, void, remit, settlement approve/void/pay and both openings are single transactions; failures post nothing.
- 409 messages name the blocking run, settlement, remittance or employee.
- Missing new ledger roles for a tenant: expense roles fall back to 6000 (#1 mechanism); 2410/2420 are backfilled by the migration.

## 8. Testing

- **Shared unit:** leave accrual table above; sick split across a service-year boundary, probation, 15/30/45, maternity 45/15; `leaveForPeriod` with a record spanning two months and an edited-down record; pension clamp min/max, proration, each base; `computeLine` with half pay and pension; settlement line maths (under one year → 0 gratuity, negative leave balance); SIF exact bytes for a fixture (file name, EDR, SCR, CRLF, fixed/variable split incl. negative fixed).
- **API service:** run draft fills leave from records and refresh respects overrides; approval posts leave provision and pension lines and balances; void reverses leave and pension; leave record lock against posted periods; overlap refusal; national without scheme blocks approval; remittance remit/void and run-void refusal while remitted; settlement create/approve/void/pay with exact journal lines (over and under one year), ordering refusals, net < 0 refusal, final-run void refusal; SIF pre-flight 422 and WPS-off 409; opening leave preview/post/refusals; permission masking of provision amounts.
- **Migration:** new tables with FORCE RLS and the standard policy; accounts backfilled with guards; employee and run-line columns; partial unique indexes.
- **CI seed:** WPS profile on; GPSSA (new) preset active and assigned to the seeded national; annual and sick leave recorded in the seeded run's month; opening leave posted; the seeded run's pension remitted; one employee left last month and settled (approved and paid). Seed assertions; `check:books` covers 2410/2420.

## Out of scope (FLAGS)

- Employee self-service leave requests and approval workflow.
- Public holidays and working-day counting (leave is calendar days).
- Government 2.5% GPSSA top-up (paid by the government, not the employer).
- GCC nationals' home-country schemes beyond a custom scheme with the right rates.
- Bank-specific SIF dialects; direct bank/WPS agent integration.
- Unlimited carry-forward of annual leave (no expiry or cap rules).
- **#4:** timesheets and labour cost per job.
