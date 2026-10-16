# Job costing: timesheets and actual labour on work orders

Date: 2026-10-16
Status: Approved design, awaiting spec review
Sub-project 4 of 4 in the "accurate finance" programme (1 Overheads → 2 Employees & payroll → 3 UAE compliance → **4 Job costing**).
Builds on #2 (payroll runs, run lines, the approval journal and its locks) and #3 (`payroll_settings`, employer pension, leave provision change on run lines). Stacked on `feat/uae-compliance`.

## Why

Work orders already measure time: operations carry `actualMinutes`, and completion writes an `actualCost` whose labour is minutes × the work centre's *standard* rate. That labour is never posted — `ProductionService.complete` says so: "the system has no payroll to credit them against". So per-job margin uses a guessed labour rate, cost of sales holds only material, and salaries sit in overheads whether people worked on jobs or swept the floor. Payroll now exists; this sub-project connects it to jobs.

## Goals

- **Per-job margin:** a job's labour is each worker's real hours × their real cost per hour.
- **True profit:** direct labour is in cost of sales (via WIP), the rest stays in operating expense, and the two always add up to payroll cost.
- **Visibility:** every paid hour is accounted for — on a job, indirect (by category), or unlogged.

## Decisions taken

| Decision | Choice |
|---|---|
| Labour rate | Actual per employee per month, from the approved run: (salary cost + employer pension + gratuity accrual + leave provision change) ÷ hours |
| Capture | Timesheets per employee (manual and from the shop-floor clock); indirect categories; crews count each person |
| Posting | Monthly absorption inside payroll approval: Dr WIP (open jobs) or COGS (completed jobs) / Cr 6390 Labour absorbed |
| Before the month posts | Job labour shown as provisional at an estimated rate; becomes actual when the run is approved |
| Machine cost, overhead % | Unchanged: standard machine rate and template burden stay management figures, not posted |
| Users not linked to an employee | Their clock minutes still count, at the work centre's standard rate, labelled "unlinked" |

## 1. Timesheets

### `timesheet_entries` (new)

`id, tenantId, employeeId, workDate (date), hours (numeric 5,2, > 0), workOrderId (nullable), operationId (nullable), indirectCategory ('CLEANING' | 'MAINTENANCE' | 'TRAINING' | 'IDLE' | 'OTHER', nullable), source ('MANUAL' | 'CLOCK'), note, runLineId (nullable — set when absorbed), createdById, createdAt, updatedAt`.

- CHECK: exactly one of `operationId` / `indirectCategory`; `workOrderId` set iff `operationId` set.
- Σ hours per employee per `workDate` ≤ 24 (service check under a per-employee advisory lock).
- `workDate` within the employee's employment (joining..leaving).
- Index `(tenantId, employeeId, workDate)`, `(operationId)`.

### Rules

- **Lock:** create/edit/delete is refused (409, naming the run) when the employee's run line for `workDate`'s month is approved (non-voided). Void unlocks (and clears `runLineId`).
- **Work order state:** entries on a CANCELLED work order are refused; on a SKIPPED operation refused; COMPLETE is allowed (late timesheets) until the month is posted.
- **Operation minutes stay the single total.** Creating, editing or deleting a MANUAL entry applies the delta (hours × 60) to `work_order_operations.actual_minutes` under the work order lock (`lockOnFloor`), as `logTime` does today; editing or deleting a CLOCK entry does the same. A PENDING operation receiving time becomes PAUSED and the work order IN_PROGRESS, as `logTime` does.
- **Shop-floor clock:** in `stopOperation` (a session closed) and `logTime`, if the acting user is linked to an employee (`employees.user_id`), a `CLOCK` entry is created in the same transaction for the minutes just added (capped session minutes, rounded to 2 dp hours), dated the session's start date in the tenant's time zone, without applying the delta again. If the employee's month is already posted, the clock still records the minutes but creates no entry; those minutes become unlinked (below), so the shop floor is never blocked by accounting.
- **Unlinked minutes** = operation `actual_minutes` − Σ entry hours × 60 on that operation (≥ 0). Costed at the operation's frozen `labor_cost_per_hour` (standard), labelled "unlinked".

### API

| Route | Permission |
|---|---|
| `GET /timesheets?employeeId&from&to` | `timesheet:read` |
| `GET /timesheets/crew?workDate&workOrderId` | `timesheet:read` |
| `POST /timesheets` (single), `POST /timesheets/bulk` (grid/crew save: upserts and deletes in one transaction) | `timesheet:manage` |
| `PATCH /timesheets/:id`, `DELETE /timesheets/:id` | `timesheet:manage` |

