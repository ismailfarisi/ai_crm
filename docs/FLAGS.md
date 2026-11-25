# Known flags and gaps

Everything the nine-sprint production-readiness programme (S0–S8) left open,
deferred, or discovered on the way. Written at the end of S0, which shipped
last.

Each entry says what is true, why it is that way, and what it would take to
close. Nothing here is a bug report against a sprint that failed — these are
trade-offs taken deliberately, plus things found along the way that were out of
scope to fix.

Status key: **open** — not addressed; **by design** — will not change without a
decision; **staging** — an artefact of the staging environment, not the code.

---

## Platform

### The audit trail starts on 2026-09-16 — open, permanent

S0 shipped last, so the trail says nothing about anything that happened before
it was deployed. Nothing was backfilled: an audit row invented for a change
nobody observed would be a lie in the one table that exists to be trusted. For
the months before, the ledger, the documents and their timestamps are the only
record.

### An audit row is written after its change, not with it — open

`AuditInterceptor` waits for the audit write before the response is released,
and photographs `after` the moment the handler returns, so the trail cannot
capture a later change by mistake and a crash can only lose a row inside one
insert. If the insert fails, `AuditService.record` queues the row in
`crm_event_outbox` (kind `audit`) with an id chosen up front and the original
time, and the dispatcher replays it idempotently. A row is dropped only when
the outbox cannot be written either — the database is down — and that is
logged.

What is still true: the row is not in the handler's transaction, because an
interceptor cannot reach it. A change can commit and its audit row then fail
to land (and fail to queue). And an audit failure still never fails the
user's request — the change has happened, and a 500 would say it had not.
Closing the gap means each service recording inside its own transaction.

### CRM events are delivered at least once, through an outbox — open

`CrmEventBusService.publish` writes the event to `crm_event_outbox` and
returns; a dispatcher in the API process claims rows with
`FOR UPDATE SKIP LOCKED` under a five-minute lease, runs subscribers under the
event's tenant, retries failures with exponential backoff (5s doubling to 15
minutes), and after `EVENT_OUTBOX_MAX_ATTEMPTS` (10) parks the row as `DEAD`
with its last error. A slow or failing subscriber no longer slows or fails the
request. The worker writes events but does not dispatch, because it does not
load the subscribers.

Three things follow:

- **Redelivery is possible**, after a crash or when any one subscriber fails
  (the event goes to all of them again). Subscribers receive `eventId`, stable
  across redeliveries, to dedupe on. The automation bridge does not dedupe
  yet: `triggerExecution` names the Temporal workflow after a fresh execution
  id, so a redelivered event starts the automation twice. It also swallows its
  own per-workflow errors, so a failed automation start is never retried.
  Both are changes to `automation-event-bridge.service.ts` / `automations.service.ts`.
- **Call sites still publish after their commit**, so a crash between the two
  loses the event. `publish(event, { manager })` writes it inside the caller's
  transaction instead; the services have not been switched over.
- **Dead rows wait for a person.** Requeue them as in `docs/DEPLOYMENT.md`.
  Delivered rows are pruned after seven days.

### Database connections are bounded and time out — by design

Each process holds at most `DB_POOL_MAX` (10) connections, and every
connection runs with `statement_timeout` 30s and
`idle_in_transaction_session_timeout` 60s, all env-configurable, 0 to disable.
Migrations use their own data source and are exempt. TLS certificate checking
is `DB_SSL_REJECT_UNAUTHORIZED`, off by default because that is what staging
has always run with; turn it on once the CA is trusted in the container. The
migration data source still does not verify regardless.

### Lint does not block CI — open

`pnpm lint` fails with roughly 300 pre-existing errors (~225 in `apps/api`, ~94
in `apps/web`), none of them in code written during the programme. The CI lint
job is `continue-on-error: true`, because a check that is red the day it lands
teaches everyone to ignore it. Closing this means working through the backlog,
then flipping one line in `.github/workflows/ci.yml`.

### The schema has ~100 known drift statements — open

A schema migrated from zero still differs from the entities in about 100
statements: legacy index names, enum renames, defaults that exist only on an
entity. They are recorded in `scripts/drift-baseline.json`, reported by
`pnpm check:drift`, and not failed. Anything outside the baseline fails, so new
drift cannot arrive. Fix some, then run `pnpm check:drift --update-baseline`.

Foreign keys and CHECK constraints are a separate, permanent category: they are
declared in migrations rather than on entities, deliberately, so entity relation
metadata never drifts and FK names never churn. The drift check ignores those by
pattern.

### nginx does not pass the visitor's address — open, needs sudo

The chain is Cloudflare → nginx → API. nginx replaces `X-Forwarded-For` with
the address it sees, which is the Cloudflare edge, so the visitor's own address
never reaches the API. Two consequences: rate limiting buckets people by
Cloudflare edge rather than by person, and the audit trail records edge
addresses (`172.69.224.98`) instead of visitors (`5.31.131.116`).

The API side is already correct — `TRUST_PROXY_HOPS=2` on staging, verified:
given `X-Forwarded-For: 1.2.3.4, 5.6.7.8` it attributes `1.2.3.4`. It just
never receives a chain with the visitor in it.

Fixing it needs a root-owned nginx change, either appending the chain:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

or, better behind Cloudflare, taking the address from the header Cloudflare
signs its requests with and restricting the origin to Cloudflare's ranges:

```nginx
# https://www.cloudflare.com/ips/ — refresh these periodically
set_real_ip_from 173.245.48.0/20;   # ... and the rest of the list
real_ip_header CF-Connecting-IP;
```

Without the origin being Cloudflare-only, trusting `CF-Connecting-IP` lets
anyone who can reach nginx directly claim any address, which is why this is not
done in application code.

### Quote links and file downloads found nothing in production — resolved (2026-10-29)

`GET /public/quotes/:token`, its accept route and `GET /attachments/:id/download`
take no session, so the request has no tenant, and with the app role enforcing
row-level security the lookup saw no rows: every quote link said "not valid"
and every signed download said "File not found". Tests and local runs did not
show it because they did not exercise these routes as the NOBYPASSRLS role.
The token (or signature) now names the row and is looked up outside any tenant;
everything after runs as that row's tenant. `test/public-links.e2e-spec.ts`
covers both as the app role. Any new public route that finds a row by token
needs the same treatment.

### The S3 storage driver has never talked to a bucket — open

`STORAGE_PROVIDER=s3` is written and typechecked but untested; every environment
runs `local`. It needs `STORAGE_S3_BUCKET` and credentials from the SDK's
default chain. Test it before any deploy that depends on it.

### Attachments cover five owner types — by design

Quotes, invoices, purchase orders, bills and expense claims, as the plan
specified. Sales orders, work orders, delivery notes and credit notes have no
file panel. Adding one is an entry in `modules/storage/attachment-owners.ts`, a
string in `@saas/shared`, and the panel on the page.

### Finance, quotes and dashboard still use raw palette colours — open

`globals.css` defines semantic tokens (`surface`, `ink`, `border`, `brand`,
`success`/`warning`/`danger`/`info`) and a `.dark` block that overrides them.
Screens written against raw Tailwind values instead — `stone-200`, `amber-600`,
`emerald-50` — neither match the rest of the app nor follow dark mode, because
the dark block only moves the tokens.

Automations was converted when it was reported as looking different. What is
left, by rough count of raw palette classes: finance ~440, quotes ~130,
dashboard ~58, settings ~15, and the app shell ~9 (those last ones carry
explicit `dark:` variants, so they do at least follow the theme).

The conversion is mechanical: greys to `surface`/`ink`/`border`, the brand
amber to `brand`, and status colours to the four semantic families.

### Uploads are buffered in memory — open

Capped at 25MB per file. Fine at that size; larger artwork would need a
streaming upload straight to the driver.

### The nightly eval job needs a secret — open

`.github/workflows/evals-nightly.yml` runs the routing set against the live
provider and reports accuracy. It does nothing until `EVAL_ANTHROPIC_API_KEY` is
set in repository secrets. The CI evals, which replay recorded answers, need
nothing.

### Date pickers still follow the browser's language — open

Every date Kerf prints goes through `formatDisplayDate` in `packages/shared`
("24 Nov 2026"). The 43 native date pickers do not: Chrome and Safari lay
them out in the browser's own language, so a browser set to US English still
shows mm/dd/yyyy inside the picker. The page is marked `lang="en-GB"`, which
Firefox honours. Closing it fully means a custom date picker everywhere, which
was more change than a wording pass should carry.

### Dates are counted in UAE time on every screen — by design

`formatDisplayDate` counts the day in `Asia/Dubai` unless told otherwise, the
same zone the PDFs use, so an invoice issued at 00:30 Dubai time reads 25 Nov
on its page and on its PDF, whatever the viewer's laptop clock says. A
`YYYY-MM-DD` value (a due date, a delivery date) is a calendar day and never
moves. If Kerf ever serves a business outside the Gulf this becomes an
organisation setting.

### An uncosted line hides a loss's figure too — by design

When any line has no cost the badge and card show no percentage and no
amount, including on a quote that is already at a loss: the badge then reads
"Loss, margin not known yet: 1 line has no cost". The true loss is at least
the shown one, so the figure would understate it.

### A contact named by its chat number is renamed on the next message — by design

Telegram contacts used to be created with the chat id as their first name
("77001"). When such a sender writes again, the contact takes the name the
channel now sends (their name, else @username, else "Telegram user"). Only a
contact whose first name is still exactly the id and has no last name is
touched, so a name somebody typed is never overwritten. The rename happens on
an inbound webhook with no actor, so like the contact's creation it is not in
the audit trail. The inbox also shows "Telegram user" for a numeric name until
then.

---

## Money and currency

### Expense claims and account transfers are not currency-converted — resolved (2026-10-26)

A claim's accrual converts at the rate on its expense date; the reimbursement
clears the payable at that rate and takes the cash at the day's rate, with the
gap in exchange gains and losses. Accruals posted before this (no `currency`
on the entry) settle at face value too, so no difference is invented. Claims
now default to the base currency instead of `USD`, in the form and the API.

A transfer between accounts in different currencies asks for the amount that
arrived (`toAmount`). When one side is base currency the bank's own conversion
sets the value of both sides; between two foreign currencies each side goes at
the day's rate and the gap is an exchange difference (`transferValues` in
`finance/fx.ts`).

### A finance account must match the document or the base currency — by design

`cashAccountAmount` refuses a payment into an account held in a third currency,
because there is no honest rate to use for it. Paying a EUR invoice into a GBP
account is fine (converted at the payment rate); paying it into a USD account is
refused, with a message naming both. Multi-currency bank accounts would need a
per-account rate at the moment of payment.

### Documents from before S8 are stamped at rate 1 — by design

The migration set `fx_rate = 1` on every existing document. That is what the
books had implicitly assumed all along; restating history at rates nobody
recorded would be inventing numbers. Documents posted since carry their real
rate.

### Revaluation makes the aging report disagree with the ledger — by design

A month-end revaluation restates open foreign balances on the last day of the
month and reverses it on the first of the next. Between those two dates the
receivables aging report (which values at document rates) differs from the
receivables account by the revaluation amount. That is the revaluation doing its
job, but it reads like an error in the report.

### A payment cannot be dated before its invoice or bill — by design

