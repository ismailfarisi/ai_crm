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

---

## Money and currency

### Expense claims and account transfers are not currency-converted — open

S8 converted every posting site that reaches the ledger through documents —
invoices, payments, credit notes, refunds, bills, receipts, tax — but expense
claims and treasury transfers still post at face value. A claim in a currency
other than the base currency posts the wrong number. Convert them the way
`order-provisioning` and `payables` do, through `fxRateFor` and `resolveLines`.

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

### Base currency cannot change once anything is posted — by design

Every ledger entry is denominated in it. `PUT /finance/currencies/base` refuses
with a 409 after the first journal entry.

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

---

## Tax

### Purchases have no reverse charge — open

Reverse charge is applied to sales: an EU customer with a tax id gets 0% and the
invoice says the customer accounts for the tax. The purchase side — where a bill
from an EU supplier should post both an input and an output tax line — is not
implemented.

### Purchase orders carry no tax code — open

`tax_code_id` is on sales documents and on supplier bills, but not on purchase
order lines, so an order's tax is only resolved when the bill arrives.

### Tax rules match a country, the EU, or everything — open

`taxRuleFor` matches an exact country code, then `EU`, then `*`. There is no
region or state matching, so anywhere with sub-national tax (US states, Canadian
provinces) cannot be modelled.

---

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
- **No chart-of-accounts editor — open.** Tenants cannot add accounts, so the
  expense accounts the seed creates are the ones available.
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
- **The seed's annual lease relies on the billing job — open.** The job logs
  and skips per-row failures, so a broken lease would not fail the seed.
- **Expense claims are still not FX-converted** — see "Money and currency".

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