Responses carry hours only. A `timesheet:read` user can list employees by name and number for timesheets (a minimal `GET /timesheets/employees`), without `employee:read`.

### Permissions — new domain file `packages/shared/src/rbac/permissions/timesheets.ts`

`TIMESHEET_READ = 'timesheet:read'`, `TIMESHEET_MANAGE = 'timesheet:manage'`. Grants: admin and manager both; member read-only (sees the floor's hours); viewer none. Registered in `permissions/index.ts`.

## 2. Rates and absorption

### Payroll settings

`payroll_settings` (from #3) gains `monthlyStandardHours (numeric 6,2, default 208, 100..320)`.

### Hourly cost (`packages/shared/src/payroll/labour.ts`, pure)

```
cost          = salaryCost + pensionEmployer + gratuityAccrual + leaveProvisionChange   (from the approved line)
standardHours = round2(daysEmployed / daysInMonth × monthlyStandardHours + overtimeHours + overtimeHoursPremium)
loggedHours   = Σ timesheet hours (direct + indirect) in the period
rate          = cost > 0 ? round4(cost / max(standardHours, loggedHours)) : 0
```

`max(...)` guarantees absorbed ≤ cost. A negative `cost` (e.g. a gratuity true-up down) gives rate 0 — nothing absorbed, the line is flagged.

Estimated (provisional) rate, used before the month posts:

```
estCost = gross + pensionEmployer(current scheme, full month) + basic × 21 / 30 / 12 + basic × annualDays / 30 / 12
estRate = round4(estCost / monthlyStandardHours)
```

(21 days/year gratuity — the first-five-years rate — and the tenant/employee annual leave days.)

Run line columns (frozen at approval): `standard_hours`, `logged_hours`, `direct_hours`, `labour_rate`, `labour_absorbed`.

### Absorption at approval

Inside `PayrollPostingService.approve`, after the existing lines and under the same locks:

1. Load the period's timesheet entries for the run's employees with operations (direct). For each employee: `amount = round2(hours × rate)` per entry; the rounding remainder (so Σ = round2(directHours × rate)) is put on the employee's largest entry.
2. Group by work order. Work order COMPLETE → `Dr COGS`; open (PLANNED/RELEASED/IN_PROGRESS) → `Dr WIP`; CANCELLED → not absorbed (stays in salaries; entries keep `runLineId` null and the line notes it).
3. `Cr 6390 Labour absorbed` for the total.
4. Write a `work_order_labour` row per (work order, employee): `id, tenantId, workOrderId, employeeId, runId, runLineId, period, hours, rate, amount, account ('WIP' | 'COGS'), clearedTo ('COGS' | 'EXPENSE', nullable — where WIP labour went when the job completed or was cancelled), clearedAt (nullable), journalEntryId`.
5. Stamp the entries' `runLineId` (direct and indirect).
6. Recompute `actualCost` for every COMPLETE work order touched (§3).

New account: **6390 Labour absorbed**, role `LABOUR_ABSORBED`, type expense, parent **6300** (a contra: carries credits), backfilled with the code-or-role guard. The P&L shows it nested under Salaries, so Salaries net = unabsorbed labour.

### Completion

`ProductionService.complete` adds the work order's `work_order_labour` rows with `account = 'WIP'` to the existing WIP→COGS entry (`JE-{wo}-DONE`), and stamps them `clearedTo = 'COGS'`, `clearedAt`. The entry posts if material + labour > 0.

### Void

`PayrollPostingService.void` reverses the absorption against where each amount sits now: rows with `account = 'WIP'` and no `clearedTo` reverse from WIP; rows booked to COGS or cleared to COGS reverse from COGS; rows cleared to EXPENSE reverse from 6390. The void journal stays one entry (the existing exact reversal, with the absorption debits re-pointed per row). `work_order_labour` rows for the run are deleted; entries' `runLineId` cleared; affected completed work orders' `actualCost` recomputed (labour back to provisional).

### Cancelling a work order with absorbed WIP labour

`cancel` today refuses while material is on the job. It now also moves absorbed WIP labour to expense: `Dr 6390 / Cr WIP` (labour returns to salaries), stamping the rows `clearedTo = 'EXPENSE'`, `clearedAt`. (A cancelled job's labour was spent; it is overhead, not cost of sales.)

## 3. Job cost

`actualCost` (`CostSplit`) keeps its shape; `labor` becomes the sum of three parts, exposed in a new `labour` breakdown on the work order DTO:

- **Actual:** Σ `work_order_labour.amount`.
- **Provisional:** Σ entry hours on this work order with no `runLineId` × each employee's `estRate`.
- **Unlinked:** unlinked minutes / 60 × the operation's standard `labor_cost_per_hour`.

`labourStatus`: `ACTUAL` (no provisional or unlinked), `PROVISIONAL` (some provisional), `MIXED` (actual + unlinked only). `overhead` is reapplied: `overheadPct × (material + machine + labor + tooling)` as the engine does today. `actualCost` is written on completion (as now) and rewritten whenever an approval, void or late timesheet touches a COMPLETE work order.

`work_orders` gains `labour_status (varchar 12, nullable)`.

Per-employee rates and amounts in the breakdown are visible only with `payroll:read`; totals follow the existing `quote:view_cost` rule (`canSeeCost`).

## 4. Reports

- **Margin report** (`ReportsService.margins`): rows gain `provisionalLabourShare` (provisional labour ÷ cost); the web shows a "provisional" badge when > 0.
- **Labour utilisation** `GET /reports/labour-utilisation?period=YYYY-MM` (`payroll:read`): per employee — standard hours, direct hours, indirect hours by category, unlogged hours (`max(standard − logged, 0)`), cost, absorbed, unabsorbed; totals; for months without an approved run, hours only with estimated cost marked provisional.

## 5. Web

- **Timesheets** under People (`timesheet:read`): weekly grid per employee (rows = operations picked from open/complete-unposted work orders, or indirect categories; columns = days; daily totals; locked cells for posted months) and a **Crew day** view (pick a work order and date, enter hours per employee).
- **Work order detail:** Labour panel — per employee hours, rate, amount, status (actual / provisional / unlinked), honouring the permission split.
- **Margin report:** provisional badge. **Labour utilisation** report page under Reports.
- **Payroll run detail:** per line standard / logged / direct hours and absorbed amount (`payroll:read`).
- **Payroll settings:** monthly standard hours.

## 6. Audit

Subjects: `timesheets` → `TIMESHEET`. Absorption is part of the run approval's audit row (no new action). Clock-created entries are part of the operation stop's audit row.

## 7. Error handling

- Shared zod schemas `packages/shared/src/schemas/timesheets.ts` for single, bulk and patch bodies.
- 409s name the posted run or the cancelled work order; 422 for the 24-hour daily cap names the date.
- The clock never fails because of timesheets (see §1).
- Approval with timesheets on a work order whose WIP/COGS role is missing → 404 as structural roles do today; 6390 falls back to 6000 if absent (#1 mechanism).

## 8. Testing

- **Shared unit:** rate (standard vs logged cap, overtime adds hours, joiner prorating, cost ≤ 0 → 0), estimated rate, rounding remainder allocation, `labourStatus` derivation, cost split recompute with overhead.
- **API service:** manual entry adjusts operation minutes (create/edit/delete deltas); clock stop by a linked user creates one CLOCK entry and does not double count; unlinked user creates none; posted-month refusal and silent clock fallback; daily cap; cancelled WO refusal; approval absorbs to WIP for open and COGS for complete jobs with exact amounts and a balanced journal; completion moves WIP labour with material; void after completion reverses from COGS; cancel moves WIP labour back to 6390; completed job `actualCost` goes provisional → actual on approval and back on void; permission masking of per-employee rates.
- **Reports:** margin provisional share; utilisation totals (absorbed + unabsorbed = Σ cost).
- **Migration:** new tables with FORCE RLS; 6390 backfill; run-line and work-order columns; CHECK constraints.
- **CI seed:** the seeded payroll month gets timesheets (direct hours on seeded work orders, some indirect, one clock-linked user); the run approval absorbs; seed asserts Σ absorbed + Σ unabsorbed = Σ line cost and that each completed seeded work order's WIP is zero; `check:books` stays balanced.

## Out of scope (FLAGS)

- Machine-hour posting and overhead absorption into the books (template burden stays a management figure).
- Timesheet approval workflow and employee self-entry.
- Job costing for things that are not work orders (projects, service tickets).
- Re-costing jobs from months before go-live; jobs completed before #4 keep their standard-rate labour.
- Pay-period splits within a month (rate is per month).