`POST /invoices/:id/payments` and `POST /bills/:id/payments` refuse a `paidAt`
on an earlier UTC day than the invoice's issue date or the bill's date. The
payment's journal entry carries that date, so an earlier one put receivables
(or payables) the wrong way round for the days in between. Money that really
moved first is recorded on the document's date; the same day is always allowed,
whatever the hour. Advance money from a customer is still taken as a deposit
invoice (see "Customer deposits are taken as a deposit invoice"), which is
issued before it is paid, so that flow is untouched. There is still no way to
record an unapplied receipt before any invoice exists. Payments stored before
this rule keep their dates: nothing is rewritten, and the ageing reports show
them as a credit until the document's date.

### Ageing reports are rebuilt from dated events, and show credits apart — by design

For any `asOf`, receivables and payables ageing add up what had happened to
each document by then (issue, payments, credit notes, refunds, reversals, a
void) instead of reading its running totals, which are today's. Three things
follow. A date-only `asOf` means the end of that UTC day. A credit note is
dated when it was issued and a refund when it was paid, because that is the
date their journal entries carry. And an invoice the customer has paid or been
credited beyond stays in the report as a negative row: it is in `total` (the
receivables account holds it) and in `customerCredits`, but in no overdue
bucket, because money owed back to a customer is not a late debt.

Payables ageing also lists approved expense claims awaiting reimbursement
(`staffClaims`). They sit in the same 2100 account as supplier bills, so the
report compares bills plus claims with that account. What is owed on a claim is
read from the payables lines of the claim's own journal entries, since the
claim row keeps neither the posting date nor the rate. They are not aged into
the overdue buckets: a claim has no due date.

### An invoice is overdue the day after it falls due, counted in UAE time — by design

`isInvoiceOverdue`, the ageing buckets, the overdue-reminder sweep and the
daily summary's overdue count all ask the same question: did the due date fall
on a UAE day that has already ended (`invoiceOverdueCutoff`, `daysOverdue`)? So
an invoice on "Due on receipt" terms, whose due date is the moment it was
issued, is current for the rest of that day and overdue from midnight Dubai
time. It is the same day the screens and PDFs print (`DOCUMENT_TIME_ZONE`), so
an invoice shown as due 25 Nov is never overdue on 25 Nov. The ledger, period
lock and report ranges still compare in UTC; a shop outside the UAE would need
a per-organisation timezone setting the app does not have.

### What a customer owes is one number everywhere — by design

The customer page, the customer statement, the dashboard, invoice and order
pages and the record-payment form all count what is owed as invoiced less
paid, less credit notes, plus refunds (`invoicePosition`), the definition the
receivables ageing and the ledger use. On the customer page a customer whose
credits exceed what they owe is shown "In credit" rather than a negative
"Currently owed", and the statement carries credit notes and refunds as their
own lines. Single-invoice figures never go below zero; the money owed back is
the invoice's refundable amount.

### "Accepted" is shown, not stored — by design

A quote the customer accepts keeps `status = APPROVED` with `acceptedAt` set,
because the quote workflow, acceptance links, order creation and automations
all read `APPROVED`. Every screen works the state out with `quoteDisplayStatus`
instead: the quotes list, pipeline board (which now has an Accepted column),
customer page, dashboard win rate, table search and the CSV/JSON export all say
Accepted. The API's own quote list and automation record lookups still return
the stored status plus `acceptedAt`/`accepted`, so a workflow built on
`APPROVED` keeps working; storing a separate status would mean migrating every
one of those readers.

### Base currency cannot change once anything is posted — by design

Every ledger entry is denominated in it. `PUT /finance/currencies/base` refuses
with a 409 after the first journal entry.

---

## Keeping the books

Manual journals, the period lock and bank reconciliation
(`1790500000000-AccountingCore`).

### The period lock is a trigger, and compares UTC dates — by design

`journal_entries_period_lock` refuses any entry dated on or before
`organizations.books_locked_through`, whatever posted it. Documents, payroll and
Temporal activities all go through it; the API answers `KB001` with a 409. Dates
compare in UTC, like every report's range, so an entry made at 01:00 in Dubai
on the 1st is dated the last day of the previous month. The one automated
posting that moves itself forward rather than failing is an expense claim's
accrual (`BooksService.openPostingDate`): its date is the employee's, not the
approver's. Revaluing a locked month fails, which is the point.

### Manual journals cannot touch receivables, payables, stock or 1000 — by design

Those accounts are reconciled to their documents (aging, stock valuation), so a
journal to them would break the reconciliation with nothing to explain it. The
same goes for 1000, which only groups the bank accounts. Corrections go through
a credit note, a bill or a stock adjustment.

### Opening stock is credited to opening balance equity — by design, accountant to confirm

