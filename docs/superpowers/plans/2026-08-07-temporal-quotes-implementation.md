# Temporal Quotes & Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Temporal.io workflow orchestration into Relay CRM (`apps/api`) to handle AI agent and human-created quotes, human-in-the-loop approvals via Signals, and invoice generation.

**Architecture:** Create a shared NestJS `TemporalModule` managing `@temporalio/client` and an embedded `@temporalio/worker`, along with a feature `QuotesModule` containing TypeORM `Quote` and `Invoice` entities, REST endpoints, and `quoteWorkflow` with activities.

**Tech Stack:** NestJS 11, TypeORM 1, PostgreSQL, `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, TypeScript.

## Global Constraints

- Permissions live in `packages/shared/src/rbac/permissions.ts` and nowhere else.
- After modifying `packages/shared`, run `pnpm --filter @saas/shared build`.
- DB schema changes must use TypeORM migrations (`DB_SYNCHRONIZE=false`).
- Every quotes/invoices DB query must filter by `tenantId`.

---

### Task 1: Package Setup & Shared Permissions

**Files:**
- Modify: `apps/api/package.json`
- Modify: `packages/shared/src/rbac/permissions.ts`
- Modify: `packages/shared/src/types/api.ts`

**Interfaces:**
- Consumes: Existing shared RBAC structure
- Produces: Temporal packages in `apps/api`, `QUOTE_*` and `INVOICE_*` permission constants

- [ ] **Step 1: Install Temporal packages in `apps/api`**

Run: `pnpm --filter api add @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity`

- [ ] **Step 2: Add quote and invoice permissions to `packages/shared/src/rbac/permissions.ts`**

```typescript
// Add to permissions object:
  QUOTE_CREATE: 'quote:create',
  QUOTE_READ: 'quote:read',
  QUOTE_APPROVE: 'quote:approve',
  INVOICE_READ: 'invoice:read',
```

- [ ] **Step 3: Build shared package**

Run: `pnpm --filter @saas/shared build`
Expected: Success with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json packages/shared/src/rbac/permissions.ts packages/shared/src/types/api.ts pnpm-lock.yaml
git commit -m "feat(shared): add temporal dependencies and quote permissions"
```

---

### Task 2: Shared `TemporalModule` Setup

**Files:**
- Create: `apps/api/src/modules/temporal/temporal.service.ts`
- Create: `apps/api/src/modules/temporal/temporal.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `@temporalio/client`
- Produces: `TemporalService` with `startWorkflow()`, `signalWorkflow()`, and `queryWorkflow()` methods

- [ ] **Step 1: Create `TemporalService`**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';

@Injectable Feld
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private client: Client;

  async onModuleInit() {
    try {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      });
      this.client = new Client({ connection });
      this.logger.log('Connected to Temporal Server');
    } catch (err) {
      this.logger.warn(`Temporal server connection deferred/failed: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    // Graceful disconnect if connected
  }

  getClient(): Client {
    return this.client;
  }
}
```

- [ ] **Step 2: Create `TemporalModule` and export `TemporalService`**

```typescript
import { Module, Global } from '@nestjs/common';
import { TemporalService } from './temporal.service';

@Global()
@Module({
  providers: [TemporalService],
  exports: [TemporalService],
})
export class TemporalModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/temporal/
git commit -m "feat(api): add shared TemporalModule"
```

---

### Task 3: Quote & Invoice TypeORM Entities & Database Migration

**Files:**
- Create: `apps/api/src/modules/quotes/entities/quote.entity.ts`
- Create: `apps/api/src/modules/quotes/entities/invoice.entity.ts`
- Create: `apps/api/src/database/migrations/1786030000000-AddQuotesAndInvoices.ts`

**Interfaces:**
- Consumes: TypeORM Entity decoraters & DB connection
- Produces: `Quote` and `Invoice` DB tables in PostgreSQL

- [ ] **Step 1: Create `Quote` Entity**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum QuoteCreatedBy {
  AI = 'AI',
  HUMAN = 'HUMAN',
}

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('quotes')
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'enum', enum: QuoteCreatedBy, default: QuoteCreatedBy.HUMAN })
  createdBy: QuoteCreatedBy;

  @Column({ type: 'enum', enum: QuoteStatus, default: QuoteStatus.DRAFT })
  status: QuoteStatus;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  prompt: string;

  @Column({ type: 'jsonb', default: [] })
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'workflow_id', nullable: true })
  workflowId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 2: Create `Invoice` Entity**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum InvoiceStatus {
  ISSUED = 'ISSUED',
  PAID = 'PAID',
}

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id' })
  quoteId: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'invoice_number' })
  invoiceNumber: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.ISSUED })
  status: InvoiceStatus;

  @CreateDateColumn({ name: 'issued_at' })
  issuedAt: Date;
}
```

- [ ] **Step 3: Create TypeORM Migration**

Write `AddQuotesAndInvoices` migration creating `quotes` and `invoices` tables with indexes on `tenant_id`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/quotes/entities/ apps/api/src/database/migrations/
git commit -m "feat(api): add Quote and Invoice entities and migration"
```

---

### Task 4: Temporal Workflows & Activities Implementation

**Files:**
- Create: `apps/api/src/modules/quotes/workflows/interfaces.ts`
- Create: `apps/api/src/modules/quotes/workflows/quote.activities.ts`
- Create: `apps/api/src/modules/quotes/workflows/quote.workflow.ts`

**Interfaces:**
- Consumes: `@temporalio/workflow`, `@temporalio/activity`
- Produces: `quoteWorkflow()`, `approveQuoteSignal`, `rejectQuoteSignal`, `draftQuoteAIActivity`

- [ ] **Step 1: Create `interfaces.ts`**

Define `QuoteWorkflowInput`, `QuoteWorkflowResult`, and Signal definitions (`approveQuoteSignal`, `rejectQuoteSignal`, `manualOverrideSignal`).

- [ ] **Step 2: Create `quote.workflow.ts`**

Implement durable state machine with `workflow.condition()`.

- [ ] **Step 3: Create `quote.activities.ts`**

Implement mock AI drafting activity and DB update activities.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/quotes/workflows/
git commit -m "feat(api): implement quote workflow and activities"
```

---

### Task 5: Quotes NestJS Controller & Service

**Files:**
- Create: `apps/api/src/modules/quotes/quotes.service.ts`
- Create: `apps/api/src/modules/quotes/quotes.controller.ts`
- Create: `apps/api/src/modules/quotes/quotes.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `QuotesService`, `TemporalService`, TypeORM repositories
- Produces: `POST /quotes`, `POST /quotes/:id/signal`, `GET /quotes` REST APIs

- [ ] **Step 1: Create `QuotesService` with CRUD and Temporal trigger logic**
- [ ] **Step 2: Create `QuotesController` with RBAC permission guards**
- [ ] **Step 3: Register `QuotesModule` in `AppModule`**
- [ ] **Step 4: Verify build with `pnpm --filter api build`**
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/quotes/ apps/api/src/app.module.ts
git commit -m "feat(api): integrate QuotesModule with Temporal orchestration"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-temporal-quotes-implementation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like to take?
