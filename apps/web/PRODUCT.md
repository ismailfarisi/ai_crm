# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyone who works at a small, made-to-order manufacturer. All roles use the app every day, not just the office:

- the owner, who approves quotes and watches margin, cash and the books;
- sales and estimators, who answer enquiries and build costed quotes;
- production supervisors and operators, who run work orders and log time;
- storekeepers and buyers, who manage stock, purchase orders, goods receipts and supplier bills;
- accounts, who handle invoices, payments, expenses, bank reconciliation, VAT and payroll.

Roles decide what each person sees, down to "only my own customers". A customer who isn't a user opens a quote through a public link (`/q/[token]`) to review it and accept online.

## Product Purpose

Kerf runs a made-to-order business in one system, from the first WhatsApp enquiry to the final payment. It covers customers, costed quotes, production, stock and purchasing, and double-entry books. It replaces the usual mix of Excel quotes, WhatsApp threads, a separate accounting app and one person's memory, where every hand-off loses money.

Success means a shop quotes from what a job really costs, knows its margin before sending, and never re-types work between quote, work order, purchase and invoice.

## Positioning

**True Cost™.** Every quote starts from what the job costs to make, not from a price list. Kerf nests blanks on the board the shop actually buys, adds machine and labour time at the shop's own rates, and enforces margin floors and discount caps through approvals. Every line keeps the cost it was quoted at, and the costing-accuracy review compares quoted cost against actual.

A second strength is WhatsApp. Staff can run the shop from their own chat with Kerf, and anything beyond a draft waits for a human "yes" and is written to the audit trail.

It's one system instead of five, live in days rather than months, and priced for a 10-person shop.

## Operating Context

- **Industries:** packaging (rigid and corrugated boxes, labels, thermoformed), print, signage, fabrication, joinery and fit-out. The vocabulary is boards, sheets, blanks, dielines, jobs, work orders and margins.
- **Market:** early access for UAE manufacturers, concentrated in Sharjah, Ajman, Ras Al Khaimah and the Dubai industrial areas. Prices are in AED with UAE VAT, and other currencies are used for buying and quoting.
- **Devices:**
  - office desktops and laptops for long sessions;
  - phones in the field for the owner and sales;
  - shared tablets on the shop floor, near machines and in noisy, bright conditions.

  Every screen has to work on all three.
- **WhatsApp:** this is where customers and the floor already talk. Kerf never posts in a customer's thread. Staff talk to Kerf in their own chat with it, and the in-app assistant runs the same agent with the same approval rules.
- **Documents:** branded PDF quotes, sales orders, work orders, purchase orders, supplier invoices (read from PDF or photo), receipts, bank statements and VAT reports.

## Capabilities and Constraints

**Modules in the app today:** dashboard, shared inbox, contacts, customers, custom objects, quotes, orders, invoices, catalog (costing formulas, materials, rates, costing accuracy), production (work orders, time logging), inventory, purchasing (POs, bills with capture and three-way matching), finance (books, bank reconciliation with group matching, expenses, VAT), people and payroll, automations, the assistant, and settings.

**Constraints:**
- The app is English only today. Arabic is promised as "coming", so layouts must not rule out RTL later. Short sentences translate cleanly.
- Mutating AI actions always need approval, and every change is audited.
- Attachments are always served through short-lived signed links.

**Open:**
- the hosting region and UAE data residency;
- e-invoicing (Peppol);
- pricing figures.

## Brand Commitments

- **Name:** Kerf. ("Relay CRM" in older docs is a former name.)
- **Voice:** plain, confident and literate about the shop floor. Short sentences. Talk about boards, sheets, jobs and margins, never "synergies" or "revenue orchestration".
- **Claims:** every claim must map to something the product does today. Roadmap items are labelled as roadmap.
- **Owned concept:** True Cost™ is the named concept the brand owns.

## Evidence on Hand

- **Homepage copy and claims:** `docs/marketing/homepage-copy.md`.
- **Design-partner leads:** `docs/marketing/target-accounts.md` (unverified directory leads, not customers).
- **Demo and sample data:** Meridian Packaging Co is the demo or tutorial company and must be labelled as a demo. Al Noor Sweets and Q-1042 are sample figures, and their arithmetic must stay correct.
- **Usability findings:** `docs/BUSINESS-WALKTHROUGH.md`.
- **Absent, and never to be invented:** customer logos, testimonials, customer stories, benchmarks and published prices.

## Product Principles

1. **The number must be right.** Margin, cost, stock and the books are what the product is trusted for. A wrong or ambiguous figure in front of a customer is the worst failure.
2. **Nothing gets re-typed.** Work flows from enquiry to quote, order, work order, purchase and invoice, and each step starts from the last.
3. **People approve, Kerf does the work.** Drafts are free. Anything that changes data or reaches a customer waits for a person and leaves a record.
4. **Built for the whole shop.** The owner at a desk, the estimator on a phone and the operator at a tablet on the floor all get a screen that works for them.
5. **Shop-floor plain.** Use the trade's own words and short sentences, and nothing a 10-person shop would need a consultant for.
