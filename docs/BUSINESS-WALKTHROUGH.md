# Walkthrough: running a real business on Relay CRM

A usability and completeness pass over the staging deployment
(https://switeaz.com, API `api-staging.switeaz.com`), done as a business owner
rather than a developer. The persona is the one the product sells to:
**Meridian Packaging Co**, a made-to-order packaging manufacturer. Fresh
account registered 2026-09-16 — no seed data, no prior knowledge of the app.

The question behind every step: *can this company actually be run from here?*

Severity: **blocker** — stops a real operation dead; **major** — forces a
workaround or produces a wrong number in front of a customer; **minor** —
friction, confusion, polish.

This is a black-box user report. Where a finding was confirmed in the source,
the file is named. It is deliberately separate from `docs/FLAGS.md`, which
records trade-offs the team took knowingly; nothing here repeats those.


> **Status, 2026-09-16.** The findings marked **FIXED** below are **deployed to
> staging** (`ssh ismail`, branch `fix/walkthrough-correctness`) and verified
> there against real data; the rest are untouched. MOSTLY/PARTLY FIXED
> means part of the finding stands — each note says which part. Each fixed section
> keeps its original description so the problem stays on record, and ends with
> a *Fix* note saying what changed. `pnpm build` passes; API 618 tests and web
> 221 tests pass.

> **Verified on staging after deploying.** P&L went from income 2,030 /
> expenses 0 to expenses 1,500 and net profit 530 once a claim was approved and
> reimbursed. A new cash account opened at 250 posted debit 1002 / credit 3100
> Opening balance equity, with the trial balance still at difference 0. The
> dashboard reported a real 100% win rate ("1 of 1 decided") and 2,030 invoiced,
> and the cashflow chart +$2.03K in, −$1.50K out, +$530 net. The customer's
> quote now carries the address, tax registration, company number, contacts and
> footer.
>
> **Two things deploying found that local tests did not:** the catalog Products
> tab asked for `limit=500` against an endpoint capped at 100 and failed
> outright, and the cashflow axis drew thirty full ISO dates on top of each
> other. Both fixed and redeployed.
>
> **Still outstanding on the money side:** accounts created *before* the
> opening-balance fix are not backfilled. Meridian's original account still
> reads 15,530 in treasury against 530 in the ledger — the $15,000 it was opened
> with. New accounts are correct; the old ones want a one-off backfill posting
> the difference to 3100.

---

## Summary

Sign-up works and the sales paperwork is genuinely good — the quote editor,
approval chain and document trail are better than most products at this size.
But a new tenant cannot reach the feature the product is sold on. The landing
page promises "quote custom work from what it actually costs to make"; the
catalog that feature reads from can only be filled by a developer with database
access. Everything downstream of a costed quote — margin, production, material
planning — is unreachable with it.

Alongside that, several of the most prominent numbers on the dashboard and the
finance overview are hardcoded demo values that do not come from the account's
data at all.

---

## 1. Sign-up and the first five minutes

### 1.1 The dashboard shows invented business metrics to an empty company — major — FIXED

Registration completes and lands on the dashboard. The company is one second
old and has nothing in it. The dashboard nonetheless reports:

| Widget | Shown | Truth |
| --- | --- | --- |
| Quotation Win Rate | **84%**, "Target Met", goal 80%, "+12.4% this month" | no quotes exist |
| Revenue & Conversion Velocity | **72.4%**, "+14.8% YoY", full Jan–Aug trend chart | no revenue exists |
| Upcoming Deals & Schedule | 3 meetings — "Acme Corp — Enterprise Contract Review", "Quantum Dynamics — Cloud Migration Suite $45,000", "Starlight Industries — Discovery & Scope" | no contacts, no deals, no calendar |

The counters beside them (Total contacts 0, Active customers 0) *are* real, which
is what makes it convincing rather than obviously a placeholder. The same three
fake meetings and the same 84% appear in the unrelated demo tenant, so they are
per-build constants, not per-account.

Confirmed in source: `apps/web/src/app/(app)/dashboard/page.tsx:113`
(`metricValue="72.4%"`, `growthLabel="+14.8% YoY"`),
`apps/web/src/components/dashboard/dashboard-kpi-chart.tsx` (the trend series),
`apps/web/src/components/dashboard/dashboard-schedule-cards.tsx:39,50` (the
meetings).

Why it matters commercially: an owner who glances at the dashboard and repeats
"we're at 84% win rate" to a lender or a buyer is repeating a number the
software made up. Either wire these to real queries or give them honest empty
states like the ones the customers and finance pages already have.

**Fix.** The gauge, the trend chart and the deals panel now take real data and have no sample fallbacks. `DashboardGaugeWidget.percentage` lost its 84% default and became required; the win rate is computed from quotes the customer accepted versus quotes rejected, and when nothing has been decided the widget says so instead of showing a figure. `DashboardKpiChart` takes a `series` of real monthly invoiced totals, scaled to the data, with a "Nothing invoiced yet" state. The three invented meetings are gone: the panel is now "Waiting on you" and lists quotes that are actually awaiting a decision, linking to each one.

### 1.2 The finance overview does the same — major — FIXED

`/finance` on the same empty account reports **Total available cash $0.00** and
**"No bank accounts registered"** — correct — directly above a "Cashflow Runway
& Velocity" chart claiming **Inflow +$287.90K, Outflow −$177.60K, Net Cashflow
+$110.30K** across four weeks. The two halves of one screen contradict each
other.

**Fix.** `CashflowTrendChart` no longer falls back to `DEFAULT_SAMPLE_SERIES` when the caller passes nothing — that constant is deleted — and `finance-overview-view` passes the real `recentCashflowSeries` the API already returned. The server side was wrong too: `dayInflow` was hardcoded to `0`, so money coming in never appeared. Inflow and outflow are now derived from posted journal lines that touch a cash account, excluding internal transfers and opening balances, which are not cashflow. With no movement the chart shows its empty state.

### 1.3 Nothing sets the company up — major

Sign-up asks for organisation name, first name, last name, email, password, and
nothing else. There is no onboarding: no wizard, no checklist, no "add your
first customer", no prompt to set up anything. The account is dropped on the
dashboard and left there.

What is silently decided on the owner's behalf:

- **Base currency is set to USD.** It is never asked for. It can be changed at
  Finance → Currencies, but nothing tells you that page exists or that the
  choice is urgent — and per `docs/FLAGS.md` the base currency **cannot be
  changed once anything is posted**. A UK or EU business that trades for a week
  before finding that page is permanently on the wrong ledger currency.
- **No chart of accounts, no bank or cash account, no tax code exists.** Verified
  against the API on the new tenant: `/finance/accounts` → `[]`, `/tax/codes` →
  404, `/catalog/materials`, `/catalog/work-centers`, `/catalog/tooling`,
  `/inventory/stock` → all `[]`.

A sensible first-run flow would ask for country and currency, seed a default
chart of accounts and a tax code from the country, and offer a starter cash
account.

### 1.4 The dashboard shows the owner a 91-item permission dump — minor

"Your Access & Roles" lists all 91 raw permission strings (`purchase_order:approve_above_threshold`,
`quote:approve_below_margin`, …) on the main dashboard. That is a debugging view
on the screen the owner sees most. It belongs in Settings → Roles.

---

## 2. The blocker: the core feature cannot be set up

### 2.1 There is no way to create a product, material, work centre or tooling — blocker — MOSTLY FIXED

The product is sold on cost-model quoting. The sign-in page advertises it with a
worked example (a rigid gift box priced from length/width/height, lamination,
material, machine, labour and tooling, with quantity price breaks), and the
quote editor has an "Add from catalog" button for it.

Opening that picker on a new account gives:

> **Your catalog is empty**
> Add materials, work centres and a product template to quote from a cost model.

There is no screen anywhere in the application that does any of that. The
sidebar has no Catalog, Products, Materials or Work Centres entry; no such route
exists under `apps/web/src/app/`; and the only catalog UI in the codebase is the
read-only picker inside the quote editor
(`apps/web/src/components/quotes/quote-editor/catalog-picker.tsx`).

The API is complete and waiting — `apps/api/src/modules/catalog/catalog.controller.ts`
exposes `GET/POST/PATCH/DELETE` for `catalog/materials`, `catalog/work-centers`,
`catalog/tooling` and `catalog/items`, plus product templates and costing
policies. The web client calls **only** the read half of it
(`apps/web/src/lib/api/endpoints/sales.ts:40-51`: `searchItems`, `listTemplates`,
`getTemplate`, `price-breaks`). Nothing in the front end ever writes to the
catalog.

So the flagship feature is reachable only by a developer POSTing to the API or
inserting rows directly. A customer who signs up and follows the product's own
instructions cannot complete them. `docs/FLAGS.md` notes a related gap ("the
catalog has no UI or API for the stock-material link") but records the missing
link field, not the missing catalog UI as a whole.

Everything that depends on the catalog is unreachable along with it: cost-based
pricing, quantity price breaks, the margin figures on the quote, bills of
material, and material-driven production and stock movement.

**Fix.** A Catalog screen now exists at `/catalog`, in the sidebar under
Quotes, gated on `catalog:manage`. It has four tabs — Products, Materials, Work
centres, Tooling — each a table with create, edit and remove, built on the CRUD
the API already exposed. The web client's catalog slice gained the write half it
never had (`apps/web/src/lib/api/endpoints/sales.ts`), with hooks in
`apps/web/src/hooks/use-catalog-admin.ts`. Materials ask for sheet size and
grain only when the unit of measure is SHEET, which is exactly when the schema
requires them and when the nesting engine can use them.

Verified against the live staging API on a fresh tenant: a material, a work
centre, a tooling record and a product were created through the same payload
shapes the new client sends, all accepted, and a duplicate SKU was correctly
refused with a readable message. The product then appeared in the quote
editor's catalog picker — the "Your catalog is empty" state is gone — and
adding it to a quote produced **Cost $2.22, Gross margin $1.48, 40.0%** in place
of the old 100% with its "typed by hand" warning.

**Still missing: product templates.** The parametric cost model — the one the
landing page advertises, where a price falls out of length, width, height,
material yield and machine time — needs a template editor with formulas,
parameters and routing, and that has no UI yet. So §2.2's *Plan production* and
the price-break ladder remain blocked. What works now is the flat case: real
products with real costs, and therefore real margin.

### 2.2 Everything downstream of the catalog is unreachable too — blocker — PARTLY FIXED

The quote itself can still be written by hand — type a description, quantity and
price — and that path works well. But every feature that reads a cost model is
then closed:

- **Margin is fiction.** The quote showed "Gross margin 100.0%, Cost $0.00" on a
  $2,030 quote. To its credit the panel says so: *"Some lines were typed by hand
  and have no cost, so this margin is an over-estimate. Add them from the catalog
  to make it real."* Honest — but the remedy it names does not exist.
- **Production cannot be planned.** Pressing *Plan production* on the resulting
  sales order returns: *"Nothing to plan: … not priced from a product template,
  so there is no routing to follow"* for every line. The Production page agrees:
  *"No work orders — plan production from a sales order whose lines were priced
  from a product template."* There is no "create work order" button anywhere, so
  for a manufacturer the entire Production module is unreachable.
- **Cost of goods sold is always zero.** The P&L after a completed sale shows
  Income $2,030, Total expenses $0.00, Net profit $2,030 — a 100% margin on
  physical goods, because nothing carries a cost.
- **Stock never moves**, since movements are driven by the material link on a
  catalog item.

**Fix (partial).** Margin is real as soon as a line comes from the catalog,
verified above. Cost of goods sold will follow for those lines. Production
planning and the price-break ladder still need a product template, so they stay
blocked until the template editor exists.

### 2.3 "Start production" is a label with nothing behind it — major

*Start production* on the sales order succeeds, toasts "SO-2026-0001 is now in
production" and flips the status badge to **In production** — while the
Production page still shows *"No work orders"*. The status is decorative: no job
exists, nothing is scheduled, no material is committed. An owner reading the
order list believes work has started on the floor when nothing has been raised.

---

## 3. Money: what the books actually say

### 3.1 A bank account's opening balance never reaches the ledger — major — FIXED

Creating a cash account (Finance → Bank & Cash Accounts → New Account) offers an
opening balance field. I entered **$15,000.00**. The customer then paid the
$2,030 invoice into the same account. The application now reports that one
account's balance as two different numbers:

| Screen | Meridian Operating Checking |
| --- | --- |
| Finance → Bank & Cash Accounts (and Total liquidity) | **$17,030.00** |
| Reports → Balance sheet, account 1001 | **$2,030.00** |
| Reports → Trial balance, account 1001 | **$2,030.00** debit |

The opening balance is held on the account record but never posted as a journal
entry, so it exists in treasury and not in the books. The consequences:

- The balance sheet understates assets by the opening balance of every account.
- There is no opening capital or retained-earnings entry to match it, so the
  books "balance" only because the money was never entered on either side.
- Bank reconciliation is impossible: the ledger can never agree with a statement.

The trial balance does balance (4,060.00 / 4,060.00) and CI asserts that it does —
which is exactly why this passes unnoticed. The opening balance needs to post a
real entry (debit cash, credit an opening-balance equity account), or the field
should be removed and replaced by an explicit opening journal.

**Fix.** A new ledger role and system account, `OPENING_BALANCE_EQUITY` (code 3100), was added to `SYSTEM_LEDGER_ACCOUNTS`. `FinanceService.createAccount` now calls `postOpeningBalance`, which debits the account's own cash ledger account and credits opening balance equity, so treasury and the balance sheet agree and the account can be reconciled. Equity rather than income, because money the tenant already had is not revenue earned here. The entry is idempotent on `referenceId` (`opening-balance:<accountId>`), an account opened at zero posts nothing, and `provisionChartOfAccounts` is called first — it is idempotent — so tenants whose chart predates 3100 get it on demand without a migration.

### 3.2 There is no way to record a payment on a new account, and the error does not say why — major

*Record Payment* on an invoice opens a dialog whose "Deposit Into" dropdown is
empty on a new tenant, because no cash account exists yet. Submitting returns:

> Please select an account to deposit the payment into.

There is nothing to select. The message names the field rather than the problem,
and offers no link to Finance → Bank & Cash Accounts where the account is
created. The first payment a new business tries to record is a dead end until
they find that page by exploring.

### 3.3 Smaller things on the money screens

- The **Record Payment dialog is pinned to the top-left corner** of the viewport
  instead of being centred.
- The **Invoices list shows a raw UUID** in its "Quote ID" column
  (`aba76c8b-b382-46ad-827b-5acfeb8f8b956`) where every other screen uses the
  document number. It should read `QT-2026-0001`.
- **Ticking "default account" when creating the account had no effect** — the
  header still reads "DEFAULT ACCOUNT: None set".

---

## 4. Buying anything is impossible

### 4.1 A purchase order cannot be created — blocker — FIXED

Suppliers can be created (the form is fine: contact, tax id, address, payment
terms, lead time). Then the chain stops.

`/purchasing/orders` has **no "New purchase order" button**. Its empty state
reads:

> **No purchase orders yet**
> Raise one from a quote, or from a chat message on a linked channel.

Neither route is open to a new business:

- *From a quote* requires quote lines priced from a product template — the
  catalog that cannot be created (§2.1).
- *From a chat message on a linked channel* requires a Telegram/WhatsApp channel
  configured and the AI command layer.

The API supports it directly (`POST /purchase-orders`, plus `submit`, `approve`,
`send`, `close-short`, `cancel` and a `suggest` endpoint in
`apps/api/src/modules/purchasing/purchasing.controller.ts`). The web client even
wraps it — `api.purchaseOrders.create` in
`apps/web/src/lib/api/endpoints/purchasing.ts:91`, exposed as
`useCreatePurchaseOrder` in `apps/web/src/hooks/use-purchase-orders.ts:47`. **No
component imports that hook**, and none imports `useSuggestPurchaseOrders`
either. The plumbing is finished; the screen was never built.

**Fix.** Purchase orders now has a **New purchase order** button, gated on
`purchase_order:create`, opening a form with supplier, expected date, notes and
a repeating line editor. `useCreatePurchaseOrder` — which already existed and
which nothing imported — is finally the thing behind a button. Picking a
material fills the line's description, unit and cost from the catalog, while
leaving all three editable, because what goes on the order is the supplier's
price on the day rather than the standing cost. The order total adds up live,
and the order opens on its own page once created.

Writing the test caught a real bug in the form: an empty date input reads as
`''`, which `z.coerce.date()` turns into an Invalid Date rather than treating as
absent, so leaving Expected date blank failed the whole submission with an error
against a field the user never touched. It now normalises to `null` first.

Verified end to end against the live staging API, which is what makes this a
fix rather than a screen: **PO-2026-0001** created as a draft, submitted,
approved, then received in full as **GRN-2026-0001** — at which point
`/inventory/stock` returned, for the first time on this tenant, a real row:

> 350gsm folding boxboard (FBB-350) — 500 SHEET on hand at $0.42 average cost,
> in Main store

and `/purchase-orders/<id>/billable` offered 500 units to bill. So goods
receipts, stock and the supplier-bill path all open with it.

### 4.2 A supplier bill cannot be entered either — blocker — FIXED

`/purchasing/bills` likewise has no create button:

> **No bills yet**
> Enter one from a purchase order once its goods have arrived.

Bills are reachable only from a purchase order, which cannot be raised. So the
whole procure-to-pay chain — order, goods receipt, bill, three-way match,
payment — is sealed off, and with it accounts payable, stock inward movements and
supplier balances. A business cannot record that it owes anyone money.

**Fix.** Bills were never the blocker in themselves — they are reachable from a
purchase order, and no purchase order could exist. With §4.1 fixed the path is
open: the billable endpoint returned the received 500 units against
PO-2026-0001, ready to be billed and three-way matched. The stock finding in
§7.6 clears the same way, since stock arrives through a goods receipt.

### 4.3 The one remaining way to record spending does not reach the books — blocker — FIXED

Expense claims are the only spending route left, so I used one for a material
purchase: $4,200 from Caledon Board Mills. The workflow itself is good — submit,
approve, reimburse, with clean states — and it completed: claim **EXP-2026-0001**,
status **Paid**, "Reimbursed & Settled $4,200.00".

Nothing reached the ledger. After the claim was approved *and* reimbursed:

| Report | Before the claim | After |
| --- | --- | --- |
| P&L — Total expenses | 0.00 | **0.00** |
| P&L — Net profit | 2,030.00 | **2,030.00** |
| Trial balance | 3 accounts, 4,060.00 / 4,060.00 | **identical** |
| Treasury — total liquidity | $17,030.00 | **$17,030.00** |

The $4,200 exists only in the expense list. The books show a $2,030 profit on a
month where the business actually lost $2,170, and the bank balance never moved
even though the claim is marked paid.

Two things are probably in play and both need checking:

1. The reimbursement **never asks which account to pay from**, and the
   organisation has no default account set (§3.3) — so the posting likely has
   nowhere to go and is skipped silently, with a success toast either way.
2. `docs/FLAGS.md` says claims post at face value without currency conversion,
   which implies they are expected to post *something*. Here they post nothing at
   all, which is a different and larger problem than the one recorded there.

**The combined effect of §4.1–4.3 is the most serious finding in this report.**
Purchase orders and bills cannot be created, and expense claims do not reach the
ledger, so there is no way for any cost to enter the accounts. Every P&L this
product produces will show revenue with zero costs and 100% profit — and it will
balance, and CI's trial-balance check will pass, because the money was never
entered on either side.

---

**Fix.** The cause was worse than a Temporal fallback: `postJournalEntryActivity` was a stub that logged a line and returned a synthetic id without writing anything, so claims never posted even when Temporal was healthy. Posting now happens in `ExpensesService` on the same path as every other posting site in the codebase. Approval debits operating expense and credits accounts payable; reimbursement debits accounts payable, credits the cash account and reduces its balance so treasury moves with the ledger. The account is taken from the request, else the organisation's default, else its only one; with no account at all it now refuses and names Finance → Bank & Cash Accounts rather than marking a claim paid out of nowhere. Both entries are idempotent on `referenceId`, so a retry or a later workflow replay cannot double them. Six tests cover it.

## 5. The company has no identity

### 5.1 There is no company profile — address, tax number and logo cannot be set — blocker — MOSTLY FIXED

Settings contains Team, Teams, Roles & permissions, Channels, Billing, Audit
trail and AI Cost Guard. There is **no company or organisation profile page**,
and no API behind one either: `apps/api/src/modules/organizations/` contains an
`entities/` folder and no controller, and the entity itself holds only three
fields — `name`, `slug` and `baseCurrency`.

So there is nowhere to record the business's address, registered company number,
VAT/tax registration number, phone, email, logo, invoice footer or remittance
bank details. The `org:read` and `org:update` permissions are granted to the
owner and govern nothing.

This shows up directly on the customer-facing document. The quote my customer
received at `/q/<token>` was headed simply:

> Meridian Packaging Co
> Rigid gift boxes — Harbourline hamper range
> QT-2026-0001 · Prepared for Harbourline Foods Ltd

No address, no contact details, no tax number, no logo. In most jurisdictions a
compliant invoice must carry the seller's legal name, address and tax
registration number, so the documents this product issues cannot be made to meet
that requirement. This is also the first thing any owner tries to set up, and the
most visible sign to their customers of what they are using.

---

**Fix.** The organization now has a record worth reading and a screen to edit
it. Thirteen nullable columns were added to `organizations` — legal name, tax
id, registration number, email, phone, website, four address lines plus region
and postal code, ISO country, and a document footer — with a migration
(`1787100000000-AddOrganizationProfile`). A real module sits behind them at
last: `GET /organization` and `PATCH /organization`, gated on `org:read` and
`org:update`, which had been granted to every owner while governing nothing.

Settings → Company edits it, with a live preview of how the letterhead will
read and an explicit warning while the address or tax registration is still
missing, so the sender notices before the customer does. `country` is a
two-letter ISO code rather than free text, because tax rules match an exact
country code — the mistake §6.5 still describes on the customer and supplier
forms.

The details now print on the document the customer actually receives:
`PublicQuoteDto` carries a `seller` block and the public quote page shows the
address, tax registration, company number and contact details in its header,
with the footer under the totals. Every field is optional, so a tenant who has
not filled the screen in still gets a working, if barer, document.

Six tests cover the service, including that a blank clears a field, that a
patch omitting the name leaves it alone, and that "United States" is refused
where "US" is wanted.

**Not done: the logo.** There is still no image upload, so documents remain
text-only. The storage module exists and could hold one; it wants an uploader,
a size and type policy, and somewhere to render it on each document type.

**The migration has not been run.** There is no local database in this
environment, so it was hand-written to match the entity rather than produced by
`pnpm migration:generate`, and neither `pnpm migration:run` nor
`pnpm check:drift` has been executed against it. It is plain
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` with a matching reversible `down`,
but it should be run and drift-checked before this is deployed anywhere.

---

## 6. Configuration that pretends to be configurable

### 6.1 The quote editor ignores the tax codes you configure — major — FIXED

Finance → Tax is a real feature: it holds sales and purchase tax codes, rules
that select a code by customer or supplier, reverse charge, and a tax report.

The quote editor does not use any of it. Its per-line Tax dropdown is a fixed
list of five literals hardcoded in
`apps/web/src/components/quotes/quote-editor/quote-lines-table.tsx:27`:

> 0% (Exempt) · 5% (VAT) · 10% (Sales Tax) · 15% (Standard Tax) · 20% (VAT 20%)

Consequences for a real business:

- A rate you actually need and configured — say 8.25% for California, or 7.7% —
  cannot be chosen. You are limited to those five round numbers.
- Codes created in Finance → Tax never appear on a quote, so the rules engine and
  reverse charge never take effect on the sales side.
- The resulting tax report has nothing to group by. Mine read
  *"No code 0% — net 2,030.00, tax 0.00"* — the sale landed with no tax code at
  all, so a return cannot be filed from it.

**Fix.** `QuoteLinesTable` takes a `taxCodes` prop and builds its rate list from the organisation's active sales tax codes, which the editor fetches with the existing `useTaxCodes` hook. The five hardcoded literals remain only as a fallback for tenants who have not configured tax yet, relabelled so they no longer claim to be named tax regimes. A business can now put a rate it actually needs — 8.25%, 7.7% — on a quote, and codes created under Finance → Tax reach the document.

### 6.2 Three different currency lists, none of them the same — major

The same account offers three different sets of currencies depending on the
screen:

| Screen | Currencies offered |
| --- | --- |
| Finance → Currencies (base currency) | GBP EUR USD CHF SEK DKK NOK PLN CAD AUD JPY INR AED (13) |
| Quote editor (document currency) | USD EUR GBP AED SAR CAD AUD (7) |
| New bank account | USD EUR GBP CAD AUD SGD JPY CHF (8) |

SAR can be quoted but cannot be a base currency or held in an account. SGD can be
held in an account but cannot be quoted or used as a base. INR, SEK, DKK, NOK and
PLN can be a base currency, but no account can be opened in them and nothing can
be quoted in them. These should be one list from one source.

### 6.3 Units of measure are fixed, and are the wrong ones — major

The quote line UOM dropdown offers Units, Hours, Days, Licenses, Months,
Packages, Services, Items — a software-services list, hardcoded alongside the tax
rates in `quote-lines-table.tsx`. For the made-to-order manufacturer this product
targets there is no kg, m², sheet, roll, pallet or thousand, and no way to add
one. My 500 boxes had to be quoted in "Units".

### 6.4 Expense categories are fixed and office-shaped — major

Travel & Lodging, Meals & Entertainment, Office Supplies, Software & SaaS,
Hardware & Equipment, Marketing & Advertising, Professional Services, Utilities &
Telecom, Other. There is no way to add a category, so a manufacturer has no Raw
materials, Freight, Subcontract or Consumables and must file everything under
"Other" — which also makes the Category Budgets page, which budgets against these
same categories, useless for the costs that actually matter.

### 6.5 Country is a free-text box while tax rules match on country — major

Both the customer and supplier forms take Country as free text. Tax rules match
on an exact country code, then `EU`, then `*` (`taxRuleFor`, noted in
`docs/FLAGS.md`). I typed "United States"; someone else will type "USA", "US" or
"united states", and any country-based tax rule will silently miss. It should be
a picker bound to ISO codes.

---

## 7. Sessions, navigation and smaller friction

### 7.1 The session drops about every 15 minutes — major

I was signed out mid-task twice, roughly a quarter of an hour apart, each time on
a plain navigation and with no warning. The audit trail records the re-logins at
**15:27:33** and **15:43:24** — a ~16 minute gap, matching the 15-minute access
token TTL, so the silent refresh is not holding.

The redirect does preserve the destination (`/login?next=/settings/team`), which
is good. But nothing preserves work in progress: being bounced out of a
half-written quote would lose it. For a tool meant to be open all day beside the
work, this is the single most grating thing about using it.

### 7.2 A customer is not a record you can open — major

Customers can be created, listed, searched, sorted and exported, but the rows are
not clickable and there is no `/customers/[id]` route. There is no way to open
Harbourline Foods and see their quotes, orders, invoices, balance, delivery
history or notes in one place — the basic customer-360 view that is the reason to
have a CRM at all. Contacts do have a detail page; the companies you actually
sell to do not.

### 7.3 A quote cannot be emailed to the customer — major

After approving a quote, the only way to get it to the customer is *Get
acceptance link*, which copies a URL to the clipboard for you to paste into your
own email client. There is no "send to customer" action, despite the product
having a mail provider, a channels module, and the customer's email address
already filled in on the quote. Sending the quote is the most common action in
the entire sales process.

### 7.4 The customer's acceptance link points at a different hostname — minor

The link generated on `switeaz.com` is `https://staging.switeaz.com/q/<token>`.
It works, but the host says "staging" to every customer who receives one, and
does not match the domain the business is using. Worth checking the public web
URL configuration before anyone sends one to a real client.

### 7.5 A pending invite cannot be resent or copied — minor

The Team page lists pending invitations with an expiry and a Cancel action. There
is no "resend" and no "copy invite link". If the mail never arrives — a
misconfigured provider, a spam filter — the owner's only option is to cancel and
re-invite, and hope. The quote acceptance flow has a copy-link fallback; invites
should have one too.

### 7.6 Other friction

- **Modals open pinned to the top-left corner** of the viewport rather than
  centred — seen on Record Payment, Add team member and Prepare delivery.
- **Audit entries do not name the record they describe.** The list reads "Created
  by Daniel Whitfield", "Decision recorded by…", "Status by…" with no document
  number, so you cannot tell which quote or invoice an entry refers to without
  opening it. The filters and the field-level diffs are otherwise excellent.
- **There is no manual stock adjustment.** `POST /inventory/adjustments` and
  `/inventory/reorder-levels` exist and are wrapped in
  `apps/web/src/lib/api/endpoints/inventory.ts`, but no component calls them —
  the same dead-hook pattern as purchase orders. With goods receipts unreachable
  too (§4.1), stock can never be anything but zero, and an opening stock count
  cannot be entered.
- **Dispatching 500 units with zero stock raised no warning** and moved no stock.

---

## 8. What works well

Worth recording, because most of the sales side is genuinely strong:

- **The quote editor.** Sections, notes, per-line discounts, billing schedules
  (deposit / per-delivery / custom stages), a live financial summary, draft →
  approval → confirmed states, attachments and an activity log.
- **Its honesty about margin.** Rather than showing a confident wrong number, it
  says the margin is an over-estimate because the lines were typed by hand. More
  products should do this.
- **The order-to-cash chain.** Approving the quote raised SO-2026-0001 and
  INV-2026-0001 automatically; the customer accepted through a clean public page;
  payment, delivery note DN-2026-0001, dispatch and fulfilment all worked in one
  pass without a single error.
- **The customer acceptance page** — name, explicit consent tick, the button
  disabled until both are given, and a clear confirmation afterwards.
- **Roles & permissions.** Every permission shown as a human sentence with its
  code underneath, system roles locked, custom roles supported. Better than most
  products several times this size.
- **The audit trail**, filterable by record type and by whether a person or the
  AI made the change, with before/after fields.
- **Empty states**, where they exist, say what to do next rather than just "no
  data" — the catalog picker and the purchase orders page explain exactly what is
  missing. The problem is that the actions they name do not exist.

---

## 9. Verdict: can a business be run on this?

**Not yet — it can sell, but it cannot buy, make, cost or account.**

Worked through as an owner, the product splits cleanly in two. The quote-to-cash
path is real, polished, and would stand up to daily use. Everything behind it is
either unreachable from the interface or never reaches the ledger.

What a business **can** do today: add customers and contacts, write and approve
quotes, have customers accept them online, raise sales orders and invoices,
record payments against them, ship with delivery notes, invite staff and control
permissions precisely, and see an audit trail of all of it.

What it **cannot** do:

| Operation | Status |
| --- | --- |
| Set up its own company details, tax number, logo | **No screen or API exists** (§5.1) |
| Define products, materials, work centres, tooling | **No screen exists** (§2.1) |
| Quote from a cost model — the headline feature | **Blocked by the above** (§2.1) |
| Know the margin on a job | **Always an over-estimate; cost is always 0** (§2.2) |
| Plan or run production | **Blocked; Production module unreachable** (§2.2) |
| Raise a purchase order | **No screen exists** (§4.1) |
| Enter a supplier bill, or owe a supplier money | **Reachable only from a PO** (§4.2) |
| Record any cost in the accounts | **Expense claims never post** (§4.3) |
| Hold any stock | **Requires a goods receipt against a PO** (§7.6) |
| Produce a correct P&L or balance sheet | **No costs; opening balances missing** (§3.1, §4.3) |
| Charge a tax rate it configured | **Quote tax list is hardcoded** (§6.1) |

There is also a commercial consequence worth naming: the Growth plan at
$39/seat/month advertises "Purchasing, stock and bills" and "Production and work
orders" — the two modules that cannot be used at all.

The through-line is a single pattern, and it is a hopeful one: in almost every
case the API, the DTOs and even the web client's own hooks are finished, and only
the screen is missing. `useCreatePurchaseOrder`, `inventory.adjust`,
`setReorderLevels` and the entire catalog write API are built, typed and unused.
This reads like a product whose back end ran ahead of its front end, not one with
deep design problems.

Suggested order of work, by how much each unblocks:

1. **A catalog screen** — materials, work centres, tooling, product templates.
   One screen turns cost-model quoting, real margin, production and BOM-driven
   stock from unreachable into working. It is the feature the product is sold on.
2. **A company profile page** — name, address, tax number, logo, invoice footer.
   Small, and required before any document can legally be sent to a customer.
3. **Make expense claims post to the ledger**, and post bank opening balances.
   Until then every financial statement the product produces is wrong.
4. **A "New purchase order" screen**, wiring up the hook that already exists.
   This alone opens goods receipts, bills, payables and stock.
5. **Fix the session refresh**, so people are not signed out every 15 minutes.
6. **Replace the fabricated dashboard and cashflow widgets** with real queries, or
   with honest empty states like the ones the customers page already has.
7. Then the configuration mismatches (§6) and the customer detail page (§7.2).

None of this contradicts `docs/FLAGS.md`, which records trade-offs the team took
knowingly. These are the gaps a paying customer meets on their first day.
