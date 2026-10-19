# UAE FTA VAT compliance: tax invoices, VAT201, reverse charge and the audit file

Date: 2026-10-19
Status: Draft design, awaiting builder check and approval
Follow-up project (not this one): UAE e-invoicing (PINT AE over Peppol via an Accredited Service Provider), which depends on this.

## Why

Kerf's customers are UAE contractors and trading firms, some below the AED 50M e-invoicing threshold and some above it. Payroll is already UAE-compliant (WPS, GPSSA, gratuity); tax is not. The tax engine today is a generic, EU-shaped model: codes, country rules and a net-payable report. A UAE business using Kerf cannot file its VAT return from Kerf, its invoices are missing fields the FTA requires (so its B2B customers can be refused input-tax recovery on audit), purchase reverse charge and imports post nothing, and there is no FTA Audit File. "Properly comply" means a tenant can run its UAE VAT entirely from Kerf and survive an FTA audit with what Kerf produces.

## Goals

1. **FTA-valid documents.** Tax invoices, simplified tax invoices and tax credit notes carry every field the Executive Regulation requires, in AED where the document is in another currency.
2. **VAT201 return.** Generated per tax period, with boxes 1a–1g split by the emirate of the issuing branch, drill-down from every box to its documents, reconciled to the ledger, and a filed period locks.
3. **Purchase reverse charge and imports.** Both post a self-assessed output and input pair and land in the right VAT201 boxes.
4. **FTA Audit File (FAF).** Exported for any date range in the FTA's CSV layout.
5. **Correct by default.** A UAE tenant gets the right tax codes, rules and VAT201 mapping on signup without configuring anything.

## Non-goals

- E-invoicing (next project). Nothing here should make it harder: keep structured per-line tax data, TRNs and emirates as first-class fields.
- Corporate tax.
- Tax groups (several legal entities under one TRN).
- Designated zones, profit margin scheme, tourist refund scheme (box 2), capital assets scheme, bad debt relief, box 7 (import adjustments).
- Direct submission to EmaraTax. The FTA offers no filing API; the return is keyed in by hand from Kerf's figures.
- Arabic invoices. English is accepted; Arabic is only on FTA request.
- Advance payments received before any invoice. Kerf has no such flow (deposits are already invoiced). Flag it in `docs/FLAGS.md`.
- Changing non-UAE behaviour. The EU engine, reverse charge on EU sales and the existing tax report keep working exactly as now for tenants whose organisation country is not `AE`.

## Anti-goals (would be a failure even if it technically works)

- An invoice Kerf calls a "Tax Invoice" that is missing a mandatory field for that customer type.
- A VAT201 figure that cannot be traced to documents, or that disagrees with the ledger without Kerf saying so.
- A filed period whose figures can change silently afterwards.
- Single-office tenants having to understand branches to keep working.

## Decisions taken with the user

| Decision | Choice |
|---|---|
| Scope | Items 1–4 above now; e-invoicing next; corporate tax out |
| Branches | Some tenants trade from branches in several emirates. Branches are a first-class record; boxes 1a–1g are allocated by the issuing branch's emirate |
| Strictness | Depends on the customer's VAT status. *Registered* customer: issuing is refused without a valid TRN. *Not registered* and *outside the UAE*: never blocked. Everything else warns, never blocks |
| Suppliers | Same pattern. A bill from a registered supplier with no valid TRN can be recorded, but its input VAT is "not recoverable until a valid tax invoice is held" and stays out of box 9 until fixed |

Everything else below marked **(call)** is the designer's call, made to fit the above; the builder may revisit those with a reason.

## 0. UAE VAT mode

UAE behaviour switches on per tenant when `organization.country = 'AE'` and `organization.taxId` is a valid TRN. Call this "UAE VAT mode". Without a TRN the tenant is treated as not VAT-registered: invoices print "Invoice", not "Tax Invoice", and charge no VAT unless the tenant has configured codes themselves (unchanged behaviour). **(call)** UAE VAT mode requires `baseCurrency = 'AED'`; enabling it with another base currency is refused with an explanation, because every FTA figure is in AED and the ledger's base-currency figures are what the return reconciles to. Signup defaults `baseCurrency` to AED when the country is AE (today it defaults to USD). Existing AE tenants on another base currency cannot change it once anything is posted (FLAGS.md); this project does not solve that — add a FLAGS.md entry, and if such tenants turn up, AED reporting beside the base currency is a separate project.

