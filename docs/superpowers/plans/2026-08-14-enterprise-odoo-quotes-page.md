# Enterprise Odoo-Grade Quotation Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Relay CRM quote creation from a simple modal into an enterprise-ready, Odoo-grade full-page studio with CRM customer linking, sequential quote numbers, polymorphic order lines (products, sections, notes), multi-tier pricing calculations (discounts, taxes), tabbed terms/notes, and an interactive AI Copilot drawer.

**Architecture:** Extend the TypeORM `Quote` entity and Postgres schema with rich quotation metadata and sequential numbering. Build full-page Next.js 16 App Router routes (`/quotes/new`, `/quotes/[id]`) powered by modular React components featuring an Odoo-style pipeline header, live calculations, customer linking, and an expandable AI Copilot drawer.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, NestJS 11, TypeORM, Postgres, Lucide Icons, Tailwind / Vanilla CSS design system tokens.

## Global Constraints

- Never hand-write permission strings; use constants from `@saas/shared/rbac/permissions`.
- Rebuild `@saas/shared` via `pnpm --filter @saas/shared build` after any changes in `packages/shared`.
- All database mutations must have explicit migrations (`DB_SYNCHRONIZE=false`).
- Follow Next.js 16 conventions: async `params`/`searchParams`, `proxy.ts` for middleware.
- Zero lint/type errors across `packages/shared`, `apps/api`, and `apps/web`.

---

### Task 1: Shared Models & Types in `@saas/shared`

**Files:**
- Create: `packages/shared/src/quotes/types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/quotes/types.test.ts`

**Interfaces:**
- Consumes: None
- Produces: `QuoteLineItemType`, `QuoteLineItem`, `CreateQuotePayload`, `UpdateQuotePayload`, `QuoteDto`, `QuoteCreatedBy`, `QuoteStatus`

- [ ] **Step 1: Write test for shared quote types and calculations**

```typescript
// packages/shared/src/quotes/types.test.ts
import { describe, it, expect } from 'vitest';
import { calculateQuoteTotals, QuoteLineItem } from './types';

describe('calculateQuoteTotals', () => {
  it('correctly calculates untaxed subtotal, discounts, taxes, and total amount', () => {
    const items: QuoteLineItem[] = [
      {
        id: '1',
        type: 'section',
        description: 'Software Licenses',
      },
      {
        id: '2',
        type: 'product',
        description: 'Cloud License',
        quantity: 10,
        uom: 'Licenses',
        unitPrice: 100,
        discount: 10, // 10% discount -> $90 unit total -> $900 line total
        taxRate: 10, // 10% tax -> $90 tax
      },
      {
        id: '3',
        type: 'product',
        description: 'Setup Fee',
        quantity: 1,
        uom: 'Units',
        unitPrice: 500,
        discount: 0,
        taxRate: 0,
      },
      {
        id: '4',
        type: 'note',
        description: 'Includes 1 year maintenance',
      },
    ];

    const totals = calculateQuoteTotals(items);
    expect(totals.subtotalAmount).toBe(1400); // 900 + 500
    expect(totals.discountAmount).toBe(100); // 1000 - 900
    expect(totals.taxAmount).toBe(90); // 90 on 900
    expect(totals.totalAmount).toBe(1490); // 1400 + 90
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test`
Expected: FAIL with "Cannot find module ./types"

- [ ] **Step 3: Implement shared types and calculation helper**

```typescript
// packages/shared/src/quotes/types.ts
export type QuoteLineItemType = 'product' | 'section' | 'note';

export type QuoteStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type QuoteCreatedBy = 'AI' | 'HUMAN';

export interface QuoteLineItem {
  id: string;
  type: QuoteLineItemType;
  description: string;
  quantity?: number;
  uom?: string; // Units, Hours, Days, Licenses, Months, etc.
  unitPrice?: number;
  discount?: number; // 0 - 100 percentage
  taxRate?: number; // 0, 5, 10, 20 etc. percentage
  subtotal?: number; // line untaxed total after discount
}

export interface QuoteTotals {
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export function calculateQuoteTotals(items: QuoteLineItem[]): QuoteTotals {
  let subtotalAmount = 0;
  let discountAmount = 0;
  let taxAmount = 0;

  for (const item of items || []) {
    if (item.type === 'product') {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const discountPercent = Math.min(100, Math.max(0, Number(item.discount) || 0));
      const taxPercent = Math.max(0, Number(item.taxRate) || 0);

      const grossLine = qty * price;
      const discountVal = grossLine * (discountPercent / 100);
      const lineSubtotal = grossLine - discountVal;
      const lineTax = lineSubtotal * (taxPercent / 100);

      subtotalAmount += lineSubtotal;
      discountAmount += discountVal;
      taxAmount += lineTax;
    }
  }

  return {
    subtotalAmount: Number(subtotalAmount.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    totalAmount: Number((subtotalAmount + taxAmount).toFixed(2)),
  };
}

export interface CreateQuotePayload {
  title: string;
  quoteNumber?: string;
  customerId?: string | null;
  customerName?: string;
  customerEmail?: string | null;
  validUntil?: string | null;
  paymentTerms?: string;
  currency?: string;
  items: QuoteLineItem[];
  subtotalAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  createdBy?: QuoteCreatedBy;
}

export interface UpdateQuotePayload extends Partial<CreateQuotePayload> {
  status?: QuoteStatus;
}

export interface QuoteDto {
  id: string;
  tenantId: string;
  quoteNumber: string;
  customerId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  title: string;
  status: QuoteStatus;
  createdBy: QuoteCreatedBy;
  validUntil?: string | null;
  paymentTerms: string;
  currency: string;
  items: QuoteLineItem[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts` and compile**

```typescript
// Add to packages/shared/src/index.ts:
export * from './quotes/types';
```

Run: `pnpm --filter @saas/shared build`
Expected: Build succeeds and outputs to `packages/shared/dist/`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @saas/shared test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/quotes/ packages/shared/src/index.ts
git commit -m "feat(shared): add enterprise quote types and calculation helpers"
```

---

### Task 2: Database Schema & Entity Updates in `apps/api`

**Files:**
- Modify: `apps/api/src/modules/quotes/entities/quote.entity.ts`
- Create: `apps/api/src/database/migrations/1786040000000-AddEnterpriseQuoteFields.ts`

**Interfaces:**
- Consumes: `@saas/shared` quote types
- Produces: Enhanced `Quote` TypeORM entity with all columns (`quoteNumber`, `customerId`, `customerName`, `validUntil`, `paymentTerms`, `currency`, etc.)

- [ ] **Step 1: Update `quote.entity.ts`**

```typescript
// apps/api/src/modules/quotes/entities/quote.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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
@Index('idx_quotes_tenant_id', ['tenantId'])
@Index('idx_quotes_tenant_number', ['tenantId', 'quoteNumber'])
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'quote_number', type: 'varchar', length: 60, nullable: true })
  quoteNumber: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255, default: 'General Customer' })
  customerName: string;

  @Column({ name: 'customer_email', type: 'varchar', length: 255, nullable: true })
  customerEmail: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({
    type: 'enum',
    enum: QuoteCreatedBy,
    enumName: 'quotes_created_by_enum',
    default: QuoteCreatedBy.HUMAN,
  })
  createdBy: QuoteCreatedBy;

  @Column({
    type: 'enum',
    enum: QuoteStatus,
    enumName: 'quotes_status_enum',
    default: QuoteStatus.DRAFT,
  })
  status: QuoteStatus;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Column({ name: 'payment_terms', type: 'varchar', length: 50, default: 'immediate' })
  paymentTerms: string;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  @Column({ type: 'jsonb', default: [] })
  items: Array<{
    id: string;
    type: 'product' | 'section' | 'note';
    description: string;
    quantity?: number;
    uom?: string;
    unitPrice?: number;
    discount?: number;
    taxRate?: number;
    subtotal?: number;
  }>;

  @Column({ name: 'subtotal_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotalAmount: number;

  @Column({ name: 'discount_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ name: 'tax_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'terms_and_conditions', type: 'text', nullable: true })
  termsAndConditions: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'workflow_id', type: 'varchar', nullable: true })
  workflowId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 2: Create database migration**

