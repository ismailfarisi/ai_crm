# Comparative Analysis: Attio CRM vs. Relay CRM

An exhaustive investigation comparing **Attio CRM** (https://attio.com/) with **Relay CRM**, evaluating feature parity, architectural trade-offs, operational reach, and strategic roadmap opportunities.

---

## 1. Executive Summary

| Dimension | Attio CRM | Relay CRM (Our Platform) |
| :--- | :--- | :--- |
| **Primary Category** | Modern, AI-Native B2B Revenue Platform (SaaS / PLG / Venture) | End-to-End Operational CRM & ERP (Made-to-Order Manufacturing, Physical Goods, High-Touch Operations) |
| **Core Value Prop** | "The CRM for agentic revenue" — flexible data model, zero data entry, real-time context | "Run the entire operating business" — from lead to costing, quoting, manufacturing, and general ledger |
| **Data Philosophy** | Dynamic, unopinionated relational database (Notion/Airtable style custom objects & attributes) | Strongly typed, domain-driven relational entities with strict transactional integrity |
| **Operational Reach** | Front-office sales pipeline only (stops at "Deal Won") | Full Quote-to-Cash (Quoting, BOM Costing, Work Orders, Inventory, Purchasing, Double-entry Ledger) |
| **AI Integration** | Ambient revenue agents, call intelligence, web scrapers, hosted **MCP server** | Domain conversational skills via chat channels (WhatsApp/Telegram), AI receipt parsing, AI document styling |
| **Workflow Engine** | Visual trigger-and-block canvas with JavaScript code steps | Enterprise-grade durable execution via **Temporal** (dynamic DAGs, human-in-the-loop approval signals) |
| **Field / Mobile Ops** | Web app & mobile companion optimized for desk sales | Multi-channel chat drivers (WhatsApp, Telegram) with conversational AI action skills |
| **Security & Isolation** | Proprietary cloud multi-tenant SaaS | Database-enforced Postgres Row-Level Security (`NOBYPASSRLS`), zero-trust per-request RBAC, global audit trail |
| **Deployment Model** | Cloud-only proprietary SaaS (per-seat monthly billing) | Self-hostable, private cloud deployable, complete data sovereignty |

---

## 2. High-Level Architecture Comparison

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ATTIO CRM (Front-Office Pipeline Specialist)                                  │
│                                                                              │
│  [Google / M365 Sync] ──> [Auto Enrichment] ──> [Custom Objects & Views]     │
│                                                          │                   │
│  [Call Intelligence] ────> [AI Revenue Agents] ──────────┼──> [Deal Won]     │
│                                                          │        │          │
│  [MCP Hosted Server] ────> [Sequences & Cadences] ───────┘        ▼          │
│                                                               (Handoff to    │
│                                                                external ERP/ │
│                                                                accounting)   │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ RELAY CRM (End-to-End Operational Spine)                                      │
│                                                                              │
│  [Contacts & Leads] ──────> [Costing Engine & BOM] ──> [Dynamic Quotes]      │
│            │                                                    │            │
│            ▼                                                    ▼            │
│  [WhatsApp / Telegram] ───> [Temporal Workflows] ────> [Public E-Sign Link]  │
│  (Conversational AI Skills)       │                             │            │
│                                   ▼                             ▼            │
│  [Inventory / Warehouse] <─── [Work Orders] <────────── [Sales Orders]       │
│            │                          │                         │            │
│            ▼                          ▼                         ▼            │
│  [Purchasing / Payables] ──> [Fulfillment/Dispatch] ──> [Double-Entry Ledger]│
│                                                         (P&L, COA, Cashflow) │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. What Important Features Relay is Missing (Attio Strengths)

Attio represents the state of the art in front-office relationship intelligence. The most valuable capabilities Attio has that Relay currently lacks include:

### 3.1. Dynamic / Flexible Relational Data Model
* **Attio:** Users can visually create custom objects (e.g. *Partners*, *Properties*, *Investors*, *Subscriptions*), attach custom fields (formulas, multi-select, currency, rollups, dynamic relations), and create arbitrary relational links without touching code.
* **Relay:** Rigid, code-defined relational schema (TypeORM entities: `Contact`, `Customer`, `Quote`, `Order`). Adding an attribute requires a database migration, shared package update, and frontend redeployment.
* **Impact:** High friction when an organization needs to store domain-specific attributes (e.g., machinery specs, customer packaging certifications, custom tiers).

### 3.2. Automated Two-Way Email & Calendar Sync ("Zero Data Entry")
* **Attio:** Native OAuth integration with Google Workspace and Microsoft 365. It silently indexes every inbound/outbound email and calendar event, links them to the matching contact/company timeline, tracks "connection strength" and "days since last touch", and allows reps to draft/send emails directly from within the CRM.
* **Relay:** Relay features transactional channel drivers (SES, Resend, SMTP) and a unified inbox, but **no passive background mailbox sync**. Interactions must be initiated through the platform or manually logged.
* **Impact:** Sales reps must manually copy context between their email client and the CRM.

### 3.3. Model Context Protocol (MCP) Server
* **Attio:** Attio provides an official hosted MCP server. Any AI assistant (Claude Desktop, Cursor, ChatGPT, custom LLM sidecars) can connect via OAuth to query records, search pipeline deals, log notes, and update fields using natural language.
* **Relay:** Relay possesses sophisticated domain skills internally (`quote-create`, `delivery-dispatch`, `inventory-query`), but **does not expose an external MCP server interface**.
* **Impact:** Relay cannot be controlled directly from external agentic environments (like developer IDEs or desktop AI tools).

### 3.4. Autonomous Data Enrichment & Web Agent
* **Attio:** Creating a record with a domain (e.g. `acme.com`) automatically enriches logo, headcount, industry, funding history, and LinkedIn profiles. Its built-in **Web Agent** autonomously navigates company websites and search engines to populate missing CRM fields.
* **Relay:** Reps must manually key in contact and company details (name, email, phone, billing address, tax ID).
* **Impact:** Slower record creation and higher risk of stale or incomplete account data.

### 3.5. Native Meeting & Call Intelligence
* **Attio:** An integrated meeting recorder joins Zoom, Google Meet, or Microsoft Teams, transcribes calls across 100+ languages, extracts buyer objections and competitor mentions, identifies action items, and attaches summaries to the deal timeline.
* **Relay:** No audio/video call capture, transcription, or automatic meeting summarization.

### 3.6. Multi-Touch Sales Sequences & Cadences
* **Attio:** Built-in outbound sequencing engine supporting scheduled email drips, automated follow-ups based on open/click/reply triggers, and multi-step touchpoints.
* **Relay:** We have a dynamic DAG workflow engine, but no pre-built sales development sequence builder for SDRs.

### 3.7. Notion-Grade Customizable Views & Dashboards
* **Attio:** Highly fluid spreadsheet-like table and Kanban boards with inline cell editing, customizable columns, grouping, multi-property filters, and Excel-like formula fields.
* **Relay:** Fixed tables and dashboard cards. Filtering is basic and views cannot be customized or saved per user.

---

## 4. What is Vastly Better in Ours (Relay Strengths)

Where Attio stops at sales pipeline tracking, Relay is built to run the actual operating business. Once a deal is won, Attio requires handoffs to third-party tools, whereas Relay handles the entire operational and financial execution.

### 4.1. Complete Quote-to-Cash & Real-World Operations (ERP + CRM)
* **The Reality:** Attio has no concept of what a product actually costs to make, how it is manufactured, or how it is delivered.
* **Relay's Advantage:**
  * **Costing & Bill of Materials (BOM):** Custom formulas, material costs, labor rates, and machine runtime calculations that ensure quotes have guaranteed gross margin (`packages/shared/src/costing`).
  * **Production & Shop Floor:** Work orders, operational steps, scheduling, and labor time-logging (`apps/api/src/modules/production`).
  * **Inventory & Warehouses:** Multi-location stock levels, reorder points, and inventory reservations (`apps/api/src/modules/inventory`).
  * **Purchasing & Accounts Payable:** Supplier purchase orders generated directly from quote requirements (`apps/api/src/modules/purchasing`).
  * **Fulfillment & Logistics:** Delivery dispatch tracking and order fulfillment.

### 4.2. Audit-Grade Double-Entry Bookkeeping & General Ledger
* **The Reality:** Attio tracks arbitrary deal amounts; it has zero accounting or financial reconciliation capabilities.
* **Relay's Advantage:**
  * A true double-entry accounting engine (`apps/api/src/modules/finance`) with a standard Chart of Accounts (COA), journal entries, automated trial balance drift checks (`pnpm check:books`), Opening Balance Equity, Cashflow tracking, Accounts Receivable/Payable, Tax rules (`apps/api/src/modules/tax`), and Credit Notes.
  * Guarantees that every invoiced dollar, payment, credit note, and expense reconciles with zero drift.

### 4.3. Conversational Field Operations (WhatsApp & Telegram AI Agents)
* **The Reality:** Attio is designed for desk-bound software sales reps on laptops.
* **Relay's Advantage:**
  * Native drivers for **WhatsApp** (Meta Graph API) and **Telegram** via `apps/api/src/modules/channels`.
  * Conversational AI agents equipped with business domain skills:
    * Create quotes on the go (`quote-create.skill.ts`)
    * Approve quotes via chat (`quote-approve.skill.ts`)
    * Log production work-order hours from the factory floor (`work-order-log-time.skill.ts`)
    * Trigger delivery dispatches via messaging (`delivery-dispatch.skill.ts`)

### 4.4. Enterprise-Grade Fault-Tolerant Orchestration (Temporal)
* **The Reality:** Attio uses a proprietary workflow runner susceptible to timeouts and state loss during long-running approvals.
* **Relay's Advantage:**
  * Powered by **Temporal** (`apps/api/src/modules/temporal`), the enterprise standard for durable, distributed workflow execution.
  * Complex multi-week approval cycles, invoice escalation ladders, and dynamic DAG workflows (`dynamicDagWorkflow`) resume seamlessly across server reboots, network partitions, and deployments.

### 4.5. Defense-in-Depth Security, RLS & Complete Data Sovereignty
* **The Reality:** Attio is cloud-only SaaS where customer data is locked into proprietary infrastructure with per-seat pricing.
* **Relay's Advantage:**
  * **Postgres Row-Level Security (RLS):** Database-enforced tenant boundaries using non-superuser roles (`NOBYPASSRLS`). Even a compromised SQL query cannot leak cross-tenant records.
  * **Zero-Trust RBAC:** Server-side permission evaluation on every single request (`RbacService.resolveAccess` with 5s cache); tokens carry identity only.
  * **Global Audit Interceptor:** Global `AuditInterceptor` captures before-and-after snapshots of every mutated entity without manual instrumentation.
  * **Self-Hostable:** Can be deployed in private clouds (Docker, Kubernetes) for high-compliance manufacturing and enterprise defense.

---

## 5. Strategic Recommendations & Roadmap

To bridge the gap with Attio while doubling down on Relay's operational strengths, the following initiatives offer the highest return on investment:

### Milestone 1: High-Impact Quick Wins
1. **Relay MCP Server:**
   * Package Relay's existing domain skills (`quote-create`, `delivery-dispatch`, `inventory-query`, `customer-search`) into a standardized Model Context Protocol (MCP) server.
   * Enables users to query stock, check customer balances, and create quotes directly from Claude Desktop or Cursor.
2. **Flexible Metadata (JSONB Custom Fields):**
   * Introduce a `customAttributes: Record<string, any>` JSONB column to `contacts`, `customers`, and `quotes`, paired with a tenant-configurable schema definition.
   * Gives users the flexibility of custom fields without requiring schema migrations.
3. **Kanban Pipeline Views:**
   * Implement a drag-and-drop Kanban view for Quotes (`Draft` ➔ `Pending Approval` ➔ `Accepted` ➔ `Invoiced`), delivering the visual pipeline progression feel that sales reps expect.

### Milestone 2: Context & Intelligence
4. **Lightweight Company Auto-Enrichment:**
   * Integrate an enrichment provider (e.g. Brandfetch or Clearbit) to auto-populate logo, address, and industry upon entering a customer email domain.
5. **"Ask Relay" Natural Language Analytics:**
   * Use the existing `AiService` to allow conversational SQL/analytical queries (e.g., *"Show all packaging quotes pending approval over $10k this month"*).

### Milestone 3: Communication & Ingestion
6. **Two-Way Gmail / Outlook Sync:**
   * Implement OAuth mailbox integration to passively surface customer email exchanges on the contact timeline alongside work orders and quotes.