### Switching on

**(decided with user)** A tenant entering UAE VAT mode picks a VAT start date, which must be the start of a tax period and defaults to the next full period. Kerf generates returns from that period on; earlier periods are assumed filed elsewhere and nothing before the start date is reconstructed. Consequences:
- No backfill of snapshots, AED line figures or tax-point dates for old documents; only `branchId` (head office) and customer/supplier `vatStatus` are backfilled.
- `TAX_RECOVERABLE` starts empty; the ledger reconciliation compares period movements, so historic input VAT sitting in `TAX_PAYABLE` does not break it.
- A credit note issued after the start date against an older invoice takes its snapshot from the invoice where present and the customer record otherwise, and the head-office branch.
- Invoices issued between switch-on and the start date behave as UAE documents (tax invoice format, blocking) but are not in any Kerf return.

**TRN validation** lives in `packages/shared` (one function used by zod schemas and services): exactly 15 digits after stripping spaces and dashes; stored normalised (digits only). **(call)** Do not enforce a leading `100`; FTA has not published the structure and a false rejection blocks issuing. No live FTA lookup (no public API).

## 1. Data model

All new tables are tenant-scoped with the same RLS policy pattern as existing tenant tables; schema changes go through migrations (`pnpm migration:generate`), and the drift check must stay green. New document types and settings rows get one line in `modules/audit/audit-subjects.ts`. New permissions are added to `packages/shared/src/rbac/permissions/` (the directory that replaced `permissions.ts`), never hand-written.

### `branches` (new)

`id, tenantId, name, addressLine1, addressLine2, city, emirate, isHeadOffice (bool), invoicePrefix (varchar, nullable), isActive, createdAt, updatedAt`.

- `emirate` is an enum shared in `packages/shared`: `AUH, DXB, SHJ, AJM, UAQ, RAK, FUJ` (box order 1a–1g). Required in UAE VAT mode.
- Exactly one head office per tenant (partial unique index). The migration creates one "Head office" branch per existing organisation, copying the org address; its emirate is inferred from `organization.region`/`city` when it matches an emirate name, otherwise null and the tax settings page asks for it before the first VAT201 can be generated.
- **(call)** Branches share the organisation's TRN (VAT registration is per legal entity). No per-branch TRN.
- **Numbering (call):** when `invoicePrefix` is set, invoices and credit notes from that branch use their own counter, `INV-DXB-2026-0001`; otherwise the tenant counter as today. The counter key extends the existing `tenant-sequence.util.ts`. Numbers are never reused, including after void.
- **Which branch a user issues from (call):** a nullable `defaultBranchId` on the user's membership; falls back to head office. Single-branch tenants never see a branch picker (anti-goal 4).
- Managed under organisation settings with the existing org-settings permission.

### Organisation