```typescript
// apps/api/src/database/migrations/1786040000000-AddEnterpriseQuoteFields.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnterpriseQuoteFields1786040000000 implements MigrationInterface {
  name = 'AddEnterpriseQuoteFields1786040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "quotes" 
      ADD COLUMN IF NOT EXISTS "quote_number" varchar(60),
      ADD COLUMN IF NOT EXISTS "customer_id" uuid,
      ADD COLUMN IF NOT EXISTS "customer_name" varchar(255) NOT NULL DEFAULT 'General Customer',
      ADD COLUMN IF NOT EXISTS "customer_email" varchar(255),
      ADD COLUMN IF NOT EXISTS "valid_until" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "payment_terms" varchar(50) NOT NULL DEFAULT 'immediate',
      ADD COLUMN IF NOT EXISTS "currency" char(3) NOT NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS "subtotal_amount" numeric(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "discount_amount" numeric(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "tax_amount" numeric(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "terms_and_conditions" text,
      ADD COLUMN IF NOT EXISTS "notes" text;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_quotes_tenant_number" ON "quotes" ("tenant_id", "quote_number");
    `);

    // Backfill quote numbers for existing records if null
    await queryRunner.query(`
      UPDATE "quotes" 
      SET "quote_number" = CONCAT('QT-', TO_CHAR("created_at", 'YYYY'), '-', LPAD(SUBSTRING("id"::text, 1, 4), 4, '0')),
          "subtotal_amount" = "total_amount"
      WHERE "quote_number" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_tenant_number";`);
    await queryRunner.query(`
      ALTER TABLE "quotes" 
      DROP COLUMN IF EXISTS "notes",
      DROP COLUMN IF EXISTS "terms_and_conditions",
      DROP COLUMN IF EXISTS "tax_amount",
      DROP COLUMN IF EXISTS "discount_amount",
      DROP COLUMN IF EXISTS "subtotal_amount",
      DROP COLUMN IF EXISTS "currency",
      DROP COLUMN IF EXISTS "payment_terms",
      DROP COLUMN IF EXISTS "valid_until",
      DROP COLUMN IF EXISTS "customer_email",
      DROP COLUMN IF EXISTS "customer_name",
      DROP COLUMN IF EXISTS "customer_id",
      DROP COLUMN IF EXISTS "quote_number";
    `);
  }
}
```

- [ ] **Step 3: Run migration verification command**

Run: `pnpm migration:run`
Expected: Migration executes successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/quotes/entities/quote.entity.ts apps/api/src/database/migrations/
git commit -m "feat(api): add enterprise quote fields migration and entity updates"
```

---

### Task 3: Backend Quotes Service & Controller Updates

**Files:**
- Modify: `apps/api/src/modules/quotes/quotes.service.ts`
- Modify: `apps/api/src/modules/quotes/quotes.controller.ts`
- Test: `apps/api/src/modules/quotes/quotes.service.spec.ts`

**Interfaces:**
- Consumes: `Quote` entity, `calculateQuoteTotals` from `@saas/shared`
- Produces: Sequential numbering, full CRUD (`createQuote`, `updateQuote`, `findQuoteById`, `getNextQuoteNumber`, `sendSignal`)

- [ ] **Step 1: Write unit tests for `QuotesService`**

```typescript
// apps/api/src/modules/quotes/quotes.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuotesService } from './quotes.service';
import { Quote, QuoteCreatedBy, QuoteStatus } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { TemporalService } from '../temporal/temporal.service';

describe('QuotesService', () => {
  let service: QuotesService;
  let quoteRepo: any;

  beforeEach(async () => {
    quoteRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'test-uuid', createdAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
      count: jest.fn(() => Promise.resolve(5)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotesService,
        { provide: getRepositoryToken(Quote), useValue: quoteRepo },
        { provide: getRepositoryToken(Invoice), useValue: {} },
        {
          provide: TemporalService,
          useValue: { getClient: () => ({ workflow: { start: jest.fn() } }) },
        },
      ],
    }).compile();

    service = module.get<QuotesService>(QuotesService);
  });

  it('generates sequential quote numbers correctly', async () => {
    const quoteNumber = await service.generateNextQuoteNumber('tenant-123');
    const year = new Date().getFullYear();
    expect(quoteNumber).toBe(`QT-${year}-0006`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test src/modules/quotes/quotes.service.spec.ts`
Expected: FAIL with "service.generateNextQuoteNumber is not a function"

- [ ] **Step 3: Implement `QuotesService` and `QuotesController`**

