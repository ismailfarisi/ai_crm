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

## Automations

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

### Nobody is told when something needs approval — pending

Approval steps and AI actions awaiting sign-off appear in the Approvals inbox
and its nav count, but no notification is sent: no bell entry, email or chat
message. Deferred on 2026-10-29. Building blocks already exist:
`NotificationsService.notifyHolders` (the bell, addressed by permission, so
`automation:approve` holders), mail (still console-only on staging until SES),
and the WhatsApp/Telegram channel drivers. Not decided yet: which channels,
and whether to remind as the timeout nears.

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