- `taxId` holds the TRN (validated in UAE VAT mode).
- New `vatSettings` (either columns or a `vat_settings` one-row table, builder's choice): `periodFrequency ('MONTHLY' | 'QUARTERLY')`, `firstPeriodStart (date)` — the stagger is defined by the first period's start, and periods tile forward from it; `registrationDate (date)`; `taxAgentName`, `taxAgencyName`, `tan`, `taan` (optional, printed in the FAF).

### Customers and suppliers

- New `emirate` (same enum, nullable; shown only when country is AE).
- New `vatStatus`: `'REGISTERED' | 'NOT_REGISTERED' | 'OUTSIDE_UAE'`.
  - Defaults: country not AE → `OUTSIDE_UAE`; AE with a valid TRN → `REGISTERED`; otherwise `NOT_REGISTERED`. The form sets it automatically when a valid TRN is entered or the country changes, and the user can override (e.g. mark registered before the TRN arrives — which then blocks issuing, by design).
  - Migration backfills from existing `country` and `taxId`.
- `taxId` validated as a TRN when country is AE; free text otherwise (existing behaviour).
- `country` on customers is varchar(80) normalised to ISO-2 by the existing `countryCodeField`; leave as is.

### Tax codes: a VAT treatment

Rate alone cannot tell zero-rated from exempt from out of scope, and VAT201 boxes depend on exactly that. Add `treatment` to `TaxCode`:

| Treatment | Kind | Rate | VAT201 |
|---|---|---|---|
| `STANDARD` | SALES | 5 | 1a–1g by branch emirate |
| `ZERO_RATED` | SALES | 0 | 4 |
| `EXEMPT` | SALES | 0 | 5 |
| `OUT_OF_SCOPE` | SALES / PURCHASE | 0 | not reported |
| `REVERSE_CHARGE` | SALES | 0 | not reported; see note on domestic reverse charge |
| `STANDARD` | PURCHASE | 5 | 9 (only when recoverable) |
| `ZERO_RATED` / `EXEMPT` | PURCHASE | 0 | not reported |
| `BLOCKED` | PURCHASE | 5 | not reported; VAT expensed |
| `REVERSE_CHARGE` | PURCHASE | 5 | output in 3, input in 10 |
| `IMPORT_GOODS` | PURCHASE | 5 | output in 6, input in 10 |

- Nullable for non-UAE tenants; required for any code used in UAE VAT mode (the VAT201 refuses to generate if a document in the period carries an untreated code, and lists them).
- Existing `isReverseCharge` stays and is derived for UAE codes (`treatment = REVERSE_CHARGE`), so the EU path is untouched.
- Unlike today, a UAE purchase reverse-charge or import code carries rate 5 (the self-assessed rate); the existing "reverse charge must be 0%" check applies to SALES only in UAE VAT mode.
- **Domestic reverse charge** (gold, diamonds, hydrocarbons, and since October 2025 phones, computers and tablets sold to registered resellers) — **(call, user did not confirm either way)** out of scope for this project. The `REVERSE_CHARGE` sales treatment exists only so a tenant can print the domestic reverse-charge notice; it reports nowhere in the VAT201. Flag in FLAGS.md as the first follow-up if an electronics or gold trader signs up. Keep the treatment enum open so it can be added without a migration of existing codes.
- **Sales outside the UAE** are zero-rated exports or standard-rated, never reverse-charged by a UAE supplier, and the invoice carries no reverse-charge statement. The seeded `*` → `ZR` rule is a default; issuing a ZERO_RATED services line to an OUTSIDE_UAE customer shows a warning that export-of-services zero-rating has conditions (recipient not resident and not in the UAE at the time of supply) the user must be satisfied are met.

### Seeding UAE codes and rules

When an org enters UAE VAT mode (signup with country AE, or later setting a TRN), seed if absent, idempotently:

- SALES: `SR` 5% STANDARD, `ZR` 0% ZERO_RATED, `EX` 0% EXEMPT, `OS` 0% OUT_OF_SCOPE.
- PURCHASE: `SR` 5% STANDARD, `ZR`, `EX`, `BL` 5% BLOCKED, `RC` 5% REVERSE_CHARGE, `IM` 5% IMPORT_GOODS.
- Rules: SALES `AE` → `SR`; SALES `*` → `ZR` (exports; the user may change). PURCHASE `AE` → `SR`; PURCHASE `*` → `RC` (imported services; goods imports pick `IM` on the bill).
- Existing `ZERO` code from `provisionStarterTaxCodes` gets `treatment = ZERO_RATED`.

### Documents

**Invoice**
- `branchId` (not null after backfill to head office), `supplyDate` (date, nullable), `taxPointDate` (date, not null for new rows) = earliest of `supplyDate` and issue date. **(call)** Issue date is `issuedAt` (insert time); `taxPointDate` is what the VAT201 and the ledger entry use.
- **Where branch and supply date come from (call).** Invoices are raised automatically (quote approval and customer signing, including the Temporal path; delivery dispatch; `raiseStageInvoice`), so there is often no acting user. `branchId` lives on the quote (defaulted from the creator's default branch, editable while the quote is a draft) and is copied to the order and every invoice and credit note from it. `supplyDate` is not entered by users in this project: delivery invoices use the dispatch date; stage invoices use the issue date.
- **(call)** The fx rate, the posting and the AED figures all use `taxPointDate` (the FTA values the supply at the date of supply). For stage invoices that is the issue date, so nothing changes; delivery invoices take the rate at dispatch.
- Snapshot at issue (immutable afterwards): `customerTrn`, `customerAddress` (lines, city, emirate, country), `customerVatStatus`, `sellerTrn`, branch name/address/emirate. The FTA needs what was on the invoice, not what the customer record says today.
- `documentKind`: `'TAX_INVOICE' | 'SIMPLIFIED_TAX_INVOICE' | 'INVOICE'` decided at issue (section 2).
- `taxBreakdown` already exists; in UAE mode each line also stores `vatAed` and `netAed` (base-currency figures at the posting rate) so the PDF, VAT201 and FAF never re-round.

**Credit note** — same additions (`branchId` = the invoice's branch, snapshot, `taxPointDate` = issue date), plus `reason` (required in UAE mode). It always references its invoice (already true).

**Supplier bill**
- **(call)** One treatment per bill, as today (one `taxCodeId`). A supplier document that mixes treatments (goods imported plus local freight, partly blocked items) is entered as two bills against the same supplier invoice number; the duplicate-number check allows that when the codes differ. Per-line purchase tax is a follow-up in FLAGS.md. The FAF purchase listing is therefore one row per bill.
- `branchId`, `supplierTrn` snapshot, `supplierVatStatus` snapshot, `taxPointDate` = `billDate`.
- `customsDeclarationNumber` (required for `IMPORT_GOODS`) and `importVatBase` (AED; the customs value plus duty, which can differ from the bill amount; defaults to the bill net).
- `inputVatRecoverable` (bool, computed): false when the supplier is `REGISTERED` and no valid TRN is on the bill, when the code is `BLOCKED`, or when the treatment is zero/exempt. Recomputed when the TRN is corrected; see section 4.
- **(call)** Bill tax stays typed in (it must match the supplier's document), but in UAE mode Kerf warns when it differs from 5% of net by more than AED 1.

**Expense claim (call):** add an optional purchase `taxCodeId`, `taxAmount`, `supplierName`, `supplierTrn` per claim, persisting what the receipt scanner already extracts. Claims with a valid TRN and a STANDARD code feed box 9; without a TRN the VAT is recorded but not recoverable (a simplified invoice under AED 10,000 carries the supplier TRN, so the TRN is still required for recovery). Expense claims already post at face value in non-base currencies (open in FLAGS.md); in UAE mode, claims in another currency must convert through `fxRateFor` before they can count.

## 2. FTA-valid documents

### Choosing the document kind at issue

In UAE VAT mode, at issue:

| Customer VAT status | Total incl. VAT | Kind | Blocks? |
|---|---|---|---|
| REGISTERED, valid TRN | > AED 10,000 | Tax Invoice | no |
| REGISTERED, valid TRN | ≤ AED 10,000 | Tax Invoice (**call**: never simplified to a registered customer — they need the full one for recovery) | no |
| REGISTERED, missing/invalid TRN | any | — | **yes**: "Add a valid TRN for <customer> or change their VAT status" |
| NOT_REGISTERED | any | Simplified Tax Invoice (**call**: always simplified; the law allows it for any value when the recipient is unregistered) | no |
| OUTSIDE_UAE | any | Tax Invoice (zero-rated export lines say so) | no |

Tenant not in UAE VAT mode: unchanged ("Invoice").

**Warnings (never block):** issue date more than 14 days after `supplyDate` (the FTA deadline); a line with a STANDARD code to an OUTSIDE_UAE customer; a ZERO_RATED line to a UAE customer; customer in the UAE with no emirate.

**Where the block lands (decided with user).** Invoices are raised as side effects of quote approval, customer signing, delivery dispatch and stage billing, so failing at issue would break a customer's signature or a dispatch. Instead:
1. **Early block:** sending a quote for signature, approving it, and converting it to an order are refused for a REGISTERED customer without a valid TRN ("Add a valid TRN for <customer> or change their VAT status"). The check lives in the quote/order services, so the assistant and automations hit it too.
2. **Held, not failed:** if an invoice is still due to be raised for such a customer (TRN removed or status changed after approval), `issueInvoice` does not throw. It leaves the stage or delivery un-invoiced, records why, and lists it under "Invoices on hold" on the tax page and the order. Fixing the TRN offers "Raise held invoices". The Temporal activity treats a hold as success, so it never retries forever.

Staged billing (deposit, milestone, final) and per-delivery invoices are all real tax invoices and get the same treatment.

### Content

The renderer gets a UAE layout driven by `documentKind`. Fields per Executive Regulation (builder to check each against the current text of the regulation before shipping and cite the article in a code comment):

**Tax Invoice:** title "Tax Invoice" prominently; seller legal name, branch address, TRN; customer name, address, TRN; invoice number; issue date; date of supply if different; per line: description, quantity, unit price, discount, net, VAT rate, VAT amount; totals net, VAT, gross; when the currency is not AED, VAT and gross also in AED with the exchange rate used; a zero-rating statement on export lines (no reverse-charge statement on exports).

**Simplified Tax Invoice:** title "Tax Invoice" (the FTA's simplified invoice keeps that title — **builder to confirm**), seller name, address, TRN, number, date, description, total consideration and VAT.

**Tax Credit Note:** title "Tax Credit Note"; seller and customer details and TRNs; credit note number and date; original invoice number and date; value of the original, the corrected amount, the difference and the VAT on it; reason; AED figures with rate when foreign currency.

Changes this needs in the existing pipeline (gaps found today):
- `InvoicesService.getPdf` fills `party.taxId` and `party.address` from the snapshot (they are dropped today).
- The tax totals use `taxBreakdown` per rate instead of one `{rate: 0, label: 'Tax'}` entry.
- `fxRate` and AED figures reach the document data.
- A `CREDIT_NOTE` document type in the template schema, a credit-note PDF route, and its renderer path.
- The fallback renderer (`invoice-pdf.service.ts`) gets the same title and fields or is retired for UAE tenants.
- The reverse-charge notice is generated from the breakdown, not appended to `notes` at issue.
- Template customisation cannot remove a mandatory field in UAE mode (custom labels may rename "Tax Invoice" only by adding Arabic alongside, not replacing it).

**Exchange rate (builder to verify):** the FTA requires the UAE Central Bank rate. Check what `fxRateFor` uses; if it is not the CBUAE rate, say so in FLAGS.md and print the rate source on the invoice. Do not build a CBUAE feed in this project.

## 3. Ledger

- Add an account role `TAX_RECOVERABLE` (`2210 VAT recoverable`, or an asset-side code consistent with the chart) seeded for every tenant. **(call)** Separating input from output VAT makes the ledger reconcile box by box; non-UAE tenants get it too but nothing posts there unless a purchase code points at it.
- Bills: the tax debit goes to the purchase code's `ledgerAccountId`, else `TAX_RECOVERABLE` (today it always goes to `TAX_PAYABLE` and ignores the code).
- `BLOCKED` codes and non-recoverable bills: the VAT is debited to the bill's expense account, not to `TAX_RECOVERABLE`. When a bill becomes recoverable later (TRN added), post a reclass entry dated the day it is fixed (so it lands in the current open period, not the filed one).
- Reverse charge and imports: the bill posts Dr `TAX_RECOVERABLE` (if recoverable) / Cr `TAX_PAYABLE` for 5% of net (imports: of `importVatBase`), on top of the normal bill entry. Nothing extra is paid to the supplier.
- Invoices and credit notes post at `taxPointDate` (today they post at `new Date()`).
- Bills post at `billDate` (unchanged). The VAT201 counts bills by `billDate`, aligning with the ledger (today the report uses `approvedAt`, which disagrees with the ledger). Unapproved bills do not count.
- Void after filing: an invoice whose `taxPointDate` falls in a filed period cannot be voided; the user issues a credit note instead (credit notes land in the open period).

## 4. VAT201 return and periods

### `vat_returns` (new)

`id, tenantId, periodStart, periodEnd, status ('DRAFT' | 'FILED'), boxes (jsonb snapshot when filed), filedAt, filedBy, ftaReference (text, optional — the EmaraTax submission number), notes, reopenedAt, reopenedBy, reopenReason`. One row per period; periods come from `vatSettings`.

### Generating

`GET /finance/vat-returns/:periodStart` computes live for a DRAFT period. Box mapping (UAE VAT201 as of writing — builder to confirm box numbers against EmaraTax before shipping):

| Box | Source |
|---|---|
| 1a–1g | STANDARD sales lines on invoices minus credit notes issued in the period (whatever period the original invoice was in), by `branch.emirate`; amount and VAT. The adjustment column is for bad-debt relief (a non-goal) and stays zero — builder to confirm against the FTA VAT201 guide |
| 3 | REVERSE_CHARGE purchase bills: net and VAT |
| 4 | ZERO_RATED sales (incl. exports) net |
| 5 | EXEMPT sales net |
| 6 | IMPORT_GOODS bills: `importVatBase` and VAT |
| 8 | Totals of 1–7 |
| 9 | STANDARD purchases (bills and expense claims) where recoverable: net and VAT. Zero-rated, exempt, out-of-scope, blocked and non-recoverable purchases are not reported |
| 10 | REVERSE_CHARGE + IMPORT_GOODS recoverable VAT |
| 11 | Totals of 9–10 |
| 12 | Total due tax |
| 13 | Total recoverable tax |
| 14 | Payable (negative is refundable) |

All figures are AED from the stored per-line AED amounts; rounding per box to the fils. Documents count by `taxPointDate` within the period.

**Drill-down:** every box lists its documents (number, date, party, TRN, net, VAT) and links to them.

**Exceptions panel** (shown before filing, never silently swallowed):
- Documents with untreated codes (blocks generating).
- Bills with non-recoverable VAT because of a missing TRN (with a "fix TRN" link).
- Invoices issued more than 14 days after supply.
- UAE customers on STANDARD lines with no emirate (informational — allocation uses the branch, not the customer).
- Head office/branches with no emirate (blocks generating).

**Ledger reconciliation:** the return shows the period movement on `TAX_PAYABLE` and `TAX_RECOVERABLE` beside boxes 12 and 13 and lists unexplained differences (e.g. manual journals to the VAT accounts). A difference warns, never blocks.

### Filing and locking

- **Mark as filed** (`POST /finance/vat-returns/:periodStart/file`, new permission `tax:file`): snapshots the boxes, records `ftaReference` and locks the period.
- **Lock:** no invoice, credit note, bill or expense claim with `taxPointDate` in a filed period can be issued, approved, voided or edited, and no journal entry can post to the VAT accounts in it. Enforced in the services through one shared guard (`assertTaxPeriodOpen(tenantId, date)`), not the controllers. Back-dating into a filed period fails with the period and a hint to date it today.
- **Credit notes are not corrections.** A credit note is an adjustment event accounted for in the period it is issued, whatever period its invoice was in. No voluntary-disclosure test applies to it.
- **Errors (call).** A genuine error in a filed period (wrong code on an issued invoice, a bill that was missed) is fixed with a **VAT error correction**: a new document (`vat_corrections`: period corrected, box, net and VAT difference, reason, linked documents) dated in the open period. The original documents stay as filed; a missed bill is entered with its true `billDate` but counted via the correction, not by reopening the period. Kerf totals the net VAT effect of the corrections for each filed period: up to AED 10,000 they flow into the current return; over AED 10,000 they are excluded from the return and Kerf says a voluntary disclosure is required for that period, listing the figures to enter in EmaraTax. Mark the disclosure as submitted with its reference.
- **Reopen (call):** only to undo a "Mark as filed" made by mistake before submission. `tax:file` holders can reopen with a mandatory reason (audited); the UI warns that if the return was already submitted to the FTA, the right path is an error correction. Refiling replaces the snapshot; history stays in the audit log.
- First period: periods before `registrationDate` are not generated.

### UI

Under Finance → Tax, UAE tenants get a "VAT returns" tab: list of periods with status and payable; a return page laid out like the EmaraTax VAT201 form (same box order and labels) with copy buttons per figure; drill-downs; exceptions; reconciliation; "Mark as filed". Settings get a VAT section (TRN, frequency, first period, registration date, branches). Gated with `tax:read` / `tax:manage` / `tax:file`.

The existing generic tax report stays for non-UAE tenants.

## 5. FTA Audit File (FAF)

`GET /finance/vat/faf?from&to` (permission `finance:export`), returns the FAF as a single CSV file in the FTA's layout, with these sections in order, each followed by its totals row:

1. **Company information** — legal name (EN; AR blank unless set), TRN, tax agency/agent names and TAN/TAAN, period start/end, file creation date, product name and version ("Kerf"), FAF version.
2. **Purchase listing** — one row per bill line / expense claim: supplier name, supplier TRN, invoice date, supplier invoice number, permit/customs declaration number, transaction id, line number, description, purchase value AED, VAT AED, tax code, currency, value and VAT in that currency.
3. **Supply listing** — one row per invoice and credit note line: customer name, customer TRN, invoice date, invoice number, permit number, transaction id, line number, description, supply value AED, VAT AED, tax code, country, currency, value and VAT in that currency. Credit notes as negative rows.
4. **General ledger** — every journal line in the range: date, account id and name, description, party name, transaction id, source document id and type, debit, credit, running balance per account.

The **exact column names, order, delimiter, date format and totals rows must come from the current FTA "FAF User Guide"** — the builder fetches it and pins it in a spec file; the list above is the content, not the format. Reuse the CSV escaping and formula-injection guard in `reports.service.ts` `toCsv`. Data comes from the issue-time snapshots, never live customer records. Large ranges stream rather than build in memory.

Also add a general-ledger CSV export to the existing reports (the FAF GL section and it share one query) — there is none today.

**Record retention:** documents and their PDFs are kept at least 5 years (15 for real estate). Kerf deletes nothing today; add a FLAGS.md note that any future deletion/archival must respect this.

## 6. Other paths that must respect all of the above

- The in-app assistant and automations issue invoices through the same services, so the block, the snapshot and the period lock apply automatically. Check every `issueInvoice` call site, delivery-note invoicing, recurring billing and credit-note issue.
- Quote editor: in UAE mode, show the customer's VAT status and the document kind the invoice will be issued as, and warn early if the customer is REGISTERED with no TRN (the block itself is at issue).
- Customer and supplier forms: emirate field, VAT status, TRN validation with an inline message.

## Testing expectations

- Shared: TRN validation; document-kind decision table; box mapping from a fixture set of documents covering every treatment, every emirate, a foreign-currency invoice, a credit note against a prior-period invoice, a blocked purchase, a non-recoverable bill fixed later, an import with `importVatBase` ≠ net.
- API: quote send/approve/convert blocked for REGISTERED without TRN (through the service, the assistant path and an automation path); an invoice due by customer signing or dispatch for such a customer is held, not failed, and the Temporal activity completes; error corrections below and above AED 10,000; period lock refuses issue/void/approve/back-dated journal; VAT201 totals equal the ledger movement for the fixture; FAF section totals equal VAT201 boxes and ledger.
- Seed: the seed script gets one UAE tenant with two branches (Dubai, Abu Dhabi), registered and unregistered customers, a foreign supplier, and enough documents to produce a non-trivial VAT201. CI's trial-balance-sums-to-zero check must still pass.
- PDF: snapshot tests for tax invoice, simplified tax invoice and tax credit note, including a USD invoice with AED figures.

## Left to the builder

- Columns vs a settings table for `vatSettings`.
- Exact UI layout beyond "mirrors the VAT201 form".
- Whether `taxPointDate` is a stored column or computed (stored is preferred for indexing the return).
- How branch selection appears in the document editors for multi-branch tenants.
- Order of delivery; a reasonable split is (1) treatments, codes, TRN, VAT status, branches; (2) documents and PDFs; (3) ledger changes and reverse charge/imports; (4) VAT201 and locking; (5) FAF and GL export.

## Facts to verify against primary sources before shipping

The design states UAE VAT rules as understood on 2026-10-19. Each of these must be checked against the current Federal Decree-Law on VAT, its Executive Regulation, and FTA guides, and cited in code comments: mandatory fields of each document type; simplified invoice title and conditions; 14-day issuing deadline; VAT201 box numbers and labels in EmaraTax; voluntary disclosure threshold (AED 10,000); emirate allocation rule; FAF layout; exchange-rate source; any 2026 amendments (e.g. to reverse-charge self-invoicing).
