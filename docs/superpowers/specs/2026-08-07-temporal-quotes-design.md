# Design Specification: Temporal.io Quotes & Invoices Workflow Integration

## Overview
Integrate **Temporal.io** into Relay CRM (`apps/api`) to orchestrate durable, long-running workflows for **Quotes & Invoices**. The architecture supports both AI Agent automated quote generation and manual human quote creation, while seamlessly handling human-in-the-loop approvals, revisions, and invoice generation via Temporal Signals and Activities.

---

## 1. Architecture & Module Structure

### Directory Layout (`apps/api/src/modules/`)
- `temporal/`
  - `temporal.module.ts`: Shared NestJS module exposing `@temporalio/client` Client connection and embedded Worker initialization.
  - `temporal.service.ts`: Helper service for starting, signaling, and querying workflows.
- `quotes/`
  - `entities/`: `Quote` and `Invoice` TypeORM database entities.
  - `dto/`: Request validation schemas (`CreateQuoteDto`, `SignalActionDto`).
  - `quotes.controller.ts`: REST endpoints (`POST /quotes`, `POST /quotes/:id/signal`, `GET /quotes/:id`).
  - `quotes.service.ts`: Integrates TypeORM DB operations with `TemporalService`.
  - `quotes.module.ts`: Imports `TemporalModule` and registers quotes services & controllers.
  - `workflows/`:
    - `quote.workflow.ts`: Temporal durable workflow definition.
    - `quote.activities.ts`: NestJS activities (AI quote drafting, DB state updates, Invoice generation, notifications).
    - `interfaces.ts`: Input/Output and Signal payload types.

---

## 2. Database Model

### Quote Entity (`Quote`)
- `id`: string (UUID)
- `tenantId`: string
- `createdBy`: enum (`'AI' | 'HUMAN'`)
- `status`: enum (`'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED'`)
- `prompt`: string (optional, for AI drafting)
- `title`: string
- `items`: JSON array (`{ description: string, quantity: number, unitPrice: number, total: number }`)
- `totalAmount`: decimal
- `workflowId`: string (Temporal workflow ID)
- `createdAt`: timestamp
- `updatedAt`: timestamp

### Invoice Entity (`Invoice`)
- `id`: string (UUID)
- `quoteId`: string (FK -> Quote.id)
- `tenantId`: string
- `invoiceNumber`: string (e.g. `INV-2026-0001`)
- `amount`: decimal
- `status`: enum (`'ISSUED' | 'PAID'`)
- `issuedAt`: timestamp

---

## 3. Temporal Workflow & Activity Specification

### Workflow: `quoteWorkflow(input: QuoteWorkflowInput)`
1. **Initiation**: Triggered upon POST `/quotes`. Accepts `quoteId`, `tenantId`, `mode ('AI' | 'HUMAN')`, and raw prompt or manual items.
2. **AI Drafting (if mode === 'AI')**: Calls activity `draftQuoteAIActivity` to structure line items and pricing from prompt.
3. **State Persistence**: Calls activity `saveQuoteStateActivity` to update Quote entity in PostgreSQL with status `AWAITING_APPROVAL`.
4. **Durable Wait (Human in the Loop)**: Workflow enters `workflow.condition(() => isApproved || isRejected)` waiting for signals:
   - `approveQuoteSignal`: Sets `isApproved = true`.
   - `rejectQuoteSignal`: Sets `isRejected = true`.
   - `manualOverrideSignal`: Updates quote items/pricing within the workflow.
5. **Finalization**:
   - If `isRejected`: Activity `updateQuoteStatusActivity` sets quote status to `REJECTED`.
   - If `isApproved`: Activity `generateInvoiceActivity` creates `Invoice` record in DB, activity `sendNotificationActivity` logs/sends invoice notification, and quote status is set to `APPROVED`.

### Activities (`quote.activities.ts`)
- `draftQuoteAIActivity`: Pluggable AI service interface simulating AI line-item drafting and discount recommendations.
- `saveQuoteStateActivity`: TypeORM persistence helper for Quote updates.
- `generateInvoiceActivity`: Generates formal Invoice record linked to Quote.
- `sendNotificationActivity`: Logs or sends email notifications.

---

## 4. REST API Endpoints

- `POST /quotes`: Creates a new Quote (AI or Manual) and starts `quoteWorkflow`.
- `POST /quotes/:id/signal`: Sends a human signal (`APPROVE`, `REJECT`, `OVERRIDE`) to the active Temporal workflow.
- `GET /quotes`: Lists quotes for the current tenant.
- `GET /quotes/:id`: Returns quote details and queries live Temporal workflow status.
- `GET /invoices`: Lists generated invoices.

---

## 5. Testing & Verification Plan

1. **Unit & Activity Tests**: Verify TypeORM entities and AI drafting activity logic.
2. **Temporal Workflow Test**: Test workflow execution using `@temporalio/testing` environment for AI execution, sleeping/waiting state, signal sending, and invoice generation.
3. **API End-to-End Test**: Verify creation, signal approval, and invoice generation via NestJS HTTP requests.