Stock the business already held on the day it started here is entered as an
opening count (`kind: 'OPENING'` on `POST /inventory/adjustments`, the "Enter
opening stock" dialog and the opening-stock import). It posts Dr 1200 Inventory
/ Cr 3100 Opening balance equity, the account bank opening balances use,
because stock already owned is not income and must not reduce cost of sales.
Whether 3100 is the right account for a given business is for its accountant
to confirm.

The caller says which kind an adjustment is; the API no longer guesses from a
unit cost being present. A correction that carries a unit cost is refused, and
an opening count needs a cost and a quantity above zero. An opening count is
also refused on top of a negative balance: the count is corrected first.

Opening counts posted before this change credited 5000 Cost of goods sold and
are left as they are: journals are append-only. A business that wants those
moved needs a manual journal (Dr 5000 / Cr 3100) for the amount, which the
journal screen allows because neither account is sub-ledger controlled.

### A stock recount upwards is valued at the cost the stock stands at — by design

A correction never states a price. Stock added by a recount comes in at the
position's moving average, so the average does not move and the entry mirrors
the write-off it undoes (Dr Inventory / Cr Cost of goods sold). The price is
stored on the movement, so a replay reaches the same average.

When there is nothing to average over, in this order:

1. No stock on hand, but the position held stock before: the last average it
   held (the position keeps it when the quantity reaches zero).
2. The material has never been in stock at this location: the material's
   catalog cost per unit (`costPerUom`).
3. Neither is set: the stock is added at zero and nothing is posted. Its real
   cost arrives with the next receipt, or with an opening count.

The catalog cost is an estimating figure, not a purchase price, so case 2 is
an approximation. It was chosen over refusing the recount because a count
that cannot be recorded is worse than one valued at the price the business
quotes with. Movements recorded before this change added recounts at zero
and replay as they were stored.

### Stock value is held to four places, the ledger to two — by design

Unit costs and stock value are kept to four decimal places; journals are
posted in whole fils. Each stock journal is the movement's value rounded to
two places, and a movement worth less than half a fil posts nothing. So 1200
Inventory can differ from quantity x average cost by under half a fil per
movement, and only on materials whose unit cost has more than two places.

### Journals cannot move a foreign-currency bank account — open

A journal states base-currency amounts; a USD account's balance is in dollars,
and there is no rate on a journal to convert at. Such lines are refused, so a
bank charge on a foreign account must go through a transfer or a payment. The
same applies to "Book & match" on its statement lines.

### Only document-free journals can be reversed — by design

A journal posted by an invoice, a bill or payroll is undone through that
document, or the document and the ledger disagree. Each journal is reversed at
most once (`uq_journal_entries_reverses`).

### Reconciliation matched one statement line to one entry — resolved (2026-10-29)

A match is now a group (`bank_matches`): any number of statement lines against
any number of entries, whose totals must agree in base currency. A deposit of
three cheques is one line and three entries; a payroll paid out per person is
many lines and one entry. Unmatching any line of a group reopens all of it.
Existing matches were carried over as groups of one and one by migration
1790900000000-BankMatchGroups.

### Match suggestions are exact-amount only — by design

`suggestReconciliation` (in `@saas/shared`, so the screen and the API agree)
proposes one-to-one pairings, one line made of up to four entries, and up to
four lines making one entry, within ten days. It never proposes a near amount:
a difference is a question for a person. Only a pairing that is the only one
either side could make, within five days, is marked certain, and "Match N
certain" applies those and nothing else. Combinations are never certain. An
account not in base currency gets no suggestions, since its amounts cannot be
compared with a base-currency ledger.

### Reconciliation on foreign-currency accounts, and the statement balance — open

For an account not in base currency the amounts are not compared, because the
ledger side is in base; a group only has to move money the same way on both
sides. The statement balance is the sum of every line imported, so it is only
a real closing balance when imports start from the account's first day.

### No fixed-asset register — open

Depreciation is a monthly manual journal against an asset account and its
accumulated depreciation, with nothing scheduling it.

---

## Importing data

### An import reads the file twice — by design

The dry run saves nothing, not even the file. Importing sends the same file
again and every row is checked again against current data, so a record added
between review and import is matched, not duplicated. Files are capped at 5MB
and 5,000 rows, held in memory like other uploads; an xlsx is also refused if
it would unpack to more than 100MB. Only the first sheet is read.

### One audit entry per import — by design

The audit trail gets one `import.<entity>` row per import, pointing at the
`import_runs` record with the counts. The records it creates or updates are
not audited one by one. The dry run is not audited at all.

### Imported contacts do not start automations — by design

A contact created by hand publishes `record.created`, which can start an
automation (a welcome email, a task). An import does not, so bringing in 3,000
old contacts does not send 3,000 emails. Row numbers in the review and the
error file are the spreadsheet's own, blank rows counted.

### Rows are saved in batches of 200 — by design

Each batch is one transaction and each row a savepoint inside it, so a row
that fails (a duplicate SKU, a database rule) is reported and the rest of the
batch still saves. A failure part-way leaves earlier batches saved; the result
and the error file say which rows did not go in.

### Opening stock skips materials that already have stock — by design

Each row is an opening count at the unit cost given, posted to the books like
one entered on the Stock screen (Dr Inventory / Cr Opening balance equity, see
"Opening stock is credited to opening balance equity" under Keeping the
books). Updating a count would mean a second adjustment against
stock that may already have moved, so a material that holds stock is skipped
and corrected with a normal adjustment instead. It goes to the default
location; locations and lots are not imported.

### Not imported yet — open

Suppliers, product templates, tooling, price breaks and open invoices or
balances. Contacts are not linked to customers on import. Header matching is
English only.

---

## Billing

### Stripe is untested — open

`BILLING_PROVIDER=stripe` is implemented (REST via fetch, HMAC webhook
verification with a 300s tolerance) but has never run against real keys. Staging
runs the fake provider with `BILLING_FAKE_CHECKOUT=true`. Before going live: set
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_IDS`, turn
`BILLING_FAKE_CHECKOUT` off, and replay a webhook.

### Only the owner role can manage billing — by design, worth revisiting

`org:manage_billing` is granted to `owner` alone (through `grantsAll`), so an
admin cannot subscribe or change a plan. That is a deliberate choice about who
commits the company to a payment, but it surprises people. One line in
`packages/shared/src/rbac/permissions/organization.ts` changes it.

### Staging runs with an unlimited trial until Stripe is live — open

`BILLING_ENFORCE` defaults to `true`, which pauses writes (402) once a trial
ends or a failed payment passes its 14-day grace period. Reads, billing and
sign-in keep working either way. On 2026-10-15, the day the S8 migration's
30-day trials ran out, staging was switched to `BILLING_ENFORCE=false`. While
it is off, nothing is restricted, the banners disappear, the billing page shows
the trial as "No limit", and the daily trial-ending reminders are not sent.
Turn it back on once Stripe is live (see "Stripe is untested" above). At that
point, trials that have already lapsed restrict immediately, so extend
`trial_ends_at` first if existing organizations should get notice.

### Customer deposits are taken as a deposit invoice — by design

Online deposits do not create an unapplied payment. A quote with a deposit
stage raises a tax invoice for the deposit when it is accepted, and the
customer pays that invoice. The final invoice bills only the balance, so VAT is
charged once on each part and the tax point lands where the money arrives. This
avoids the gap in "Advance payments before an invoice create no tax point"
under Tax, for online deposits only: a deposit recorded by hand against no
invoice still has that gap.

### Part invoices raised before 2026-11-24 were corrected in place — by design

Until then a stage's net was worked out apart from its total and tax. On a
fixed deposit against a discounted quote the discount was added back (net
5,000 and tax 200 stored on an invoice for 4,200), and a percentage split
could be a cent out (2,416.67 + 120.84 on an invoice for 2,537.50). The
journal was right throughout: it credits sales with the total less the tax.
The tax report, the VAT201 and the margin report read the invoice instead, so
they disagreed with the ledger.

Migration `StageInvoiceNetAndOrderLineTotals` sets the stored net of those
stages and invoices to total less tax, scales the invoice's tax breakdown to
it, and gives order lines that were stored at 0 the total their quantity,
price and discount give. No total, no tax and no journal entry changes, so
what the customer owes and what the books say are as they were. What does
change is what the tax report and VAT201 show for the periods those invoices
fall in: taxable sales move from the deposit's period to the balance's by the
amount that was wrong. A return already filed from the old figures will not
match the report any more and may need a voluntary disclosure; the report
after the migration is the one that agrees with the ledger.

### A stage's share of the discount is for showing only — by design

`allocateStageAmounts` splits a quote's total and tax across its stages and
takes each stage's net as total less tax, so net + tax is the total on every
invoice and the stages add up to the quote. The stage's `discountAmount` is its
share of what was taken off the quote on the way to the subtotal; nothing is
subtracted from the stage for it. A quote line's `subtotal` is likewise never
taken from the caller: the API works it out from quantity, unit price and
discount on every save.

### Tenant payment keys are untested against live Stripe — open

Each tenant's own Stripe secret key and webhook secret (Settings > Online
payments, `org:manage_payments`) are encrypted with `APP_SECRET` (the same
AES-GCM helper as channel credentials) and never sent back to the browser. Checkout and webhook handling follow
Stripe's documented test-mode shapes and are unit tested, but have not run
against a real account. Staging uses the test checkout
(`PAYMENTS_FAKE_CHECKOUT`, on by default outside production). This is separate
from Kerf's own subscription billing above.

### Online payment refunds are recorded by hand — open

A webhook records a payment and nothing else. Refunds issued in the Stripe
dashboard do not reach Kerf; record them with a credit note and refund as
today. Voiding an invoice paid online reverses the payment in the books but
returns no money; refund it in Stripe as well. A payment larger than the balance (a stale tab) is recorded up to the
balance, and staff are notified to refund the rest.

### Pay buttons cover deposits and invoices only — open

Settings choose between a Pay button on accepted quotes (the deposit) and on
invoices. Milestone invoices are paid from their invoice link like any other.
Telr and Network International would each be one more `TenantPaymentProvider`;
neither is built.

---

## Tax

### Purchase reverse charge — resolved for UAE, open elsewhere

An approved bill on a reverse-charge code (UAE `RC` or `IM`) self-assesses the
code's rate on its net: debit and credit tax payable by the same amount, fixed
in `supplier_bills.reverse_charge_tax`. The tax report shows it as both output
and input tax; the VAT201 puts it in box 3 or 6 and in box 10.

Outside UAE VAT mode a reverse-charge code must carry 0% (EU rule in
`assertCodeShape`), so an EU purchase still self-assesses nothing. Supporting it
would mean letting a purchase reverse-charge code carry the buyer's own rate.

### Blocked input VAT is a cost — resolved (2026-10-26)

A bill on a `BLOCKED` code used to debit tax payable like any input tax, so the
return reclaimed VAT the law does not allow. It now debits the bill's largest
expense line (cost of sales when the bill is all goods), stays out of the input
tax total and out of VAT201 box 9.

### The VAT201 puts all standard-rated sales in the head office's emirate — open

Invoices do not record the branch that made the supply, so box 1 cannot be split
by emirate. A business with branches in several emirates must split box 1 by
hand. A return with no head-office emirate set warns rather than guessing one.
Box 2 (tourist refunds) and box 7 (import adjustments) are always zero.

### Input tax is dated by approval, not by the supplier's invoice date — open

The tax report and VAT201 take bills by `approvedAt`, as before. A bill dated
in September but approved in October lands in October's return.

### An expense claim's VAT is dated by approval, and comes back out on rejection — by design

A claim with a purchase tax code is a purchase like a bill: on approval the
recoverable VAT goes to the tax account, the rest to the cost, and the gross is
owed to the employee (account 2100, unchanged). The tax report and VAT201 take
it by `taxPostedAt` (the moment it was approved), the same way bills go by
`approvedAt`, while its journal is dated by the day the money was spent, as a
claim's always was. So a receipt from September approved in October is in
October's return and September's ledger; over all time the tax account and the
returns agree.

What reached the tax account is stored on the claim (`recoverableTax`,
`reverseChargeTax`, `fxRate`), so editing a tax code later does not change a
return that was already filed.

A claim rejected after it was approved is not edited out of the books: a
mirror-image journal (`<claim id>:reversal`, `reversesEntryId`) is posted on
the day of the rejection, and the tax report shows the VAT leaving in that
period (`taxReversedAt`), like a credit note. Before this, an approved claim
that was then rejected stayed in the ledger as a cost and a payable for ever.

Once a claim is in the books its amount, currency, category, date, VAT and
status cannot be edited. There is no "void" and no way to re-open a rejected or
paid claim: the correction is to reject it (while approved) and submit a new
one. A paid claim cannot be reversed at all yet.

In UAE VAT mode recoverable VAT needs the supplier's TRN on the claim (15
digits, format check only). Without one the claim form, the receipt scanner and
the chat receipt skill all leave the claim on "No VAT". A simplified tax
invoice, which need not show the buyer, is accepted on the same terms as a full
one; nothing checks that the invoice is addressed to the business.

The scanner only ever suggests a code: the standard one when the receipt shows
VAT and a TRN, the blocked one for a meal or entertainment. Whether a
particular meal is blocked (staff entertainment) or recoverable (a business
trip) is the approver's call, and they can change it before approving.

### Purchase orders carry no tax code — open

`tax_code_id` is on sales documents and on supplier bills, but not on purchase
order lines, so an order's tax is only resolved when the bill arrives.

### Tax rules match a country, the EU, or everything — open

`taxRuleFor` matches an exact country code, then `EU`, then `*`. There is no
region or state matching, so anywhere with sub-national tax (US states, Canadian
provinces) cannot be modelled.

### UAE tenants on a non-AED base currency cannot enter UAE VAT mode — open

UAE VAT mode assumes the organization's base currency is AED, because returns
and tax invoices are stated in dirhams. An organization whose country is AE but
whose base currency is something else is not switched into UAE mode. Supporting
it would need a conversion of every taxable amount into AED at a rate the FTA
accepts, which is not built.

### Domestic reverse charge is not modelled — open

The UAE domestic reverse charge (gold, diamonds, hydrocarbons, and phones,
computers and tablets sold to resellers) makes the buyer account for the tax.
Only the import and cross-border reverse charge on purchases has a tax code;
these domestic supplies have none, so they must be handled by hand.

### Advance payments before an invoice create no tax point — open

In the UAE, tax becomes due when payment is received, even before an invoice is
issued. A customer payment or deposit recorded ahead of an invoice does not
create a tax point or any output tax. The tax is recognised only when the
invoice is issued.

### Records retention: five years, fifteen for real estate — open

UAE tax law requires documents to be kept for 5 years (15 years for real
estate). Nothing deletes tax documents today, but any future deletion or
archival job, including tenant offboarding, must respect that period.

---

## Documents and language

### Arabic is shaped by fontkit and ordered by bidi-js — by design

pdfkit's built-in fonts only print Latin-1, so Arabic and bilingual documents
embed IBM Plex Sans Arabic (SIL Open Font License, `apps/api/assets/fonts`).
fontkit joins the letters; it does not run the Unicode bidi algorithm, so each
line is split into runs with bidi-js and drawn in visual order. pdfkit also
splits text at spaces unless OpenType features are passed, which reverses
Arabic words, so every run is drawn with an explicit feature list. English
documents keep Helvetica, Times or Courier as before.

### Customer language wins over the template — by design

A customer's document language, when set, overrides the template's. A
customer without one gets the template's language, and a template without one
prints English. Purchase orders go to suppliers, who have no language setting,
so they follow the purchase-order template.

### Bilingual documents keep the English layout — by design

Bilingual documents print left to right, with each label as "English / Arabic"
and the Arabic name, address and line description under the English one.
Only Arabic-only documents mirror the page. Numbers stay Western digits unless
the template picks Arabic-Indic.

### Arabic is limited to customer documents — open

The app itself is still English. Arabic covers the PDFs, the template preview
and the public quote page. Emails that carry a quote link, custom fields,
product template names and notes typed in English are not translated. Supplier
records have no Arabic name or address yet, so a purchase order prints the
supplier in English. The in-app Preview / Print modal on quotes and invoices
still renders English HTML for the browser's Print / Save as PDF; its Download
PDF button gives the customer's language.

## Chat command layer

### Two planned skills were missing — resolved (2026-09-23)

The command-layer plan listed one skill per sprint. `delivery.dispatch` (S7) and
`sales_order.from_document` (S5 — a customer emails a purchase order and it
becomes a draft sales order) are now implemented with full RBAC gating, slot
extraction, preview confirmation, domain service execution, unit tests, and eval
regression cases. Both are registered in `SkillRegistry`.

### The live-provider eval reports accuracy, it does not gate — by design

Recorded answers gate CI. The live run is nightly and off the critical path,
because a model's behaviour drifting is something to know about, not something
that should block a merge.

### A file is read inside the webhook request — open

`bill.from_document` downloads the WhatsApp file and reads it with the model
before the webhook answers, as every staff command already does its routing and
extraction. A multi-page PDF can take tens of seconds. Meta redelivers a webhook
it thinks failed; the inbound row's unique message id stops the redelivery from
reading the file twice, but a slow read still holds the request open. Moving
staff commands onto a Temporal workflow, as the customer path is, would fix
both.

### Only WhatsApp files are read — open

`ChannelDriver.downloadMedia` is implemented for Meta WhatsApp. Telegram and
email deliver files differently (Telegram by `file_id`, email as MIME parts)
and still arrive as text only.

### Underscored slots are hidden from the extractor — by design

A skill can keep working state between turns in slots whose key starts with
`_` (the bill skill keeps the invoice it already read). The command layer
passes those back to the skill but never puts them in the extraction prompt:
they can be large, and they hold text from a document nobody on the staff
wrote. Slot schemas strip unknown keys, so a model cannot set them either.

---

## Customer quote link

### Proof links are minted per page load, not per token — by design

The public quote page gets a signed link for each proof file when it loads.
The link is the same short-lived attachment link staff get (minutes, not
days), and it is only minted for files a `quote_proofs` row names on the quote
the token resolved to. Other quote attachments never reach the public DTO.
The link itself is not bound to the token: anyone holding it can open that
one file until it lapses. The page refetches shortly before expiry, so a tab
left open still opens the artwork.

### The proof rule is fixed when the link is issued — by design

A quote that follows the organisation default takes the default's value when
its link is issued or it is sent. Changing the default later does not change
what a customer who already holds a link must do. Staff can still switch the
rule on the quote itself.

### A revision carries the proofs over, verdicts included — by design

Revising a quote usually changes the price, not the artwork. The revision
gets copies of the proof rows (same attachments, same versions and verdicts),
so a customer who approved v2 does not have to approve it again because the
quantity moved. Upload a new version if the artwork changed too.

### Answering a proof is allowed after acceptance — by design

Artwork is often signed off after the order is placed. Accept, decline and
request changes stop once the quote is accepted; approving or sending back a
proof does not. Expired, replaced and declined links refuse both, as before.

### The quote owner is the first person on its audit trail — open

Quotes have no owner column. Customer responses notify active holders of
quote approve or update, plus the first signed-in actor on the quote's audit
trail (or on the quote it revises). A quote created by a chat skill or a
script before auditing existed may have no such person; the permission
holders still hear about it.

### One unread bell item per quote and per proof — by design

A second response on the same quote while the first is still unread updates
that bell item rather than adding another. Every response still sends its own
email and audit row.

### Staff notes on proof uploads are API-only — open

`POST /quotes/:id/proofs` takes an optional `note` shown to the customer under
the proof. The upload button sends the file alone; a note field is deferred.

---

## Bill capture

### Capture proposes; it never saves — by design

`POST /bills/capture` and the chat skill read an invoice and return a proposed
bill. The bill is entered through `POST /bills` / `PayablesService.create`, so
the duplicate check and the three-way match are the same ones a typed bill gets,
and approval stays a person's decision. The read itself is audited as
`bill.capture` with no subject, because nothing was created.

### Bills from capture need a purchase order — open

The web form and the chat skill only enter bills against an order. An invoice
for a service with no order (rent, a repair) is read, but has to be entered by
hand. The API already accepts bills without an order; the screen that would use
it does not exist yet.

### Supplier matching is deliberately conservative — by design

A supplier is chosen only on an exact tax number or a name that matches once
legal suffixes ("LLC", "FZE", "Trading") are ignored. A near name is offered as
a candidate, never picked, because a pre-filled form is trusted. Two suppliers
whose names differ only by those suffixes are always offered as candidates.

### Attaching the invoice needs `bill:update` — by design

The original file is attached after the bill is saved, through the ordinary
attachments route, which asks for the owner record's update permission. Someone
holding only `bill:create` gets the bill but not the attachment, and is told so.

### The expense receipt scan could not read PDFs — resolved (2026-10-29)

The form sent the browser's data URL as `imageUrl`, which a provider cannot
fetch, and every file was labelled an image. The form now uploads the picked
file to `POST /finance/expenses/scan-receipt` as multipart (as base64 in JSON
it would hit the 100 KB body limit), the API sends a PDF as a document block,
and a data URL is unpacked rather than passed on as a link. The sample receipt
is an SVG, which no model reads as an image, so it is sent as its text.

### Submitting an expense with a large receipt failed — resolved (2026-10-29)

The form saved the receipt on the claim as a data URL, through the JSON body,
so any receipt over roughly 75 KB failed at the 100 KB body limit and smaller
ones were stored inline in the row. The claim is now filed first and the
receipt uploaded to `POST /finance/expenses/:id/receipt`, which stores it as an
`EXPENSE_CLAIM` attachment and sets `receiptUrl` to `attachment:<id>`. Screens
show it through a short-lived signed link. The API refuses a new data URL, and
a reference to a file that is not attached to that claim.

Attaching to a claim now needs `expense:submit`, the claim's own update
permission, rather than `finance:manage`, which the person filing the claim
usually does not hold.

### Older expense receipts are still inline — open

Claims saved before the fix keep their data URL in `receiptUrl` and still
display. Moving them into attachments is a one-off backfill nobody has run.

---

## Document generation and templates

### AI-powered universal document templates and statements — resolved (2026-09-30)

Quotes and customer statements previously lacked native printable/downloadable vector PDF generation, and document layout and styling were fragmented across document types.

This is now resolved platform-wide:
- **Universal Document Templates System**: Full multi-tenant schema, domain service (`DocumentTemplatesService`), REST API (`DocumentTemplatesController` via `DocumentTemplatesModule`), React hook (`useDocumentTemplates`), and Web UI Studio (`/settings/document-templates` and editor at `/settings/document-templates/[id]`) with live rendering, layout presets (`MODERN`, `CLASSIC`, `MINIMAL`, `ENTERPRISE`), and customizable typography/palette/section visibility.
- **Unified Vector PDF Engine**: High-performance `DocumentPdfRendererService` powered by PDFKit renders crisp, print-ready vector documents across all 5 document types: `INVOICE`, `QUOTE`, `STATEMENT`, `DELIVERY_NOTE`, and `PURCHASE_ORDER`. Automatically falls back to deterministic defaults if a custom template is absent or inactive.
- **Native PDF Downloads for Quotes & Statements**:
  - Quotes: `GET /quotes/:id/pdf` generates branded quote PDFs with itemized breakdown, discounts, totals, and notes.
  - Customer Statements: `GET /customers/:id/statement` and `GET /customers/:id/statement/pdf` provide chronological date-range ledger reconciliations, aging summaries (Current, 1-30, 31-60, 61-90, 90+), opening/closing balances, and direct vector PDF downloads.
- **AI Template Assistant**: `DocumentTemplateAiService` enables natural-language generation and contextual refinement of template configuration, color palettes, and section layouts via OpenAI and Anthropic providers, backed by Zod schema validation and graceful fallback.

---

## In-app assistant

Each assistant turn runs `agentReActWorkflow` on `assistant-queue` and streams
its steps over SSE from `assistant_messages`. Deferred work:

### No token streaming — open

The final answer arrives whole, once the model has finished it. Step rows
stream as they are written, but the text of a single model response does not.
Closing it means emitting deltas from the provider adapter and an additional
row kind for partial text, so a reconnect can replay them.

### No attachments — open

The assistant accepts text only. Attachments are not sent to the model, and
conversations have no owner mapping in `modules/storage/attachment-owners.ts`.

### Contact resolution does not search by phone — open

Contact resolution in the assistant does not use phone numbers as a search key.

### Customer messages always need approval; channel skills are assistant-only — by design

`channel_message.send` always waits for an explicit Approve: it is in
`ToolExecutionPolicyService.ALWAYS_REQUIRE_APPROVAL`, and the workflow ignores
`autoApprove` for it. Both channel skills (`channel_thread.read`,
`channel_message.send`) declare `surfaces: ['assistant']`, so the staff chat
bot and automation AI nodes are never offered them.

An approval is bound to the tool call it was shown for (`toolCallId` in the
request, `toolId` in the signal), and the send is pinned at preview time
(contact id, provider, recipient, body). Before sending, the commit recomputes
the preview and refuses with "This action changed since you approved it — ask
again." if it differs.

### Customer agents send their own replies without approval — by design

The rule above is about the assistant's `channel_message.send` tool and still
holds. Agents set up under Settings › AI › Agents are a separate path: a
customer agent's reply goes to the customer as written by the model, with
nobody approving it first. That was the product owner's choice when agents
were added.

What bounds it: a customer agent can only look up a price or stock with the
opt-in tools below, and its fixed guardrails (`channel-agent-runner.ts`) tell
it never to state one that is not in its instructions, the conversation or a
tool result. Its tools are passing the
conversation to another agent, handing it to a person, `draft_quote`, which
raises an AI-mode draft that staff approve as before, and the two lookups
below. An organisation with no agents behaves exactly as it did.

Staff agents narrow which chat skills a command is routed among; they never
widen what the person's permissions allow, and the YES confirmation is
unchanged. A follow-up answer and a file sent without a caption are read with
the "Chat commands" model rather than the agent's own.

Not verified against a live provider or a live channel: the agent runner,
routing and workflow branch are covered by unit tests with a mocked AI
service. The lookups were also run locally through the webhook, Temporal and
the worker against a real database, with a scripted stand-in for the model
and for Meta's send API.

### Customer agents answer list prices and stock for anyone — by design

`check_price` and `check_stock` are opt-in per agent, like the lookups below,
but they do not need a verified sender: they read only the business's own
public facts, never a quote, an order or a customer. `CatalogLookupService`
returns, for active items in the organisation:

- prices: name, SKU, unit, list price, VAT rate and lead time, and only for
  catalogue items the owner ticked "Customers may be told this price"
  (`catalog_items.show_price_to_customers`, off for every existing item).
  Never the standard cost, a margin, a recipe price or a customer's quoted price.
- stock: in stock, running low or out of stock, from the stock records of the
  material (or of the material a catalogue item is drawn from), summed over
  locations as on hand minus reserved. "Running low" means at or under the
  summed reorder point; an item with no reorder point is in stock until it is
  out. A number only when the agent's "Also say how many are available" is on
  (`channel_agents.showStockQuantity`, off by default). Nothing with no stock
  record is answered: the tool says "not tracked" and the agent hands over.

The match is a plain word search on name and SKU, at most five results. A
price for a size or quantity the catalogue does not list (most made-to-order
work) is not worked out: the guardrails send that to a person or a quote.
Only covered by unit tests with a scripted model; not run against a live model.

### Customer agents answer order and quote questions for a verified sender only — by design

`check_order_status` and `check_quote_status` are opt-in per agent. They take
no customer from the model: `CustomerSenderService.resolve` works out the
customer from the channel's own sender, and `CustomerLookupService` filters
every query by that customer id. A number the sender types is matched inside
their own rows afterwards, so "not yours" and "does not exist" are the same
answer.

A sender is a customer in two ways, both resting on something staff entered:

- staff linked that exact sender in the Inbox (`customer_channel_senders`,
  needs `customer:update`), or
- the WhatsApp number, or the email address, is the phone or email on exactly
  one customer record. A number on two records names neither. A number typed
  without a country code is read in the customer's country, else the
  organisation's, and not at all when neither is set (`sender-identity.ts`).

Telegram and Slack senders have no number or address, so they need a link. A
Telegram group, a `Name <address>` pair and an address list are never a
customer, because a reply there reaches more than one party. Anyone else gets
one fixed refusal and the agent hands over.

What it shows: status, lines with quantity delivered, the latest work-order
due date, dispatched deliveries, amount paid and balance due; for quotes,
status, and the total only once approved. Never notes, costs or unit prices.

Known limits:

- **Inbound webhooks for WhatsApp, Telegram and email are not signature
  checked** (only Slack is). Anyone who knows an organisation's id can post a
  message "from" any number. That does not leak: the reply is sent to the
  number or address itself, never to the caller. It can make the business
  send an unasked-for status message to a real customer and spend AI calls.
  Closing it means verifying `X-Hub-Signature-256` with the Meta app secret,
  which is not stored today.
- **Changing the phone or email on a customer record changes who is
  verified**, so `customer:update` is the permission that matters.
- **Reading is logged, not audited.** The worker logs agent, customer and
  tool; no `audit_logs` row is written for a lookup.
- **No self-service verification.** A customer writing from an unknown number
  waits for staff to link it. A one-time code to the address on file is the
  obvious next step.
- The model is told to state only what the tool returned; nothing checks its
  wording against the tool result.

### Stop does not stop a send that is already running — open

Stop marks the turn `CANCELLED` and cancels the workflow, but the commit
activity does not heartbeat and is cancelled with the default `TRY_CANCEL`, so
an approved `channel_message.send` that has already started still goes out.
Its `tool_result` row is then dropped, because `emit()` ignores finished turns,
and the transcript shows "Stopped." even though the message was delivered (the
audit row is still written). The window is the second or two a send takes.
Closing it means running the commit in a non-cancellable scope, recording its
result, and only then settling the turn as cancelled.

### Stream rows can be skipped if seq commits out of order — open

The SSE cursor assumes `assistant_messages.seq` becomes visible in order. A
`BIGSERIAL` is assigned at insert, not at commit, so two overlapping writes to
one conversation (Stop racing a new message) can expose seq `b` before `a < b`;
the stream then never pushes `a` until the page reloads. Serialising writes per
conversation (the turn row lock already does this within a turn) or re-reading
a short window behind the cursor would close it.

### Each open stream polls every 5 seconds — open

The SSE stream does not close when a turn finishes: it stays open until the
client disconnects, with a 15s heartbeat and a 5s database poll as a fallback
to Redis pub/sub. Every open panel or tab therefore costs one small query
every five seconds. Closing idle streams (or polling only while a turn is
active) is deferred.

### Stale-turn threshold is 7 minutes — by design

A `RUNNING` turn with no event for 7 minutes is failed by the sweep. The
commit activity may run for up to 5 minutes with nothing to emit (a
"Running <tool>" step is written just before it), so the threshold sits
above that.

### The assistant module runs in the worker too — by design

The worker loads the assistant module, so the stale-turn sweep cron
(`AssistantSweepService`, every minute) is registered there as well and is
inert in that process by design.

### The planner uses native tool calling and replays raw turns — by design

`planReActTurn` calls `AiService.generateWithTools`: the skills are sent as the
provider's own tools, and the history is real tool calls followed by tool
results matched by id. Each assistant turn is stored in workflow history twice,
as tool calls and as the provider's raw content (`AgentHistoryEntry.raw`). The
raw copy is replayed unchanged to the same provider, because Anthropic rejects
a conversation whose thinking blocks were dropped or edited. Another provider,
or a turn whose ids the planner had to rewrite, is rebuilt from the calls.
Planner requests set `cache: true` (Anthropic `cache_control`). Cache reads and
writes are logged on `ai_usage_logs` and costed at 0.1× and 1.25× the input
rate.

Turns still waiting for approval when this ships replay into the new code
safely: their recorded planner results have no `raw`, so they are rebuilt.

### Structured output differs by provider — by design

Anthropic uses `output_config.format` (JSON schema). The current models
(Opus 5.5, Sonnet 5.5, Fable 5.1) reject a forced `tool_choice`, which is what
this used to rely on. OpenAI-compatible providers still force a function call,
because OpenRouter models support function calling more widely than
`response_format: json_schema`. Both now refuse a cut-off (`max_tokens` /
`length`) or declined (`refusal` / `content_filter`) response rather than
return partial JSON.

The Anthropic output cap without an explicit `maxTokens` rose from 4096 to
16,000. Budget reservation reserves against the provider's own default, so an
Anthropic call now reserves about four times the output it used to. Actual
usage still reconciles it.

### Native tool calling not verified against a live provider — open

The provider changes are covered by mocked tests only. No API key was available
when they were written. Before relying on them, run one assistant turn that
calls a tool, and one structured-output feature (for example receipt scan), on
Anthropic and on OpenAI. Then confirm that `cacheReadInputTokens` is non-zero
from the second planner round onwards. If it stays at zero, the cached prefix
is probably below the model's minimum length.

### Raw assistant turns are stored twice per planner round — open

`planReActTurn` receives the whole conversation history as activity input,
including every earlier turn's `raw` provider content (thinking signatures and
tool-use blocks), and returns the new turn's `raw` in its output. Temporal
therefore records each raw turn once in the output that produced it and again
in the input of every later round, so event-history size grows with the square
of the round count. Fine at the current round cap; if long turns start hitting
Temporal's payload limits, persist raw turns once (keyed by tool-call id, or on
the `assistant_messages` row) and send only the last one to the planner.

### Not yet verified against a live stack — open

The first version was checked with the automated suites only. No database,
Redis, Temporal or Docker was available when it was written. Still to do on a
running stack:

- **Migration and drift:** `pnpm migration:run && pnpm migration:generate Probe`
  must report no changes, and `pnpm check:drift` must pass against the
  baseline.
- **Worker pickup:** the Temporal worker picks up jobs on `assistant-queue`.
- **SSE end to end:** the stream delivers, replays from `seq`, and stays
  open (heartbeat 15s, poll 5s) after the turn finishes.
- **Manual E2E, seeded data:**
  1. Ctrl/⌘J on a contact page shows that contact as the context chip.
  2. "Show me this contact's last messages and draft a follow-up" returns step
     rows for the thread read and a drafted message.
  3. "Send it" produces an approval card with recipient, provider and full text.
  4. The same conversation in a second tab shows the same card.
  5. Approving in both tabs quickly: one succeeds, the other shows the "no
     longer waiting for approval" toast, and one outbound row appears.
  6. The audit log holds `channel_message.send.executed`, `AI_ASSISTED`,
     `ASSISTANT` and a non-null message id.
  7. Toggling the browser offline for 5s mid-turn catches up with no duplicates.
  8. With the worker stopped, a turn left for seven minutes shows "Couldn't
     finish: The assistant stopped responding". A member without
     `channel:send` is told it cannot send, and no approval card appears.

---

## Overheads and recurring bills

What overheads posting and recurring bills leave out, and the choices behind it.

- **Budget actuals are still manual — open.** `CategoryBudget.spentAmount` is
  typed in; posted bills do not feed it. Wiring it up means deciding which
  accounts roll into which budget category.
- **Spreading splits by whole months — by design.** A prepaid bill is cut into
  equal monthly slices with no day proration. Proration needs a rule people
  agree on (actual days, 30/360) and none was asked for.
- **No billing in arrears — open.** The service period cannot precede the bill
  date, so a utility bill like DEWA, which covers last month, is booked when it
  arrives, not when it was incurred.
- **No assistant skill for recurring expenses — open.** Changes made through
  the web app only; a chat skill would have to call `AuditService.record`
  itself.
- **Chart-of-accounts editor — resolved (2026-10-26), with one gap open.**
  Tenants add, rename, re-parent, retire and delete their own accounts under
  Finance → Chart of Accounts. Documents still post by role, so an expense
  category on a bill or a claim cannot yet be pointed at a tenant's own
  account; those accounts are reached through manual journals.
- **Journal lines posted to 6000 before this change were not re-routed — by
  design.** Restating history into the new accounts would rewrite closed
  periods.
- **The subscription form has no payment-account picker — by design.** The
  account money leaves from is chosen when the generated bill is paid. The old
  `financeAccountId` column is kept, unused by new rows.
- **A period claimed by a run that crashed stays `FAILED / in progress` — open.**
  It is not retried automatically, because retrying could bill twice; it can
  never double-bill. Finance managers are notified after 1 hour. If the bill
  was already created, recover by setting the occurrence to status `'GENERATED'`
  with its `billId`. If it was not, `UPDATE recurring_expense_occurrences SET
  error = 'stale' WHERE id = …` lets the next run retry.
- **Existing recurring rows are not back-billed — by design.** The migration
  keeps each row's start date as its anchor and moves `nextBillingDate` to the
  first occurrence on or after the migration date (UTC). Earlier periods were
  paid and booked another way; anyone wanting them as bills enters them by
  hand.
- **Auto-approve runs as the user who enabled it — by design.** If they lose
  `bill:approve`, bills stay draft and finance managers are notified.
- **Recurring amounts are net of tax — by design.** Each generated bill adds
  tax from the schedule's purchase code, else the supplier's (none for
  reverse-charge, exempt or zero-rated codes), as a hand-entered bill would.
  Rows created before this change are treated as net too, so a row whose
  amount was typed gross now gets tax on top: check existing schedules for
  taxable suppliers. The cash forecast projects the same tax.
- **With auto-approve on, only a holder of `bill:approve` can change amount,
  supplier, tax code, category, spreading, interval, start or end date.** Otherwise anyone who can edit a
  schedule could push a different bill through someone else's approval.
- **The cash forecast converts draft bills at their stored rate — open.** That
  rate is 1 until approval, so foreign-currency drafts are mis-stated.
- **The forecast's opening balance sums cash accounts without currency
  conversion — open.** Same as the existing overview.
- **Audit action names for `/finance` routes come from the first URL segment —
  by design.** `finance.create`, `finance.pause` and so on; the subject type
  says which record.
- **Balance sheet sections now nest child accounts — by design.** It is a
  shared component, so the P&L and the balance sheet render hierarchy alike.
- **The seed checks its annual lease — resolved.** The billing job logs and
  skips per-row failures, so the seed asserts afterwards that the lease made
  one approved bill, one prepaid schedule and one release per elapsed month,
  and fails otherwise.
- **Expense claims are still not FX-converted** — see "Money and currency".

---

## Employees and payroll

What payroll leaves for compliance and job costing, and the choices behind it.

- **GPSSA pension is modelled — see [UAE payroll compliance](#uae-payroll-compliance).**
  Its presets and remaining gaps are listed there.
- **WPS, leave and final settlement are modelled — see [UAE payroll compliance](#uae-payroll-compliance).**
  Their trade-offs are listed there.
- **Gratuity accrues from day one — by design.** Nothing is payable before one
  year of service, but the final settlement applies eligibility, so accruing from
  the start avoids a catch-up entry.
- **The package in effect on the last day of the month applies to the whole
  month — by design.** No split-month proration of raises.
- **Off-cycle (bonus-only) runs are not supported — open.** One run per month.
- **Payroll is base-currency only — by design.** Paying from a foreign-currency
  account is refused, because payroll is not FX-converted.
- **Payslips are printable pages — open.** No emailing or server-side PDF.
- **The forecast projects payroll as gross on the 28th for months without a
  run — by design.** It is an estimate; a real run replaces it.
- **`PAYROLL_DATA_KEY` must be set in production.** Losing it makes stored
  IBANs unreadable; they have to be re-entered.
- **The opening gratuity cut-over blocks runs for months it already covers — by
  design.** Otherwise those months would accrue gratuity twice.
- **Payroll runs post in month order — by design.** Approving or voiding a
  month is refused while a later month is posted, because each month's
  gratuity true-up builds on the balance the earlier months left. To correct an
  old month, void the later unpaid runs and re-approve in order; once a later
  run is paid (paid runs cannot be voided), post a gratuity adjustment instead,
  which persists as an offset (next bullet).
- **Gratuity adjustments and opening overrides persist as an offset above the
  statutory amount — by design.** Each approval trues the provision up to the
  statutory entitlement plus the sum of the employee's ADJUSTMENT rows, so a
  correction or contractual extra survives later runs instead of being clawed
  back. An opening balance typed above or below the calculated figure is booked
  as OPENING (calculated) plus an "Opening override" ADJUSTMENT for the
  difference; the journal is the same. The flip side: an adjustment is
  permanent until a counter-adjustment is posted.
- **Opening gratuity is refused for employees already accrued by a posted run
  — by design.** That run already trued them up to their full entitlement, so
  an opening would count past service twice. They are left out of the preview,
  posting them is a 409, and the "set up opening balances" prompt disappears
  once any run is posted. Consequence: a tenant that runs payroll before
  setting up openings books those employees' past service as gratuity expense
  in that first run, not against opening balance equity.
- **Leavers are paid for their final month — by design.** A LEFT employee is
  on the run for any month with days employed up to the leaving date (prorated),
  and that run's approval is their last gratuity true-up. The forecast still
  projects only ACTIVE employees.
- **Draft runs can be deleted — by design.** `DELETE /payroll-runs/:id`
  (payroll:manage) removes a draft and its lines; drafts post nothing, so a
  stuck draft no longer blocks its month or inflates the forecast. Approved
  runs are voided instead.
- **Paying a method with no payees is refused — by design.** A run becomes
  PAID once every existing line is paid.
- **Approval re-checks every line — by design.** Net pay >= 0, unpaid leave <=
  days employed, and advance recovery <= outstanding across drafts, because
  refresh keeps stale extras.
- **Gratuity for leavers is computed to the leaving date — by design.**
  Service stops at the leaving date, but unpaid leave recorded on the final
  month's run (which ends after it) still reduces it.
- **No database index yet on `employee_advances(tenant, employee)` or
  `payroll_runs(tenant)` — open.** Fine at SME volumes.

---

## UAE payroll compliance

The trade-offs behind the GPSSA pension, WPS, leave and final settlement.

- **Leave is in calendar days — open.** Public holidays and working-day counting
  are not modelled, so a leave period is counted straight through weekends and
  holidays.
- **Leave records are entered by HR — open.** There is no employee self-service
  or approval workflow.
- **Annual leave carries forward without expiry or cap — open.** Balances only
  grow until they are paid out or settled.
- **Leave records lock once their month's run is posted — by design.** Void the
  run to change them; otherwise a posted month's leave would no longer match its
  pay.
- **Once an employee's settlement is approved or paid, all their leave records
  are locked — by design.** Void the settlement to correct one.
- **Leave-record attachments (e.g. medical certificates) need `employee:manage`
  to view, not `employee:read` — by design.** Medical documents are sensitive, so
  managers who can read the employee cannot open the certificate.
- **Sick leave beyond 90 days in a service year is refused — by design.** The
  employee has run out of paid and half-paid sick leave; record them as having
  left rather than extending the year.
- **Opening leave is not blocked by runs posted before this release — by
  design.** Those runs carry no leave rows, so nothing is double-counted. It is
  refused per employee once a run has accrued their leave.
- **Approving a run before opening leave balances are posted accrues each
  employee's statutory leave since joining as untaken in that run — by
  design.** Opening leave is then refused for them; correct the balance with a
  leave adjustment. Gratuity behaves the same way.
- **Pension presets start inactive — by design.** They must be confirmed against
  the fund's current rates before use.
- **The government's 2.5% GPSSA top-up is not modelled — open.**
- **GCC nationals need a custom pension scheme — open.** No preset covers them.
- **Approval applies each national's current active scheme — by design.** A
  national without one blocks approval, so no run posts with a missing
  contribution.
- **A run cannot be voided while its month's pension is remitted or a leaver on
  it is settled — by design.** The remittance or settlement would otherwise
  point at a voided run.
- **Settlement needs the leaver's final month posted — by design.** The final
  pay and gratuity must be in the ledger before the settlement can be built on
  them.
- **A settlement with negative net is refused — by design.** The employee owes
  the company more than the settlement pays; recover that amount outside payroll.
- **A paid settlement cannot be voided — by design.** Money has left the bank;
  a correction is a new entry, not a reversal of the payment.
- **A settled employee's status, joining and leaving dates are locked — by
  design.** Void an approved settlement to change them; a paid one cannot be
  voided, so a rehire is added as a new employee. A draft run that still
  carries a settled employee, or whose dates have changed, is refused until it
  is refreshed.
- **WPS files follow the standard MOHRE SIF layout — by design.** Agent-specific
  variants are not produced — open.
- **WPS is AED base currency only, and cash-paid employees are left out with a
  warning — by design.** WPS only covers bank transfers, and the SIF is in AED.
- **WPS fields left on a tenant with WPS switched off are kept if valid; an
  invalid hidden value is cleared on save — by design.** Turning WPS back on
  then does not start from broken data.
- **The SIF is returned to the browser and never stored; the export is audited —
  by design.** A stored file would be a second copy of bank details to protect.

---

## Job costing

What job costing leaves out or defers, and the choices behind it. Labour is
costed from payroll and timesheets; machine time and overhead are not posted.

- **Labour reaches jobs monthly, when payroll is approved — by design.** Until
  then a job's labour is provisional, at an estimated rate: package plus
  statutory on-costs divided by standard hours. Posting waits for the run
  because the real cost is not known before it.
- **Cost per hour divides by the larger of standard and logged hours — by
  design.** Absorbed labour therefore never exceeds payroll cost. Unrecorded
  overtime lowers the rate instead of over-absorbing.
- **Labour absorption posts as its own journal, `JE-<run>-LAB`, in the approval
  transaction — by design.** A void posts a separate `-LAB-VOID` journal that
  reverses each amount against where it sits now: WIP, COGS, or nothing if a
  cancellation already returned it to overhead. Two entries instead of one on
  void keeps the original reversal untouched.
- **Labour reaches cost of sales no earlier than the job completes — by
  design.** `JE-<run>-LAB` is dated the period end. Labour on a job completed
  on or before that day is debited to COGS directly. Labour on a job completed
  after it goes to WIP, and a `JE-<run>-LAB-DONE-<job>` journal, dated
  max(period end, completion day), moves it to COGS. That keeps next month's
  job cost out of this month's P&L, at the price of one extra journal per
  late-completing job. A void reverses that labour from COGS, dated no
  earlier than the latest of those journals.
- **Hours on cancelled jobs are not charged — by design.** Labour already
  absorbed into a job that is later cancelled returns to 6390 (overhead).
- **Machine time and the template overhead % stay management figures in
  `actualCost`; they are not posted — by design.** Neither has a cost the
  ledger can name, so posting them would invent expense.
- **Clock entries are dated in UTC — open.** There is no tenant time zone yet,
  so a session that starts between 00:00 and 04:00 in the UAE (UTC+4) is dated
  the previous day. Closing it needs a tenant time zone.
- **The clock never fails because of timesheets — by design.** When an entry
  cannot be written (posted month, outside employment, over 24 hours) the
  minutes still count, as unlinked, at the work centre's standard rate.
- **Entries lock with the employee's posted run line — by design.** An employee
  left off a run (on hold) keeps editable, provisional hours for that month.
- **Jobs completed before job costing keep their standard-rate labour — by
  design.** They are status STANDARD and are not re-costed.
- **Work order lists return `labour: null` — open.** The labour breakdown is
  computed on the detail view only, because it is a per-employee, per-month
  calculation too heavy for a list.
- **Timesheet approval workflow, employee self-entry and non-work-order jobs are
  not supported — open.** Hours are entered by a manager or a clock, and only
  work orders take labour.
- **Every labour writer takes the per-tenant `job-costing` advisory lock — by
  design.** It serialises posting against the floor. Fine at SME volumes; a
  contention point for very busy floors.
- **Per-employee rates and amounts on a job's labour panel need both
  `quote:view_cost` and `payroll:read` — by design.** Amounts per person reveal
  pay. Job totals need `quote:view_cost` alone, so a payroll-only user would
  otherwise see per-person amounts that do not add up to a total they cannot
  see.
- **A payroll line whose direct hours could not be charged is flagged
  `LABOUR_NOT_ABSORBED` — by design.** That is a line with direct hours whose
  cost is ≤ 0 or whose hours sit on a cancelled job. The flag tells finance
  the cost did not reach a job, rather than leaving the gap silent.
- **Changing a package or the monthly standard hours does not re-cost
  completed jobs still carrying provisional hours until something touches
  them — open.** Their provisional labour is recomputed when an entry on them
  is edited or the month's payroll is approved; until then it shows the rate
  in force when last computed.
- **Deleting or editing a clock-created entry can leave up to 0.3 minutes of
  rounding — by design.** Entries store hours to two decimal places, so the
  minutes a clock session recorded do not always convert back exactly. The
  residue is below the precision of anything that reads it.

### Costing accuracy (self-correcting costing)

`GET /catalog/costing-review` compares completed jobs' estimates with their
actuals and proposes catalog corrections; the Catalog screen's "Costing
accuracy" tab shows them. Built on `reviewCosting` in `@saas/shared`.

- **It proposes; a person applies — by design.** Each proposal names one
  field, and applying it is the ordinary catalog update, permissioned and
  audited like any edit. Quotes already made and jobs already planned keep
  the figures they were made with.
- **Three rates are reviewed: material cost, material waste, and a work
  centre's time allowance (`scrapPct`) — by design.** Those are what a job
  measures. Hourly machine and labour rates are not: machine time has no
  actual cost to compare with, and labour reaches jobs from payroll per
  person, not per work centre. Template run-time formulas are not edited
  either; when a work centre with no allowance runs faster than its
  templates, the review says so as a note.
- **Waste and time are measured against what each job was planned with —
  by design.** Work orders record the waste and time allowances in their plan
  (`planned_waste_pct`, `planned_scrap_pct`, migration
  1791000000000-CostingPlanBaseline). Measuring against today's catalog would
  make an applied correction propose itself again.
- **Jobs planned before the baseline was recorded only count for prices —
  open.** Their allowances are unknown, so the waste and time review starts
  with work orders created after the migration.
- **Evidence thresholds — by design.** A proposal needs three distinct jobs,
  and a gap of 3% on price, 2 points on waste or 5 points on time. Proposals
  are capped at what the catalog accepts (waste below 95%, time allowance up
  to 100%) and say when they were. Sheet materials are planned in whole
  sheets, so their measured waste reads a little low.

### Partial updates wrote schema defaults over saved values — resolved for the catalog, open elsewhere

Found while building costing accuracy. In zod 4 a field with `.default()`
still produces its default inside `.partial()`, and services apply patches
with `Object.assign`, so `PATCH /catalog/work-centers/:id { scrapPct }` reset
the centre's hourly rates to 0. The catalog's update schemas (materials, work
centres, tooling, products) now use `patchOf`, which drops defaults. The
screens send every field, which is why nobody saw it.

The same pattern is still in `updateContactSchema`, `updateSavedViewSchema`,
the custom-object, AI-agent and payroll update schemas. Each needs checking
for defaulted fields and moving to `patchOf`.

### Starter templates — by design, with follow-ups open

A new tenant can install a worked costing model from Catalog → Templates →
*Start from an industry template*: rigid box and RSC carton (packaging), label
run (print), acrylic letter sign (signage), laser-cut and bent sheet-metal part
(fabrication) and cabinet carcass (joinery). The library lives in
`packages/shared/src/costing/templates/starters/` and each one is costed by the
same engine in its tests, so the example price in the picker is real.

Every rate in it is a placeholder: AED figures shaped like a small UAE shop,
not anyone's actual costs. The picker and the editor both say so. Nothing
stops a shop quoting from them unchanged; the costing-accuracy review is what
catches it after a few jobs.

Installing matches materials by SKU, then by name in the same unit, and work
centres and tooling by name, case-insensitively, preferring an active row over
an archived one. A match is reused as it is, so a shop's own rates win
over the placeholders, but it also means a same-named centre with a different
meaning (say, a "Laminator" that is a pouch laminator) is silently reused.
Installing the same starter twice gives a second template (`rsc-carton-2`)
rather than a new version of one the shop may have edited.

The quote configurator used to draw a rigid-box flat blank for any template
with length, width and height. It now draws one only when the template's
`blankPreview` is `RIGID_BOX`, set in the template editor. The migration turns
it on for existing templates that have all three dimensions, so nothing
changes for them; a sign or cabinet built before this needs it switched off by
hand.

Not done: the optional "Set up your first quote" card on the dashboard, a
preview of what will be created versus reused before installing, and a
blank drawing for the RSC carton (it would need a second net kind).

---

## Quick costing on typed lines

A typed, one-off line can be costed without a template: materials from the
catalog, hours on each machine or work centre, bought-in items and an
overhead %. The cost is stored on the quote line as source `QUICK`, with the
inputs in `quickCost`.

- **Materials and hours are costed on the server, at catalog rates, every
  save — by design.** The browser sends ids, amounts and hours; a material
  that is later removed leaves the line uncosted ("Costing needs checking"),
  with the inputs kept. The rate used is today's catalog rate, so re-saving an
  old quote re-costs it at current rates, as template lines already do.
- **Bought-in amounts are taken as typed — by design.** They are the one cost
  figure a person enters. They can only add cost, so they make the margin
  floor harder to clear, never easier.
- **Each hours and bought-in row is "each piece" or "whole job"; only
  per-piece rows grow with the quantity.** Hours default to each piece,
  bought-in to whole job (a delivery, an installer's day). Costings saved
  before the choice existed read with those defaults. Materials are entered
  for the whole line and still scale with the quantity — there is no fixed
  material allowance. A work centre's minimum charge applies to the line's
  total hours on it.
- **Overhead starts at 0% — open.** There is no shop-wide overhead rate on
  master yet. When there is, return it from
  `CostingService.quickCostDefaultOverheadPct`; the editor pre-fills it.
- **The suggested price aims for the costing policy's margin floor
  (`minMarginPct`), even when enforcement is off.** There is no separate
  target margin setting.
- **A quick-costed line still cannot go into production — by design for now.**
  It has no template, so no routing and no work order. The hours per work
  centre are enough to create work orders later (one operation per hours
  row, planned minutes = hours × 60), which would also give actual-versus-
  quoted per line. Not built.
- **In the margins report by template, quick-costed lines share one row,
  "One-off jobs (quick costing)".** Typed lines with no costing are still left
  out of that view, as before.
- **Without `quote:view_cost`, quote responses carry no line `cost` or
  `quickCost`, and the guardrail preview shows no cost or margin figures.**
  Saving a quote as such a person keeps each line's stored quick costing (by
  line id) and re-costs it on the server, so they can change the price, words
  or quantity without wiping it. They cannot add or change a costing.

---

## Smaller things found on the way

- **A malformed quote body returns 500, not 400.** `POST /quotes` with a badly
  typed body (`items` as a string) escapes the validation pipe as a server
  error. Pre-existing, unrelated to any sprint.
- **Invoice payment journal numbers use an older format.**
  `JE-INV-2026-6214042` — a year plus a timestamp fragment, from
  `finance.service` — unlike the document-numbered entries everywhere else.
- **The low-stock notification does not name the material.** It reads "Stock is
  at or below its reorder point (2692 on hand)", so the bell is less useful than
  it could be.
- **The catalog has no UI or API for the stock-material link.** The field exists
  and drives inventory movements, but can only be set directly in the database.

---

## WhatsApp sends from documents

### "Send on WhatsApp" falls back to the staff member's own WhatsApp — by design

Quotes, artwork proofs and invoices have "Send on WhatsApp" next to the email
action, with the same permission (`quote:update`, `invoice:manage`); sending
through the business number also needs `channel:send`. The business number
sends when it can: free text if the customer wrote to it in the last 24 hours,
otherwise the approved template named in the WhatsApp channel settings (two
body blanks: what is being sent, then the link). With no channel, no template
outside the window, no `channel:send`, or Meta refusing the send, the screen
says so and offers a wa.me link that opens WhatsApp on the staff member's own
phone or computer with the message filled in.

- A business-number send, sent or failed, is a message in the customer's Inbox
  thread; a template send to someone who never wrote starts the thread. A
  click-to-chat message goes from a personal number Kerf cannot see, so it is
  not in the Inbox and the quote or invoice is not marked sent.
- The proof goes out as the quote link: that is where the customer sees and
  approves the proof, so a new link is made, as "Copy link" does, and an
  earlier one stops working.
- An invoice message carries the pay link only when online payments are on
  for invoices. Without them it gives the number, amount and due date and no
  link; the PDF still goes by email.
- The quote's Activity shows "Sent or opened on WhatsApp" for every press:
  the record is written per button press, before Kerf knows whether the
  staff member went on to press "Open WhatsApp". The Inbox shows what the
  business number actually sent.
- When Meta rejects a send, staff see a plain reason; Meta's own error text
  stays in the server log and on the failed Inbox message, since it can
  repeat back part of the credentials.
- Automations' "send to customer" step on WhatsApp now also refuses when the
  customer's last message is over 24 hours old, instead of letting Meta reject
  it. It still has no template option.
- The template is one per channel and its name is not checked against Meta
  until the first send; a wrong name shows as a refused send and the
  click-to-chat fallback.

## Automations

### Automation chat messages to customers: written text only, and only to someone who wrote first — by design

The Send Message step (WhatsApp, Telegram, Slack) follows the rule above for
customer contact. The assistant's `channel_message.send` needs a person's
approval for each message; an automation has nobody to ask, so the step is
narrower instead:

- Text that comes from an AI step is never sent to a customer on a chat
  channel. No setting unlocks this (the AI-email-to-customers setting is for
  email only). Send it to staff, or write the message in the step.
- A customer can be messaged only at an address that has already messaged the
  organisation on that channel. That is the one address known to be theirs, and
  on WhatsApp the only one ordinary text is delivered to. Everyone else gets
  Send Email. The ready-made recipes therefore email customers; none uses chat.
- Staff are reached at the chat they linked themselves (or a Slack channel id);
  an unlinked colleague fails the step with a message naming them.

Every send is audited as `automation.message.send`, made as the automation's
owner, and needs that owner to hold `channel:send`.

### Shop events are published best-effort, and one path publishes none

`ShopEventsService` publishes the order, job, proof, payment, purchasing,
stock, expense and message events inside a savepoint: if the event cannot be
written, the business change still commits and the automation does not start.
An order created by the Temporal quote workflow's `generateInvoiceActivity`
(not by a customer accepting through the link, which goes through
`InvoicesService.createFromQuote`) publishes no `sales_order.created`: that
activity runs outside Nest and has no event bus. `stock.low` fires when an item
crosses its minimum, not on every movement below it. `purchase_order.received`
fires on full receipt only, not on close-short. The event payload carries the
customer's name, email and phone, so anyone who may edit automations can read
them in a run, as with every other trigger payload.

### The morning summary counts in UTC days

"Due today", "late" and "paid yesterday" in the Kerf Record step's daily
summary use UTC day boundaries, four hours behind UAE midnight. The 8:00
schedule itself is in the automation's own time zone.

### No automation chaining — by design, this round

Changes made by an automation step (an Update CRM record step, for instance)
never start other automations. Chaining invites loops; revisit it with an
explicit depth limit.

### The automation AI agent step acts as the triggering user when there is one, otherwise the owner — by design

The agent step runs as the user who triggered the run (a test run, or the
person behind a CRM event); its tool access follows that user's permissions.
When no one triggered the run (a webhook or a schedule), it acts as the
automation's owner, the user who switched it on. Webhook runs never
auto-approve agent tools, whatever the step's setting: anyone holding the
address can start one, so a person approves each tool call.

### An AI agent step can run as an agent from Settings › AI — by design

The step may name a staff agent (`config.agentId`). The run then plans with
that agent's instructions, after the fixed system prompt, and with its provider
and model when it has them. The agent's tool list only narrows what the run's
user may use: the tools are those the user is permitted on the automation
surface that the agent also lists. Custom-object tools are left out for a named
agent, because an agent cannot be given them in Settings. Customer agents
cannot be picked, and a step naming one fails: they are built for someone
outside the organisation. A step that names an agent ignores its `allowedDomains`,
so the agent's tool list is the only narrowing.

A step with no task, or naming an agent that is deleted or switched off, stops
the automation being switched on (`AutomationsService.updateWorkflow`), and the
run checks again: an agent deleted after activation fails the step with
`AgentUnavailable`, without retries. A draft can still be saved unfinished.

The step's output gains `actions`: one row per tool the agent used, with its
outcome and whether it changed a record. Runs recorded before this have no
`actions` and the run history shows them as before. The list holds what the
agent did, not its reasoning between tools.

Not verified against a live provider: the agent's instructions, model and tool
narrowing are covered by unit tests of the activities and the workflow.

### Runs stopped from outside the workflow stay Running — open

A run that is terminated, that times out, or that is stuck on a workflow-task
error never records its end, so its row stays Running. There is no cleanup job
yet to close such rows. Their pending approvals stay in the Approvals inbox and
count towards the nav badge until someone tries to decide one; that attempt
finds the run gone and closes the item as "No longer pending".

### A decision whose delivery times out is released, even if it arrived — open

Deciding an approval claims the row, then signals the run. If the signal call
fails without a clear answer (a client timeout where Temporal in fact accepted
the signal), the claim is released and the person is told to try again. The
run still acts on the decision, and the step's output records the real
approver; only the approval row ends Cancelled rather than Approved or
Rejected (when the step records its result, or at the latest when the run
finishes).

### Run payloads are visible only to automation editors — by design

Anyone with the read-automations permission sees the run list and each run's
steps: label, type, status, timing and error. A run's trigger payload, step
inputs and outputs, and the details of its pending approvals can hold
customer data, so the run view shows them only to holders of the
edit-automations permission. The API also returns a pending approval's
details to approvers, but the run view's approval card shows only the step
name — approvers read the details (the step's message, or the AI action and
its preview) in the Approvals inbox. Showing them in the run view is pending.

### Nobody is told when something needs approval — resolved (2026-11-17)

Quotes waiting for approval, automation approval steps and AI steps now tell
the people who can approve them: holders of the matching permission
(`quote:approve`, plus `quote:approve_below_margin` when the margin floor or
discount cap is broken; `automation:approve`), never the requester. Each
person gets the bell (linking to the item), email and a message in their own
linked WhatsApp or Telegram chat with Kerf, never a customer thread. Replying
YES or NO in that chat decides it through the same service the app calls,
with permissions re-resolved and the decision audited. The requester hears
the outcome. One reminder goes out after the organisation's delay (four hours
by default), and before an automation approval's timeout.

Settings → Notifications holds each person's channels for approvals and for
outcomes, optional quiet hours (email and chat wait; the bell does not) and an
organisation default. Notices ride the event outbox in the same transaction as
the change; each (item, person, event, channel) is sent once
(`approval_deliveries`), and a failed channel is retried alone. A reminder is
queued by a five-minute schedule and re-checks the item first, so a decision
in between stops it.

Still open: an assistant action is the chatting user's own, so it gets only a
reminder after ten minutes, to them. A chat notice opens a reply prompt only
when the person is not mid-command; otherwise it just links to the app.
Approver lists are resolved when each notice is sent, so someone given the
permission later gets the reminder but not the first notice.

### An event run whose start reply is lost can show the wrong status — open

If Temporal accepts an event-triggered run's start but the API never gets the
reply (a client timeout), the run is marked Failed ("Couldn't start the run")
while it actually runs. That save can overwrite steps the run already
recorded, and once marked Failed the worker cannot move its status. A later
outbox retry then sets it back to Running, and nothing closes it. Rare; the
manual-run path has the same behaviour.

### A scheduled run waiting on approval holds later ticks — by design

While a scheduled run is paused on an approval step, later ticks of the same
schedule wait behind it rather than starting alongside it. Decide the pending
item in the Approvals inbox to let the schedule move on.

### Approvals can be decided by anyone with Approve automations — by design

The Approvals inbox is not scoped to a named approver or role. Anyone holding
the Approve automations permission can approve or reject any pending item in
the tenant.

### Schedules are hourly at the finest — by design

A schedule trigger runs at a chosen minute of every hour at the most
frequent setting. Anything finer (every few minutes) is deliberately not
offered, to keep a mistaken schedule from flooding a mailbox or the AI budget.

### Webhook URLs are shown persistently to editors — by design

The secret address of a webhook automation is visible to anyone who can edit
the automation, every time they open it, not just once at creation. If a URL
leaks, use Regenerate; the old address stops working immediately.

### The per-webhook rate limit fails open without Redis — by design

The per-webhook limit counts in Redis. If Redis is unavailable the check is
skipped and the request is accepted; the global per-IP throttling still
applies.

### The API's Temporal connection is made once at boot — open

If Temporal is down when the API starts, saving a schedule automation answers
"Couldn't update the automation's schedule…" until the API is restarted, and
boot reconciliation of schedules does not retry.

### Deleting an automation needs Temporal reachable — by design

Its Temporal schedule is removed first, so a delete fails while Temporal is
unreachable rather than leaving a schedule that fires for a deleted
automation.

### `PATCH /contacts/:id` can reset status and source — open

`updateContactSchema` is a zod 4 `.partial()`, which keeps defaults: parsing
`{ jobTitle: 'x' }` yields `status: 'lead'` and `source: 'other'` as well, so a
partial update may reset them unless the client sends both. Automation CRM
steps avoid it by sending only the named fields.

### The AI-email setting is saved with the budget form — open

"Allow automations to email AI-written text to customers" lives on the AI
budget row and is saved through the same form (`PATCH /ai/budget`), so turning
it on or off requires a monthly budget amount above zero. An organisation that
wants unlimited AI spend still has to enter a cap to change the setting. Give
it its own control when the AI settings page is next reworked.

### Changing the AI-email setting is audited without its value — open

The change writes an audit row with who and when, but no before/after value:
`ai` is one of the bodyless audit prefixes (`AUDIT_BODYLESS_PREFIXES`) because
its routes carry provider API keys. The trail shows that the budget was saved,
not whether customer email was switched on. Recording it needs a field-level
allowlist for `PATCH /ai/budget`, or an explicit `AuditService.record` call.

### Every quote is approved before it is sent; the order follows acceptance — by design

A quote reaches a customer only once it is approved: `createLink` (and so
`POST /quotes/:id/send`) refuses anything else. Approval signs off the price
and locks the quote; it no longer creates the sales order. The order is raised
when the customer accepts — through the link, or recorded by hand with
`POST /quotes/:id/mark-accepted` — by `QuotesService.provisionAcceptedQuote`.
Until then the quote has no order, so a customer who wants changes gets a
revision rather than an order someone has to cancel.

Consequences worth knowing:

- **The `ON_APPROVAL` billing trigger** now fires when the order exists, which
  is at acceptance. The enum keeps its name; the labels say "when accepted".
- **Links issued before this change** may belong to quotes that are not yet
  approved. Accepting one records the acceptance only; approving that quote
  later raises its order in the same transaction.
- **The Temporal quote workflow** no longer provisions on approval, behind
  `patched('order-on-acceptance')`. Workflows that approved before the change
  replay the old path.
- **If raising the order fails at acceptance** (a missing exchange rate, say),
  the customer's acceptance still stands and the error is logged. The quote's
  customer panel then says the order wasn't raised and offers **Raise the
  order** to anyone with `quote:approve`; it sends `APPROVE` again
  (`POST /quotes/:id/signal`), which fills in the missing order and does
  nothing when one exists.
- **Quotes approved before this change** already have an order but no
  acceptance on record. The panel treats the order as the end of the road:
  it shows the order and offers no Send, Mark as accepted or Revise.
- **The editor's live margin re-costs as quantities change.** A catalog line's
  cost is its unit cost times the quantity, worked out in the browser exactly
  as the server does; a template line goes back to `/catalog/resolve-lines`
  and the margin reads "Re-costing…" until it returns. Saving still re-costs
  every line on the server, and that copy is the one approval checks.
- **Automations that approve quotes** no longer produce an order or
  `invoice.issued` at approval; those now follow `quote.accepted`.

---

## Email client

### Mailboxes sync by polling, not push — open

`EmailSyncService` runs `history.list` against every connected Gmail account
once a minute (`@Cron(EVERY_MINUTE)`). Gmail's real-time path is `users.watch`
→ Pub/Sub push, which needs a GCP topic, a subscription and a public push
endpoint — dependencies the rest of the stack does not have. Polling costs one
request per account when nothing changed; at ~60s latency, inbound mail is
near-real-time without them. Closing this means a Pub/Sub topic per
environment plus a `@Public` push controller that resolves the `emailAddress`
in the notification back to an account.

### First sync backfills the newest 100 messages — open

`initialSync` fetches one page (`INITIAL_SYNC_MAX`) and then lets the
`historyId` cursor carry the account forward. Older mail is reachable by
nothing today — there is no "load older" path. A real backfill needs a
paginated `messages.list` walk, ideally queued so a 50k-message mailbox does
not stall the cron pass.

### Email is its own workspace, not part of `/inbox` — open

`/inbox` renders channel conversations (WhatsApp, Telegram, channel email);
synced Gmail threads live at `/email` instead. Merging them means teaching the
inbox a second message shape with threading — the plan that predates the
client (`docs/superpowers/plans/2026-08-10-email-client-implementation.md`)
listed it as a separate task for that reason.

### Attachments are fetched on demand, never stored — by design

`email_attachments` keeps metadata plus the provider attachment id; the bytes
are pulled through `users.messages.attachments.get` when someone clicks, so
the CRM stores no message files. The trade is that a download needs the
mailbox still connected — disconnecting an account deletes its synced copies
with it.

### Gmail send-from is owner-only — by design

A shared mailbox is readable by every `email:read` holder, but
`email.messages.send` refuses unless the account is yours (or you hold
`email:manage`). Delegated sending — assistant@ replying from the shared
support mailbox as themselves — is a real Gmail feature this does not model.

### App-password connect is Gmail-only and unverified at scale — open

The IMAP/SMTP provider exists because OAuth's Internal consent screen only
admits our own domain; customer users connect with a 16-char Google app
password instead. Two things follow: it only works for Google accounts
(Workspace or gmail.com — Microsoft/others have no path), and a Workspace
admin can disable app passwords entirely, which surfaces as a rejected
login at connect time. The fix for both is a real provider abstraction
(Microsoft Graph, generic IMAP hosts) when a customer asks for it.

### IMAP sync sees a window, and threading is heuristic — open

The IMAP poll watches INBOX + Sent, backfills the newest 100 messages per
mailbox, and re-checks flags on a trailing 200-UID window — mail outside
INBOX/Sent (custom labels, archived threads) and flag changes older than
the window are not mirrored. Threading reconstructs conversations from
References/In-Reply-To anchors plus a normalized-subject hash, which is
close to Gmail threading but not identical — unrelated messages that share
a subject line ("Invoice") can merge into one thread.

---

## Slack channel

### One bot per organisation, not a marketplace install — by design

Slack is wired like Telegram: an org admin creates a Slack app in their own
workspace (Bot Token `xoxb-…` + Signing Secret) and pastes the pair into
Settings → Channels → Slack, then points the app's Event Subscriptions at the
webhook URL shown there. There is no public Slack App Directory listing or
OAuth install flow — every org runs its own app, which keeps each tenant's
token inside its own workspace.

Inbound needs the `message.channels`, `message.groups` and `message.im` events
plus `chat:write`, `im:write` (DM replies) and `files:read` (attachments).
Every Slack user gets their own contact and conversation — a reply from the
inbox opens a DM with that sender rather than posting back into the channel
the message came from, so staff replies to a shared-channel question arrive
privately. Every file on a message is kept and shown in the inbox, but a chat
command (a receipt, a supplier invoice) still reads only the first; contact
names start as the Slack user id until someone renames the contact.

---

## Files sent on a channel

### Copied into our store in the background — by design

A file on an inbound WhatsApp, Telegram, Slack or Resend message is downloaded
after the webhook has answered and stored as an attachment owned by the
`CHANNEL_MESSAGE`, so `channel:read` opens it. Until the copy lands the inbox
shows "Saving…"; a download that fails, or has not landed ten minutes after
the message, shows "Could not be saved". There is no retry: a file lost to an
API restart mid-download or a provider outage stays failed.

### Limits — open

- **25 MB per file** (`ATTACHMENT_MAX_BYTES`), and Telegram's Bot API will not
  serve a file over 20 MB at all.
- **Types outside the upload allow-list** (CorelDRAW, audio, video, HTML) are
  kept as `application/octet-stream`: downloadable, never previewed.
- **An album is one message per file** on WhatsApp and Telegram, because that
  is how the providers deliver it.
- **The SMTP email channel has no attachment format**; only Resend's
  `email.received` attachments are read. Mailboxes under `/email` are
  separate and still fetch attachments on demand.
- **Chat commands act on the first image or document only.**

---

## Finding your way (menu, overlaps, next step)

- **Contacts and Customers stay two tables.** A contact is a person (lead,
  buyer, chat sender); a customer is the company you quote and invoice. A
  contact's page now shows the matching customer company and links to it, or
  offers "Make a customer", which opens the normal customer form filled from
  the contact. The match is by company name, then email, done in the browser:
  there is no link column, so renaming either side breaks the match. A real
  `contacts.customer_id` (with a migration) is the follow-up if this proves
  useful. Setting a contact's status to "Customer" still does not create a
  customer company; the page says so.
- **Inbox, Email and Assistant stay separate pages.** Each now opens with a
  short strip saying what it is for (shared customer chats / your mailbox /
  private AI help) and links to the other two the user can open.
- **The next-step card is derived, not stored.** It reads the order's status,
  billing stages and their invoices, delivered quantities and delivery notes;
  the quote's status, acceptance and deposit; the invoice's status, payments,
  `sentAt` and due date. No new states. Two known gaps: a quote counts as
  "sent" only while it has a live acceptance link (an expired link reads as
  not sent), and the card cannot tell in advance whether a line was priced
  from a catalog product. Starting production refuses an order with no such
  line, so for one-off work the card's "Start the job" says to skip to the
  delivery, and the refusal explains why.
- **The old header buttons stay** on the sales order (Start production, Plan
  production, Mark fulfilled, Raise invoice, Cancel), now all outlined; the
  amber button is the one in the next-step card.
- **Menu search matches page names and short hints only**, not records. It
  covers settings pages and custom objects the user can open.

---

## Staging environment

True of the staging box (`ssh ismail`, `~/ai_crm`), not of the code.

- **Northwind Trading is on a paid `growth` plan** through the fake billing
  provider, left there by the S8 dunning and restriction tests.
- **Its base currency is GBP**, with EUR rates of 0.85 and 0.87 and a September
  revaluation posted.
- **The "Operating Bank" account is in USD** while the base currency is GBP, so
  it can no longer receive GBP or EUR payments. Tests should use the "S8 GBP
  current account".
- **Test quotes, attachments and notifications** from the S5–S0 verification
  runs are still present.
- **Attachments live on the `attachments_staging_data` volume**, not in the
  image. A `docker compose down -v` would take them with it.
- **Backups** are in `~/backups`, one per sprint (`*_pre_s0.sql.gz` and so on),
  plus `crm_staging_20260915_170632_s6_bad_issue.sql.gz`, kept deliberately as
  the pre-fix state of the S6 stock bug. The `backup` compose service now adds a
  nightly `pg_dump -Fc` there (`crm_<timestamp>.dump`, 14 days kept; the
  sprint files are never pruned) — once it has been started with
  `up -d backup`. The dumps are on the same disk as the database: copying them
  off the host, and WAL archiving for point-in-time recovery, are the open next
  steps (`docs/DEPLOYMENT.md`, "Backups").
- **Temporal is pinned to `auto-setup:1.29.3`**, which is what `latest`
  resolved to at pinning time. Confirm the running container matches before
  the first deploy with the pin; never pin lower than what is running.
