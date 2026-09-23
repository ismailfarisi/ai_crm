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

### Enforcement is on, and existing organizations' trials end 2026-10-15 — open

`BILLING_ENFORCE` defaults to `true`. Existing organizations were given 30-day
trials by the S8 migration. When a trial ends, or a failed payment passes the
14-day grace period, writes return 402 while reads, billing and sign-in keep
working. Decide before that date whether staging and any real tenants should be
exempt.

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
  the pre-fix state of the S6 stock bug.