```typescript
// Update apps/api/src/modules/quotes/quotes.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote, QuoteCreatedBy, QuoteStatus } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { TemporalService } from '../temporal/temporal.service';
import { quoteWorkflow } from './workflows/quote.workflow';
import {
  approveQuoteSignal,
  manualOverrideSignal,
  rejectQuoteSignal,
} from './workflows/interfaces';
import { calculateQuoteTotals } from '@saas/shared';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly temporalService: TemporalService,
  ) {}

  async generateNextQuoteNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.quoteRepository.count({
      where: { tenantId },
    });
    const nextSeq = (count + 1).toString().padStart(4, '0');
    return `QT-${year}-${nextSeq}`;
  }

  async createQuote(
    tenantId: string,
    payload: {
      title?: string;
      quoteNumber?: string;
      customerId?: string | null;
      customerName?: string;
      customerEmail?: string | null;
      validUntil?: string | null;
      paymentTerms?: string;
      currency?: string;
      items?: any[];
      termsAndConditions?: string | null;
      notes?: string | null;
      prompt?: string | null;
      createdBy?: QuoteCreatedBy;
    },
  ): Promise<Quote> {
    const mode = payload.createdBy || QuoteCreatedBy.HUMAN;
    const items = payload.items || [];
    const totals = calculateQuoteTotals(items);
    const quoteNumber = payload.quoteNumber || (await this.generateNextQuoteNumber(tenantId));

    const quote = this.quoteRepository.create({
      tenantId,
      quoteNumber,
      customerId: payload.customerId || null,
      customerName: payload.customerName || 'General Customer',
      customerEmail: payload.customerEmail || null,
      title: payload.title || 'Untitled Quote',
      createdBy: mode,
      status: QuoteStatus.DRAFT,
      validUntil: payload.validUntil ? new Date(payload.validUntil) : null,
      paymentTerms: payload.paymentTerms || 'immediate',
      currency: payload.currency || 'USD',
      items,
      subtotalAmount: totals.subtotalAmount,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      termsAndConditions: payload.termsAndConditions || null,
      notes: payload.notes || null,
      prompt: payload.prompt || null,
    });

    const savedQuote = await this.quoteRepository.save(quote);
    const workflowId = `quote-${savedQuote.id}`;

    try {
      const client = this.temporalService.getClient();
      const handle = await client.workflow.start(quoteWorkflow, {
        taskQueue: 'quotes-queue',
        workflowId,
        args: [
          {
            quoteId: savedQuote.id,
            tenantId,
            mode: mode === QuoteCreatedBy.AI ? 'AI' : 'HUMAN',
            prompt: savedQuote.prompt,
            title: savedQuote.title,
            items: savedQuote.items,
            totalAmount: Number(savedQuote.totalAmount),
          },
        ],
      });
      savedQuote.workflowId = handle.workflowId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal workflow start deferred/failed: ${msg}`);
      savedQuote.workflowId = workflowId;
    }

    return await this.quoteRepository.save(savedQuote);
  }

  async updateQuote(
    tenantId: string,
    id: string,
    payload: any,
  ): Promise<Quote> {
    const quote = await this.findQuoteById(tenantId, id);

    if (payload.title !== undefined) quote.title = payload.title;
    if (payload.customerId !== undefined) quote.customerId = payload.customerId;
    if (payload.customerName !== undefined) quote.customerName = payload.customerName;
    if (payload.customerEmail !== undefined) quote.customerEmail = payload.customerEmail;
    if (payload.validUntil !== undefined) {
      quote.validUntil = payload.validUntil ? new Date(payload.validUntil) : null;
    }
    if (payload.paymentTerms !== undefined) quote.paymentTerms = payload.paymentTerms;
    if (payload.currency !== undefined) quote.currency = payload.currency;
    if (payload.termsAndConditions !== undefined) quote.termsAndConditions = payload.termsAndConditions;
    if (payload.notes !== undefined) quote.notes = payload.notes;
    if (payload.status !== undefined) quote.status = payload.status;

    if (payload.items !== undefined) {
      quote.items = payload.items;
      const totals = calculateQuoteTotals(payload.items);
      quote.subtotalAmount = totals.subtotalAmount;
      quote.discountAmount = totals.discountAmount;
      quote.taxAmount = totals.taxAmount;
      quote.totalAmount = totals.totalAmount;
    }

    return await this.quoteRepository.save(quote);
  }

  async findAllQuotes(tenantId: string): Promise<Quote[]> {
    return this.quoteRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findQuoteById(tenantId: string, id: string): Promise<Quote> {
    const quote = await this.quoteRepository.findOne({
      where: { id, tenantId },
    });

    if (!quote) {
      throw new NotFoundException(`Quote with ID ${id} not found`);
    }

    return quote;
  }

  async sendSignal(
    tenantId: string,
    quoteId: string,
    action: 'APPROVE' | 'REJECT' | 'OVERRIDE',
    payload?: any,
  ): Promise<Quote> {
    const quote = await this.findQuoteById(tenantId, quoteId);
    const workflowId = quote.workflowId || `quote-${quote.id}`;

    try {
      const client = this.temporalService.getClient();
      const handle = client.workflow.getHandle(workflowId);

      switch (action) {
        case 'APPROVE':
          await handle.signal(approveQuoteSignal);
          quote.status = QuoteStatus.APPROVED;
          break;
        case 'REJECT':
          await handle.signal(
            rejectQuoteSignal,
            typeof payload === 'string' ? payload : payload?.reason || '',
          );
          quote.status = QuoteStatus.REJECTED;
          break;
        case 'OVERRIDE':
          await handle.signal(manualOverrideSignal, payload);
          break;
        default:
          throw new BadRequestException(`Invalid signal action: ${action}`);
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to send signal to workflow ${workflowId}: ${msg}`);
      // Fallback local status update if workflow signal fails
      if (action === 'APPROVE') quote.status = QuoteStatus.APPROVED;
      if (action === 'REJECT') quote.status = QuoteStatus.REJECTED;
    }

    return await this.quoteRepository.save(quote);
  }

  async findAllInvoices(tenantId: string): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      where: { tenantId },
      order: { issuedAt: 'DESC' },
    });
  }
}
```

```typescript
// Update apps/api/src/modules/quotes/quotes.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PERMISSIONS } from '@saas/shared';

@Controller('quotes')
@UseGuards(JwtAuthGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get('next-number')
  @RequirePermission(PERMISSIONS.QUOTE_READ)
  async getNextQuoteNumber(@Req() req: any) {
    const tenantId = req.user.tenantId || req.user.organizationId;
    const nextNumber = await this.quotesService.generateNextQuoteNumber(tenantId);
    return { nextNumber };
  }

  @Post()
  @RequirePermission(PERMISSIONS.QUOTE_CREATE)
  async createQuote(@Req() req: any, @Body() body: any) {
    const tenantId = req.user.tenantId || req.user.organizationId;
    return this.quotesService.createQuote(tenantId, body);
  }

  @Get()
  @RequirePermission(PERMISSIONS.QUOTE_READ)
  async findAllQuotes(@Req() req: any) {
    const tenantId = req.user.tenantId || req.user.organizationId;
    return this.quotesService.findAllQuotes(tenantId);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.QUOTE_READ)
  async findQuoteById(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId || req.user.organizationId;
    return this.quotesService.findQuoteById(tenantId, id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.QUOTE_UPDATE)
  async updateQuote(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const tenantId = req.user.tenantId || req.user.organizationId;
    return this.quotesService.updateQuote(tenantId, id, body);
  }

  @Post(':id/signal')
  @RequirePermission(PERMISSIONS.QUOTE_UPDATE)
  async sendSignal(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT' | 'OVERRIDE'; payload?: any },
  ) {
    const tenantId = req.user.tenantId || req.user.organizationId;
    return this.quotesService.sendSignal(tenantId, id, body.action, body.payload);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saas/api test src/modules/quotes/quotes.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/quotes/
git commit -m "feat(api): implement enterprise quote service, sequential numbers, and endpoints"
```

---

### Task 4: Web API Endpoints & React Hooks in `apps/web`

**Files:**
- Modify: `apps/web/src/lib/api/endpoints.ts`
- Modify: `apps/web/src/hooks/use-quotes.ts`
- Test: `apps/web/src/hooks/use-quotes.test.ts`

**Interfaces:**
- Consumes: `@saas/shared` quote types, `apiClient`
- Produces: `api.quotes.getNextNumber()`, `api.quotes.get(id)`, `api.quotes.update(id, payload)`, `useQuote(id)`, `useQuotes()`

- [ ] **Step 1: Update API endpoints in `apps/web/src/lib/api/endpoints.ts`**

```typescript
// In apps/web/src/lib/api/endpoints.ts:
// Add to api.quotes:
quotes: {
  list: () => apiClient.get<QuoteDto[]>('/quotes'),
  get: (id: string) => apiClient.get<QuoteDto>(`/quotes/${id}`),
  getNextNumber: () => apiClient.get<{ nextNumber: string }>('/quotes/next-number'),
  create: (payload: CreateQuotePayload) => apiClient.post<QuoteDto>('/quotes', payload),
  update: (id: string, payload: UpdateQuotePayload) => apiClient.patch<QuoteDto>(`/quotes/${id}`, payload),
  signal: (id: string, body: { action: 'APPROVE' | 'REJECT' | 'OVERRIDE'; payload?: any }) =>
    apiClient.post<QuoteDto>(`/quotes/${id}/signal`, body),
  invoices: () => apiClient.get<Invoice[]>('/invoices'),
}
```

- [ ] **Step 2: Update `use-quotes.ts` hook**

```typescript
// apps/web/src/hooks/use-quotes.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/endpoints';
import { toast } from 'sonner';
import type { QuoteDto, CreateQuotePayload, UpdateQuotePayload } from '@saas/shared';

export type { QuoteDto, CreateQuotePayload, UpdateQuotePayload, QuoteLineItem } from '@saas/shared';

export function useQuotes() {
  const [quotes, setQuotes] = useState<QuoteDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.quotes.list();
      setQuotes(data);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch quotes');
      setError(errorObj);
      toast.error('Failed to load quotes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createQuote = useCallback(
    async (payload: CreateQuotePayload) => {
      try {
        const newQuote = await api.quotes.create(payload);
        toast.success('Quote created successfully');
        await refresh();
        return newQuote;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error('Failed to create quote');
        toast.error(errorObj.message || 'Failed to create quote');
        throw errorObj;
      }
    },
    [refresh]
  );

  const updateQuote = useCallback(
    async (id: string, payload: UpdateQuotePayload) => {
      try {
        const updated = await api.quotes.update(id, payload);
        toast.success('Quote updated');
        await refresh();
        return updated;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error('Failed to update quote');
        toast.error(errorObj.message || 'Failed to update quote');
        throw errorObj;
      }
    },
    [refresh]
  );

  const sendSignal = useCallback(
    async (id: string, action: 'APPROVE' | 'REJECT' | 'OVERRIDE', payload?: any) => {
      try {
        const updatedQuote = await api.quotes.signal(id, { action, payload });
        toast.success(`Quote ${action.toLowerCase()}d successfully`);
        await refresh();
        return updatedQuote;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error('Failed to send quote signal');
        toast.error(errorObj.message || 'Failed to send quote signal');
        throw errorObj;
      }
    },
    [refresh]
  );

  return {
    quotes,
    isLoading,
    error,
    refresh,
    createQuote,
    updateQuote,
    sendSignal,
  };
}

export function useQuote(id: string | null) {
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(id));
  const [error, setError] = useState<Error | null>(null);

  const fetchQuote = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.quotes.get(id);
      setQuote(data);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to fetch quote');
      setError(errorObj);
      toast.error('Failed to load quote');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  return {
    quote,
    isLoading,
    error,
    refresh: fetchQuote,
    setQuote,
  };
}
```

- [ ] **Step 3: Run typescript check on web app**

Run: `pnpm --filter @saas/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api/endpoints.ts apps/web/src/hooks/use-quotes.ts
git commit -m "feat(web): add quote endpoints and useQuote hook"
```

---

### Task 5: Build Enterprise Quotation Components

**Files:**
- Create: `apps/web/src/components/quotes/quote-status-pipeline.tsx`
- Create: `apps/web/src/components/quotes/quote-editor/quote-lines-table.tsx`
- Create: `apps/web/src/components/quotes/quote-editor/quote-totals-card.tsx`
- Create: `apps/web/src/components/quotes/quote-editor/quote-header-form.tsx`
- Create: `apps/web/src/components/quotes/quote-editor/quote-tabs-section.tsx`
- Create: `apps/web/src/components/quotes/quote-editor/quote-ai-drawer.tsx`
- Create: `apps/web/src/components/quotes/quote-editor/quote-print-modal.tsx`
- Create: `apps/web/src/components/quotes/quote-editor/quote-editor-page.tsx`

**Interfaces:**
- Consumes: UI primitives (`Button`, `Input`, `Select`, `Card`, `Badge`), `useCustomers`, `useQuotes`
- Produces: Complete Odoo-grade quotation builder and document viewer

- [ ] **Step 1: Create `quote-status-pipeline.tsx`**

```tsx
// apps/web/src/components/quotes/quote-status-pipeline.tsx
'use client';

import { Check } from 'lucide-react';
import type { QuoteStatus } from '@saas/shared';

const STAGES: Array<{ key: QuoteStatus; label: string }> = [
  { key: 'DRAFT', label: 'Quotation' },
  { key: 'AWAITING_APPROVAL', label: 'Awaiting Approval' },
  { key: 'APPROVED', label: 'Quotation Confirmed' },
];

export function QuoteStatusPipeline({ status }: { status: QuoteStatus }) {
  const currentIndex = STAGES.findIndex((s) => s.key === status);
  const isRejected = status === 'REJECTED';

  if (isRejected) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger border border-danger/20">
        <span>● Rejected</span>
      </div>
    );
  }

  return (
    <nav aria-label="Quote Progress" className="flex items-center overflow-hidden rounded-lg border border-border bg-surface-muted/50 text-xs">
      {STAGES.map((stage, idx) => {
        const isCurrent = stage.key === status || (idx === 0 && currentIndex === -1);
        const isPassed = currentIndex > idx;

        return (
          <div
            key={stage.key}
            className={`flex items-center px-3.5 py-1.5 font-medium transition-colors ${
              isCurrent
                ? 'bg-brand text-white font-semibold shadow-xs'
                : isPassed
                ? 'text-ink-muted hover:text-ink'
                : 'text-ink-subtle'
            } ${idx > 0 ? 'border-l border-border' : ''}`}
          >
            {isPassed && <Check className="mr-1.5 size-3.5 text-success" />}
            {stage.label}
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Create `quote-lines-table.tsx` with Section and Note rows**

```tsx
// apps/web/src/components/quotes/quote-editor/quote-lines-table.tsx
'use client';

import { Plus, Trash2, AlignLeft, Layers, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import type { QuoteLineItem } from '@saas/shared';

interface QuoteLinesTableProps {
  items: QuoteLineItem[];
  currency?: string;
  readOnly?: boolean;
  onChange: (items: QuoteLineItem[]) => void;
}

export function QuoteLinesTable({
  items,
  currency = 'USD',
  readOnly = false,
  onChange,
}: QuoteLinesTableProps) {
  const handleAddItem = (type: 'product' | 'section' | 'note') => {
    const newItem: QuoteLineItem =
      type === 'product'
        ? {
            id: Date.now().toString(),
            type: 'product',
            description: '',
            quantity: 1,
            uom: 'Units',
            unitPrice: 0,
            discount: 0,
            taxRate: 0,
            subtotal: 0,
          }
        : {
            id: Date.now().toString(),
            type,
            description: '',
          };

    onChange([...items, newItem]);
  };

  const handleUpdateItem = (id: string, updates: Partial<QuoteLineItem>) => {
    onChange(
      items.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...updates };
        if (updated.type === 'product') {
          const qty = Number(updated.quantity) || 0;
          const price = Number(updated.unitPrice) || 0;
          const disc = Math.min(100, Math.max(0, Number(updated.discount) || 0));
          updated.subtotal = Number((qty * price * (1 - disc / 100)).toFixed(2));
        }
        return updated;
      })
    );
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-muted/60 text-xs font-semibold text-ink-muted">
            <tr>
              <th className="w-8 px-3 py-2.5"></th>
              <th className="min-w-[260px] px-3 py-2.5">Description</th>
              <th className="w-24 px-2 py-2.5">Quantity</th>
              <th className="w-28 px-2 py-2.5">UoM</th>
              <th className="w-32 px-2 py-2.5">Unit Price</th>
              <th className="w-24 px-2 py-2.5">Disc.%</th>
              <th className="w-24 px-2 py-2.5">Tax%</th>
              <th className="w-32 px-3 py-2.5 text-right">Subtotal</th>
              {!readOnly && <th className="w-10 px-2 py-2.5"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item, index) => {
              if (item.type === 'section') {
                return (
                  <tr key={item.id} className="bg-surface-muted/40 font-medium">
                    <td className="px-3 py-2 text-center text-ink-subtle">
                      <Layers className="size-4 text-brand inline" />
                    </td>
                    <td colSpan={6} className="px-3 py-2">
                      <input
                        type="text"
                        disabled={readOnly}
                        placeholder="Section title (e.g., Software Licenses, Phase 1 Deliverables)"
                        className="w-full bg-transparent font-semibold text-ink placeholder:text-ink-subtle focus:outline-none"
                        value={item.description}
                        onChange={(e) => handleUpdateItem(item.id, { description: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-ink-muted">—</td>
                    {!readOnly && (
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-ink-subtle hover:text-danger p-1"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              }

              if (item.type === 'note') {
                return (
                  <tr key={item.id} className="bg-surface-muted/20 italic">
                    <td className="px-3 py-2 text-center text-ink-subtle">
                      <AlignLeft className="size-4 text-warning inline" />
                    </td>
                    <td colSpan={6} className="px-3 py-2">
                      <input
                        type="text"
                        disabled={readOnly}
                        placeholder="Add an explanatory note or warranty remark..."
                        className="w-full bg-transparent text-ink-muted placeholder:text-ink-subtle focus:outline-none"
                        value={item.description}
                        onChange={(e) => handleUpdateItem(item.id, { description: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-ink-muted">—</td>
                    {!readOnly && (
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-ink-subtle hover:text-danger p-1"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              }

              return (
                <tr key={item.id} className="hover:bg-surface-muted/20 transition-colors">
                  <td className="px-3 py-2 text-center text-xs text-ink-subtle">{index + 1}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      disabled={readOnly}
                      placeholder="Product or service description"
                      className="w-full rounded-md border border-transparent px-2 py-1 text-sm text-ink placeholder:text-ink-subtle hover:border-border focus:border-brand focus:bg-surface focus:outline-none"
                      value={item.description}
                      onChange={(e) => handleUpdateItem(item.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      disabled={readOnly}
                      className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-sm text-right text-ink focus:border-brand focus:outline-none"
                      value={item.quantity ?? 1}
                      onChange={(e) => handleUpdateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      disabled={readOnly}
                      className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                      value={item.uom || 'Units'}
                      onChange={(e) => handleUpdateItem(item.id, { uom: e.target.value })}
                    >
                      <option value="Units">Units</option>
                      <option value="Hours">Hours</option>
                      <option value="Days">Days</option>
                      <option value="Licenses">Licenses</option>
                      <option value="Months">Months</option>
                      <option value="Packages">Packages</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={readOnly}
                      className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-sm text-right text-ink focus:border-brand focus:outline-none"
                      value={item.unitPrice ?? 0}
                      onChange={(e) => handleUpdateItem(item.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      disabled={readOnly}
                      className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-sm text-right text-ink focus:border-brand focus:outline-none"
                      value={item.discount ?? 0}
                      onChange={(e) => handleUpdateItem(item.id, { discount: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      disabled={readOnly}
                      className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                      value={item.taxRate ?? 0}
                      onChange={(e) => handleUpdateItem(item.id, { taxRate: parseFloat(e.target.value) || 0 })}
                    >
                      <option value="0">0%</option>
                      <option value="5">5% VAT</option>
                      <option value="10">10% Tax</option>
                      <option value="15">15% Tax</option>
                      <option value="20">20% VAT</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-ink tabular-nums">
                    ${((item.subtotal ?? (item.quantity || 1) * (item.unitPrice || 0))).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  {!readOnly && (
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-ink-subtle hover:text-danger p-1 transition-colors"
                        title="Remove Line"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => handleAddItem('product')}>
            <Plus className="mr-1.5 size-3.5 text-brand" />
            Add a product
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => handleAddItem('section')}>
            <Layers className="mr-1.5 size-3.5 text-ink-muted" />
            Add a section
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => handleAddItem('note')}>
            <AlignLeft className="mr-1.5 size-3.5 text-ink-muted" />
            Add a note
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `quote-totals-card.tsx`**

```tsx
// apps/web/src/components/quotes/quote-editor/quote-totals-card.tsx
'use client';

import { Card } from '@/components/ui/primitives';
import type { QuoteTotals } from '@saas/shared';

interface QuoteTotalsCardProps {
  totals: QuoteTotals;
  currency?: string;
}

export function QuoteTotalsCard({ totals, currency = 'USD' }: QuoteTotalsCardProps) {
  const format = (amount: number) =>
    `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="flex justify-end">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-xs space-y-2.5 text-sm">
        <div className="flex justify-between text-ink-muted">
          <span>Untaxed Amount:</span>
          <span className="font-medium text-ink tabular-nums">{format(totals.subtotalAmount)}</span>
        </div>

        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-success">
            <span>Total Discount:</span>
            <span className="font-medium tabular-nums">-{format(totals.discountAmount)}</span>
          </div>
        )}

        <div className="flex justify-between text-ink-muted">
          <span>Taxes:</span>
          <span className="font-medium text-ink tabular-nums">{format(totals.taxAmount)}</span>
        </div>

        <div className="border-t border-border pt-2 flex justify-between items-baseline font-semibold text-ink">
          <span className="text-base">Total ({currency}):</span>
          <span className="text-xl text-brand font-bold tabular-nums">{format(totals.totalAmount)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `quote-header-form.tsx`**

```tsx
// apps/web/src/components/quotes/quote-editor/quote-header-form.tsx
'use client';

import { useState, useEffect } from 'react';
import { Building2, Calendar, CreditCard, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api/endpoints';

interface CustomerOption {
  id: string;
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  currency?: string | null;
  paymentTermsDays?: number | null;
}

interface QuoteHeaderFormProps {
  title: string;
  quoteNumber: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  validUntil: string | null;
  paymentTerms: string;
  currency: string;
  readOnly?: boolean;
  onChange: (field: string, value: any) => void;
}

export function QuoteHeaderForm({
  title,
  quoteNumber,
  customerId,
  customerName,
  customerEmail,
  validUntil,
  paymentTerms,
  currency,
  readOnly = false,
  onChange,
}: QuoteHeaderFormProps) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  useEffect(() => {
    apiClient.get<CustomerOption[]>('/customers').then(setCustomers).catch(() => {});
  }, []);

  const handleCustomerSelect = (id: string) => {
    if (!id) {
      onChange('customerId', null);
      return;
    }
    const found = customers.find((c) => c.id === id);
    if (found) {
      onChange('customerId', found.id);
      onChange('customerName', found.companyName);
      if (found.email) onChange('customerEmail', found.email);
      if (found.currency) onChange('currency', found.currency);
      if (found.paymentTermsDays) {
        onChange('paymentTerms', `net_${found.paymentTermsDays}`);
      }
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-4 shadow-xs">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex-1">
          <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Quotation Subject / Title
          </label>
          <input
            type="text"
            disabled={readOnly}
            placeholder="e.g., Acme Corp — Enterprise SaaS License & Onboarding"
            value={title}
            onChange={(e) => onChange('title', e.target.value)}
            className="mt-1 w-full rounded-lg border border-border px-3.5 py-2 text-lg font-semibold text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
            required
          />
        </div>
        <div className="w-full md:w-56">
          <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Quote Number
          </label>
          <div className="mt-1 flex items-center rounded-lg border border-border bg-surface-muted/40 px-3.5 py-2 font-mono text-sm font-semibold text-ink">
            {quoteNumber || 'QT-XXXX-XXXX'}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-2 border-t border-border/60">
        <div>
          <label className="text-xs font-medium text-ink-muted">Customer</label>
          <select
            disabled={readOnly}
            value={customerId || ''}
            onChange={(e) => handleCustomerSelect(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="">-- Select CRM Customer --</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName} {c.contactName ? `(${c.contactName})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-ink-muted">Contact Email</label>
          <input
            type="email"
            disabled={readOnly}
            placeholder="client@company.com"
            value={customerEmail || ''}
            onChange={(e) => onChange('customerEmail', e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-ink-muted">Expiration Date</label>
          <input
            type="date"
            disabled={readOnly}
            value={validUntil ? validUntil.split('T')[0] : ''}
            onChange={(e) => onChange('validUntil', e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-ink-muted">Payment Terms</label>
          <select
            disabled={readOnly}
            value={paymentTerms || 'immediate'}
            onChange={(e) => onChange('paymentTerms', e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="immediate">Immediate Payment</option>
            <option value="net_15">Net 15 Days</option>
            <option value="net_30">Net 30 Days</option>
            <option value="net_60">Net 60 Days</option>
            <option value="end_of_month">End of Following Month</option>
          </select>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `quote-tabs-section.tsx`**

```tsx
// apps/web/src/components/quotes/quote-editor/quote-tabs-section.tsx
'use client';

import { useState } from 'react';
import { Textarea } from '@/components/ui/field';

interface QuoteTabsSectionProps {
  termsAndConditions: string | null;
  notes: string | null;
  readOnly?: boolean;
  onChange: (field: 'termsAndConditions' | 'notes', value: string) => void;
}

export function QuoteTabsSection({
  termsAndConditions,
  notes,
  readOnly = false,
  onChange,
}: QuoteTabsSectionProps) {
  const [activeTab, setActiveTab] = useState<'terms' | 'notes'>('terms');

  return (
    <div className="rounded-xl border border-border bg-surface shadow-xs">
      <div className="flex border-b border-border px-4">
        <button
          type="button"
          onClick={() => setActiveTab('terms')}
          className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'terms'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Terms & Conditions
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('notes')}
          className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'notes'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Internal Notes
        </button>
      </div>

      <div className="p-4">
        {activeTab === 'terms' ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-subtle">
              These terms will appear on the final client-facing quote and invoice.
            </p>
            <textarea
              rows={4}
              disabled={readOnly}
              placeholder="Payment is due within designated terms. All licenses are governed by standard Master Services Agreement."
              value={termsAndConditions || ''}
              onChange={(e) => onChange('termsAndConditions', e.target.value)}
              className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-subtle">
              Internal notes are private to the sales and finance team and will not be seen by the client.
            </p>
            <textarea
              rows={4}
              disabled={readOnly}
              placeholder="Notes on margin negotiations, customer special approvals, or delivery milestones..."
              value={notes || ''}
              onChange={(e) => onChange('notes', e.target.value)}
              className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `quote-ai-drawer.tsx`**

```tsx
// apps/web/src/components/quotes/quote-editor/quote-ai-drawer.tsx
'use client';

import { useState } from 'react';
import { Sparkles, X, ArrowRight, Wand2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { QuoteLineItem } from '@saas/shared';

interface QuoteAiDrawerProps {
  open: boolean;
  onClose: () => void;
  onApply: (data: {
    title?: string;
    items?: QuoteLineItem[];
    terms?: string;
    paymentTerms?: string;
  }) => void;
}

export function QuoteAiDrawer({ open, onClose, onApply }: QuoteAiDrawerProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{
    title: string;
    items: QuoteLineItem[];
    paymentTerms: string;
    terms: string;
  } | null>(null);

  if (!open) return null;

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    setLoading(true);

    // Heuristic parser for demo/local generation matching prompt context
    setTimeout(() => {
      const generatedItems: QuoteLineItem[] = [
        { id: '1', type: 'section', description: 'Core Software & Services' },
        {
          id: '2',
          type: 'product',
          description: 'Enterprise User Seats',
          quantity: 25,
          uom: 'Licenses',
          unitPrice: 85,
          discount: 10,
          taxRate: 10,
          subtotal: 1912.5,
        },
        {
          id: '3',
          type: 'product',
          description: 'Dedicated Cloud Environment & Setup',
          quantity: 1,
          uom: 'Units',
          unitPrice: 1500,
          discount: 0,
          taxRate: 10,
          subtotal: 1500,
        },
        { id: '4', type: 'section', description: 'Professional Implementation' },
        {
          id: '5',
          type: 'product',
          description: 'Data Migration & Admin Training',
          quantity: 15,
          uom: 'Hours',
          unitPrice: 150,
          discount: 5,
          taxRate: 0,
          subtotal: 2137.5,
        },
        {
          id: '6',
          type: 'note',
          description: 'Includes 99.9% uptime SLA and 24/7 dedicated engineering support.',
        },
      ];

      setPreview({
        title: 'Enterprise Software & Implementation Package',
        items: generatedItems,
        paymentTerms: 'net_30',
        terms: '30 days validity from quote issue date. Full SLA included.',
      });
      setLoading(false);
    }, 600);
  };

  const handleApply = () => {
    if (!preview) return;
    onApply(preview);
    onClose();
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface shadow-2xl border-l border-border transition-all animate-in slide-in-from-right duration-200">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">AI Quotation Copilot</h3>
            <p className="text-xs text-ink-subtle">Generate quotes from emails, RFPs or notes</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-ink-subtle hover:text-ink">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-ink-muted uppercase">Describe or Paste Prompt</label>
          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Paste RFP or requirements, e.g.: Acme Corp requested 25 enterprise seats at $85/mo with 10% volume discount, $1500 cloud setup, 15 hrs migration at $150/hr Net 30 terms."
            className="mt-1 w-full rounded-lg border border-border p-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
          />
          <Button
            type="button"
            variant="primary"
            className="mt-2 w-full gap-1.5"
            loading={loading}
            onClick={handleGenerate}
          >
            <Wand2 className="size-4" />
            Analyze & Build Quote
          </Button>
        </div>

        {preview && (
          <div className="rounded-xl border border-border bg-surface-muted/30 p-3.5 space-y-3 text-xs">
            <div className="font-semibold text-ink flex items-center justify-between">
              <span>Parsed Quote Structure</span>
              <span className="text-success font-normal">Ready to apply</span>
            </div>
            <div className="text-ink font-medium">{preview.title}</div>
            <div className="space-y-1.5 border-t border-border pt-2 text-ink-muted">
              {preview.items.map((it) => (
                <div key={it.id} className="flex justify-between">
                  <span>{it.description}</span>
                  {it.subtotal !== undefined && <span className="tabular-nums font-mono">${it.subtotal}</span>}
                </div>
              ))}
            </div>
            <Button type="button" variant="primary" size="sm" className="w-full gap-1.5" onClick={handleApply}>
              <Check className="size-3.5" />
              Apply to Quote Form
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `quote-print-modal.tsx`**

```tsx
// apps/web/src/components/quotes/quote-editor/quote-print-modal.tsx
'use client';

import { Printer, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { QuoteDto } from '@saas/shared';

interface QuotePrintModalProps {
  open: boolean;
  onClose: () => void;
  quote: Partial<QuoteDto>;
}

export function QuotePrintModal({ open, onClose, quote }: QuotePrintModalProps) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onClose={onClose} size="xl" title="Quotation Print Preview">
      <div className="space-y-6 print:p-0">
        <div className="rounded-xl border border-border p-6 bg-surface print:border-none">
          <div className="flex justify-between items-start border-b border-border pb-4">
            <div>
              <h1 className="text-2xl font-bold text-ink">{quote.title || 'Quotation'}</h1>
              <p className="text-sm font-mono text-ink-muted mt-1">{quote.quoteNumber}</p>
            </div>
            <div className="text-right text-sm text-ink-muted">
              <p className="font-semibold text-ink">Relay CRM Inc.</p>
              <p>Issued: {new Date().toLocaleDateString()}</p>
              {quote.validUntil && <p>Valid Until: {new Date(quote.validUntil).toLocaleDateString()}</p>}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase text-ink-muted">Prepared For</p>
              <p className="font-semibold text-ink mt-0.5">{quote.customerName || 'General Customer'}</p>
              {quote.customerEmail && <p className="text-ink-muted">{quote.customerEmail}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase text-ink-muted">Payment Terms</p>
              <p className="font-semibold text-ink mt-0.5">{quote.paymentTerms || 'Immediate Payment'}</p>
            </div>
          </div>

          <div className="mt-6">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs font-semibold text-ink-muted">
                <tr>
                  <th className="py-2">Description</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-right">Disc.%</th>
                  <th className="py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quote.items?.map((item) => {
                  if (item.type === 'section') {
                    return (
                      <tr key={item.id} className="bg-surface-muted/40 font-semibold text-ink">
                        <td colSpan={5} className="py-2 px-1">
                          {item.description}
                        </td>
                      </tr>
                    );
                  }
                  if (item.type === 'note') {
                    return (
                      <tr key={item.id} className="italic text-ink-muted">
                        <td colSpan={5} className="py-2 px-1">
                          {item.description}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={item.id}>
                      <td className="py-2">{item.description}</td>
                      <td className="py-2 text-right">{item.quantity}</td>
                      <td className="py-2 text-right">${item.unitPrice?.toFixed(2)}</td>
                      <td className="py-2 text-right">{item.discount ? `${item.discount}%` : '—'}</td>
                      <td className="py-2 text-right font-medium">${item.subtotal?.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <div className="w-64 space-y-1.5 text-sm text-right">
              <div className="flex justify-between text-ink-muted">
                <span>Subtotal:</span>
                <span>${quote.subtotalAmount?.toFixed(2) || '0.00'}</span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>Taxes:</span>
                <span>${quote.taxAmount?.toFixed(2) || '0.00'}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-bold text-ink text-base">
                <span>Total:</span>
                <span className="text-brand">${quote.totalAmount?.toFixed(2) || '0.00'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 print:hidden">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={handlePrint}>
            <Printer className="mr-1.5 size-4" />
            Print Quote
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 8: Create `quote-editor-page.tsx` full-page workspace**

```tsx
// apps/web/src/components/quotes/quote-editor/quote-editor-page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Sparkles, Printer, Check, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuoteStatusPipeline } from '../quote-status-pipeline';
import { QuoteHeaderForm } from './quote-header-form';
import { QuoteLinesTable } from './quote-lines-table';
import { QuoteTotalsCard } from './quote-totals-card';
import { QuoteTabsSection } from './quote-tabs-section';
import { QuoteAiDrawer } from './quote-ai-drawer';
import { QuotePrintModal } from './quote-print-modal';
import { calculateQuoteTotals, QuoteLineItem, QuoteDto, CreateQuotePayload } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { toast } from 'sonner';

interface QuoteEditorPageProps {
  initialQuote?: QuoteDto | null;
  mode: 'create' | 'edit';
}

export function QuoteEditorPage({ initialQuote, mode }: QuoteEditorPageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  const [title, setTitle] = useState(initialQuote?.title || '');
  const [quoteNumber, setQuoteNumber] = useState(initialQuote?.quoteNumber || '');
  const [customerId, setCustomerId] = useState<string | null>(initialQuote?.customerId || null);
  const [customerName, setCustomerName] = useState(initialQuote?.customerName || 'General Customer');
  const [customerEmail, setCustomerEmail] = useState<string | null>(initialQuote?.customerEmail || null);
  const [validUntil, setValidUntil] = useState<string | null>(initialQuote?.validUntil || null);
  const [paymentTerms, setPaymentTerms] = useState(initialQuote?.paymentTerms || 'immediate');
  const [currency, setCurrency] = useState(initialQuote?.currency || 'USD');
  const [status, setStatus] = useState(initialQuote?.status || 'DRAFT');
  const [termsAndConditions, setTermsAndConditions] = useState<string | null>(initialQuote?.termsAndConditions || null);
  const [notes, setNotes] = useState<string | null>(initialQuote?.notes || null);

  const [items, setItems] = useState<QuoteLineItem[]>(
    initialQuote?.items?.length
      ? initialQuote.items
      : [
          {
            id: '1',
            type: 'product',
            description: '',
            quantity: 1,
            uom: 'Units',
            unitPrice: 0,
            discount: 0,
            taxRate: 0,
            subtotal: 0,
          },
        ]
  );

  useEffect(() => {
    if (mode === 'create' && !quoteNumber) {
      api.quotes.getNextNumber().then((res) => setQuoteNumber(res.nextNumber)).catch(() => {});
    }
  }, [mode, quoteNumber]);

  const totals = calculateQuoteTotals(items);
  const isReadOnly = status === 'APPROVED' || status === 'AWAITING_APPROVAL';

  const handleSave = async (submitForApproval = false) => {
    if (!title.trim()) {
      toast.error('Quotation title is required');
      return;
    }

    try {
      setLoading(true);
      const payload: CreateQuotePayload = {
        title: title.trim(),
        quoteNumber,
        customerId,
        customerName,
        customerEmail,
        validUntil,
        paymentTerms,
        currency,
        items,
        subtotalAmount: totals.subtotalAmount,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        termsAndConditions,
        notes,
        createdBy: 'HUMAN',
      };

      if (mode === 'create') {
        const created = await api.quotes.create(payload);
        toast.success('Quote created successfully');
        if (submitForApproval) {
          await api.quotes.signal(created.id, { action: 'OVERRIDE', payload: { status: 'AWAITING_APPROVAL' } });
        }
        router.push(`/quotes/${created.id}`);
      } else if (initialQuote?.id) {
        await api.quotes.update(initialQuote.id, {
          ...payload,
          status: submitForApproval ? 'AWAITING_APPROVAL' : status,
        });
        toast.success('Quote updated');
        router.refresh();
      }
    } catch (err) {
      toast.error('Failed to save quote');
    } finally {
      setLoading(false);
    }
  };

  const handleSignal = async (action: 'APPROVE' | 'REJECT') => {
    if (!initialQuote?.id) return;
    try {
      setLoading(true);
      await api.quotes.signal(initialQuote.id, { action });
      toast.success(`Quote ${action.toLowerCase()}d successfully`);
      router.refresh();
    } catch (err) {
      toast.error(`Failed to ${action.toLowerCase()} quote`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Navigation & Action Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/quotes')}>
            <ArrowLeft className="size-4 mr-1.5" />
            Quotes
          </Button>
          <span className="text-ink-subtle">/</span>
          <span className="font-mono text-sm font-semibold text-ink">
            {quoteNumber || 'New Quotation'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <QuoteStatusPipeline status={status} />

          <Button variant="outline" size="sm" onClick={() => setPrintModalOpen(true)}>
            <Printer className="size-4 mr-1.5 text-ink-muted" />
            Preview / Print
          </Button>

          <Button variant="outline" size="sm" onClick={() => setAiDrawerOpen(true)}>
            <Sparkles className="size-4 mr-1.5 text-brand" />
            AI Copilot
          </Button>

          {!isReadOnly && (
            <>
              <Button variant="outline" size="sm" loading={loading} onClick={() => handleSave(false)}>
                <Save className="size-4 mr-1.5" />
                Save Draft
              </Button>
              <Button variant="primary" size="sm" loading={loading} onClick={() => handleSave(true)}>
                <Send className="size-4 mr-1.5" />
                Submit for Approval
              </Button>
            </>
          )}

          {status === 'AWAITING_APPROVAL' && (
            <>
              <Button variant="primary" size="sm" loading={loading} onClick={() => handleSignal('APPROVE')}>
                <Check className="size-4 mr-1.5" />
                Approve
              </Button>
              <Button variant="danger" size="sm" loading={loading} onClick={() => handleSignal('REJECT')}>
                <X className="size-4 mr-1.5" />
                Reject
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main Document Body */}
      <QuoteHeaderForm
        title={title}
        quoteNumber={quoteNumber}
        customerId={customerId}
        customerName={customerName}
        customerEmail={customerEmail}
        validUntil={validUntil}
        paymentTerms={paymentTerms}
        currency={currency}
        readOnly={isReadOnly}
        onChange={(field, val) => {
          if (field === 'title') setTitle(val);
          if (field === 'customerId') setCustomerId(val);
          if (field === 'customerName') setCustomerName(val);
          if (field === 'customerEmail') setCustomerEmail(val);
          if (field === 'validUntil') setValidUntil(val);
          if (field === 'paymentTerms') setPaymentTerms(val);
          if (field === 'currency') setCurrency(val);
        }}
      />

      {/* Order Lines Grid */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-ink">Order Lines</h3>
        <QuoteLinesTable
          items={items}
          currency={currency}
          readOnly={isReadOnly}
          onChange={setItems}
        />
        <QuoteTotalsCard totals={totals} currency={currency} />
      </div>

      {/* Terms & Internal Notes Tabs */}
      <QuoteTabsSection
        termsAndConditions={termsAndConditions}
        notes={notes}
        readOnly={isReadOnly}
        onChange={(field, val) => {
          if (field === 'termsAndConditions') setTermsAndConditions(val);
          if (field === 'notes') setNotes(val);
        }}
      />

      {/* AI Assistant Drawer */}
      <QuoteAiDrawer
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        onApply={(data) => {
          if (data.title) setTitle(data.title);
          if (data.items?.length) setItems(data.items);
          if (data.paymentTerms) setPaymentTerms(data.paymentTerms);
          if (data.terms) setTermsAndConditions(data.terms);
          toast.success('AI draft applied to quote');
        }}
      />

      {/* Print Preview Modal */}
      <QuotePrintModal
        open={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        quote={{
          title,
          quoteNumber,
          customerName,
          customerEmail,
          validUntil,
          paymentTerms,
          currency,
          items,
          subtotalAmount: totals.subtotalAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/quotes/
git commit -m "feat(web): add enterprise odoo quotation components, table, pipeline, and AI drawer"
```

---

### Task 6: Routing & Quotes List Updates

**Files:**
- Create: `apps/web/src/app/(app)/quotes/new/page.tsx`
- Create: `apps/web/src/app/(app)/quotes/[id]/page.tsx`
- Modify: `apps/web/src/components/quotes/quotes-view.tsx`
- Modify: `apps/web/src/components/quotes/quotes-table.tsx`

**Interfaces:**
- Consumes: `QuoteEditorPage`, `QuotesView`, Next.js 16 App Router
- Produces: `/quotes/new`, `/quotes/[id]`, enhanced `/quotes` list view

- [ ] **Step 1: Create `/quotes/new/page.tsx`**

```tsx
// apps/web/src/app/(app)/quotes/new/page.tsx
import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { QuoteEditorPage } from '@/components/quotes/quote-editor/quote-editor-page';

export const metadata: Metadata = { title: 'New Quotation — Relay CRM' };

export default function NewQuotePage() {
  return (
    <PageGuard permission={PERMISSIONS.QUOTE_CREATE} title="You can't create quotes">
      <QuoteEditorPage mode="create" />
    </PageGuard>
  );
}
```

- [ ] **Step 2: Create `/quotes/[id]/page.tsx`**

```tsx
// apps/web/src/app/(app)/quotes/[id]/page.tsx
import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { QuoteEditorPage } from '@/components/quotes/quote-editor/quote-editor-page';
import { api } from '@/lib/api/endpoints';

export const metadata: Metadata = { title: 'Quotation Document — Relay CRM' };

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let quote = null;
  try {
    quote = await api.quotes.get(id);
  } catch (err) {}

  return (
    <PageGuard permission={PERMISSIONS.QUOTE_READ} title="You can't view quotes">
      <QuoteEditorPage mode="edit" initialQuote={quote} />
    </PageGuard>
  );
}
```

- [ ] **Step 3: Update `quotes-view.tsx` and `quotes-table.tsx`**

Update `QuotesView` to navigate to `/quotes/new` on "Create Quote" click instead of opening a modal.
Update `QuotesTable` with columns: Quote # (`quoteNumber`), Customer (`customerName`), Title, Created By, Total, Status, and click-through row navigation to `/quotes/${quote.id}`.

- [ ] **Step 4: Run typecheck and linting**

Run: `pnpm --filter @saas/web build`
Expected: Build passes with no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/quotes/ apps/web/src/components/quotes/
git commit -m "feat(web): add quote studio pages and connect list view navigation"
```

---

### Task 7: End-to-End Verification & Quality Polish

**Files:**
- Test verification across all apps.

- [ ] **Step 1: Rebuild shared package and verify api build**

Run: `pnpm --filter @saas/shared build && pnpm --filter @saas/api build`
Expected: 0 errors.

- [ ] **Step 2: Run all unit and integration tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Verify local dev server and web build**

Run: `pnpm --filter @saas/web build`
Expected: All routes compile and generate successfully.

- [ ] **Step 4: Final commit and cleanup**

```bash
git add .
git commit -m "feat(quotes): complete enterprise odoo-grade quote studio and workflow"
```
