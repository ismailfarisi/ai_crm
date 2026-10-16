# Payroll, UAE compliance and job costing: what to do after deploying

This release adds employees and payroll, UAE compliance (leave, GPSSA/ADPF pension, final settlement and WPS), and job costing (timesheets and actual labour on work orders). The code is merged, but a few steps can't be automated. Some are done once on each server, and others once for each organisation that uses payroll. The trade-offs behind the features are in [FLAGS.md](FLAGS.md), under "Employees and payroll", "UAE payroll compliance" and "Job costing".

## 1. On each server (staging, then production)

Follow [DEPLOYMENT.md](DEPLOYMENT.md), with these additions.

1. **Take a backup first.** This release adds three migrations:
   - `1790000000000-EmployeesAndPayroll`
   - `1790100000000-UaeCompliance`
   - `1790200000000-JobCosting`

   They create tables and backfill these ledger accounts into every existing tenant: 1450, 2300, 2400, 2410, 2420, 6310, 6320, 6330 and 6390.
2. **Set `PAYROLL_DATA_KEY`.** Generate it with `openssl rand -base64 32` and put it in the env file before starting the API. The API refuses to boot in production without it.
   - Back the key up together with the env file. If it is lost, every stored IBAN becomes unreadable and has to be re-entered.
   - Never change it on a server that already holds employees.
3. **Run the migrations** with the admin credentials (DEPLOYMENT.md, step 4). Then restart `api`, `worker` and `web`, and rebuild `marketing`, because the marketing site now also redirects `/people`.
4. **Check that the API booted.** On boot it seeds the new permissions (`employee:*`, `payroll:*`, `timesheet:*`).
5. **Check the books.** Optionally, run `pnpm check:books` against the server. Every tenant's trial balance should still sum to zero.

Nothing else on the server needs configuring. Payroll stays dormant for an organisation until someone adds an employee.

## 2. Who can do what

Default grants:

| Role | Gets |
|---|---|
| Admin | Everything |
| Manager | `employee:read`, `timesheet:read`, `timesheet:manage`. Sees who works here, not what they earn. |
| Member | `timesheet:read` |

Anyone who runs payroll needs `payroll:read`, `payroll:manage`, `payroll:approve` and `payroll:pay`. Admins already have them; grant them to other roles under Settings → Roles if needed.

## 3. Setting up an organisation (once, in this order)

The order matters. Opening balances must be posted **before** the first payroll run is approved. Otherwise that run books every employee's past service as one month's expense (FLAGS: "Opening gratuity is refused for employees already accrued by a posted run").

1. **People → Settings.**
   - **Annual leave days:** 30 by default.
   - **Monthly standard hours:** 208 by default, i.e. 26 days × 8 hours. This drives each employee's cost per hour on jobs.
   - **WPS profile:** for mainland and WPS free-zone companies. Enter the employer ID type (MOHRE or free zone), the employer ID, and the payer bank's 9-digit routing code. The WPS export only works when the base currency is AED.
2. **People → Settings → Pension schemes.** Check the GPSSA and ADPF presets against the funds' current rates, then activate the ones you use.
   - The presets start inactive on purpose; the rates come from public sources and change.
   - For GCC nationals, add a custom scheme with their home-country rates.
3. **People → Employees.** Add each employee with:
   - joining date;
   - salary package (basic, housing, transport, other allowances);
   - payment method, plus bank and IBAN for bank-paid staff.

   Then fill in the following where they apply:
   - **WPS:** person ID (14 digits) and bank routing code, for staff paid through WPS.
   - **Nationals:** tick *UAE/GCC national* and pick their pension scheme.
   - **Probation:** set the probation end date. Sick days on or before it are unpaid.
   - **Login link:** link the employee to their user account, if they use the shop-floor clock. Their clock time then becomes timesheet hours charged to jobs.
4. **People → Payroll → Opening gratuity.** Pick the cut-over date, usually the last day before your first Kerf payroll month. Check the calculated end-of-service balances, override any figure that differs from your records, then post.
5. **People → Payroll → Opening leave.** Use the same cut-over date. Enter each employee's current leave balance in days, then post.

## 4. Every month

1. **Record leave** (Employee → Leave tab) and **timesheets** (People → Timesheets, or the shop-floor clock) for the month.
   - Do this before approving the run. Once a month's run is approved, its leave records and timesheets are locked.
   - To correct a locked month, void the run, fix the records, and approve again.
2. **People → Payroll → New run** for the month.
   - The run fills unpaid, sick half-pay and pension from the records.
   - Add overtime, bonuses, advance recoveries and other deductions.
   - Clear every warning flag. Approval is refused for a national without an active pension scheme, and for a leaver who is already settled.
3. **Approve.** One approval posts salaries, the gratuity and leave provisions, and pension. It also charges the month's timesheet hours to jobs: open jobs go to work in progress, finished jobs go to cost of sales.
4. **Export SIF** (WPS organisations). Upload the file to your bank or exchange house, then **Pay** the run from the account it was paid from.
5. **Pension:** remit the month's contributions to the fund by the 15th of the next month. Open the approved run and use **Remit** in its Pension panel.

## 5. When someone leaves

1. Set the employee to **Left** and enter the leaving date.
2. Approve the payroll run for their final month.
3. **People → Settlements → New**. The calculated figures are:
   - gratuity: zero under one year of service;
   - leave encashment;
   - advance recovery.

   Add notice pay and any other lines, then **Approve** and **Pay**. Export a SIF for the settlement if you pay it through WPS.
4. **Print the statement** from the settlement page.

## 6. Watch the first time

- **Approving a month's run.** On the first organisation that runs payroll, check the trial balance afterwards (Finance → Reports) and the P&L lines 6300–6390.
- **Labour on jobs.** Until a month's run is approved, a job shows its labour as *provisional*, at an estimated rate. It becomes *actual* when that month is approved. The margin report shows how much of each row is still provisional.
