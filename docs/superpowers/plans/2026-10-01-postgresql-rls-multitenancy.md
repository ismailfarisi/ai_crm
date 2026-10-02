# PostgreSQL Row-Level Security (RLS) Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce database-level multi-tenancy isolation using PostgreSQL Row-Level Security (RLS) with a fail-closed policy, standardize all entity/table tenant columns to `tenant_id` / `tenantId`, and automate request-scoped tenant session variable management via `nestjs-cls`.

**Architecture:** A request context module (`nestjs-cls`) extracts the authenticated user's `organizationId` (mapped to `tenantId`). A TypeORM subscriber / QueryRunner interceptor injects `SET LOCAL app.current_tenant_id = :tenantId` on every connection checkout or transaction boundary. PostgreSQL RLS policies enforce `tenant_id = current_setting('app.current_tenant_id')`, returning 0 rows if unset (fail-closed) and allowing full access when `app.bypass_rls = 'on'` via `TenantContextService.runAsSystem()`.

**Tech Stack:** NestJS 11, TypeORM 1 / 0.3, PostgreSQL 18, `nestjs-cls` 6.x, `@saas/shared`.

## Global Constraints
- Target database: PostgreSQL 18.
- Column standard: `tenant_id` (database column) and `tenantId` (TypeScript entity property).
- Security policy: Fail-closed (unset context = 0 rows; explicit `app.bypass_rls = 'on'` required for system jobs).
- No connection pool leaks: `SET LOCAL` within transactions or explicit connection lifecycle hooks.
- Strict schema drift validation: `pnpm check:drift` must succeed.
- Financial integrity: `pnpm check:books` must pass with 0 trial balance drift.

---

### Task 1: Install `nestjs-cls` and Implement `TenantContextModule`

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/common/context/tenant-context.service.ts`
- Create: `apps/api/src/common/context/tenant-context.module.ts`
- Create: `apps/api/src/common/context/tenant-context.interceptor.ts`
- Test: `apps/api/src/common/context/tenant-context.service.spec.ts`

**Interfaces:**
- Consumes: `AuthenticatedUser` from `apps/api/src/common/types/authenticated-user.ts`
- Produces: `TenantContextService` with `getTenantId()`, `setTenantId(id)`, `isSystem()`, `runAsSystem(fn)`, `runWithTenant(id, fn)`

- [ ] **Step 1: Install `nestjs-cls` in `apps/api`**

Run:
```bash
pnpm --filter api add nestjs-cls
```

- [ ] **Step 2: Write failing unit test for `TenantContextService`**

Create `apps/api/src/common/context/tenant-context.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  let service: TenantContextService;
  let cls: ClsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({
          global: true,
          middleware: { mount: true },
        }),
      ],
      providers: [TenantContextService],
    }).compile();

    service = module.get<TenantContextService>(TenantContextService);
    cls = module.get<ClsService>(ClsService);
  });

  it('returns null when no tenant context is set', async () => {
    await cls.run(async () => {
      expect(service.getTenantId()).toBeNull();
      expect(service.isSystem()).toBe(false);
    });
  });

  it('manages tenantId inside runWithTenant', async () => {
    const tenantId = '00000000-0000-0000-0000-000000000001';
    await service.runWithTenant(tenantId, async () => {
      expect(service.getTenantId()).toBe(tenantId);
      expect(service.isSystem()).toBe(false);
    });
  });

  it('manages system mode inside runAsSystem', async () => {
    await service.runAsSystem(async () => {
      expect(service.isSystem()).toBe(true);
      expect(service.getTenantId()).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter api test tenant-context.service.spec.ts`
Expected: FAIL with "Cannot find module './tenant-context.service'"

- [ ] **Step 4: Implement `TenantContextService`, `TenantContextInterceptor`, and `TenantContextModule`**

Create `apps/api/src/common/context/tenant-context.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

export const CLS_TENANT_ID_KEY = 'tenantId';
export const CLS_IS_SYSTEM_KEY = 'isSystem';

@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService) {}

  getTenantId(): string | null {
    return this.cls.get<string>(CLS_TENANT_ID_KEY) ?? null;
  }

  setTenantId(tenantId: string): void {
    this.cls.set(CLS_TENANT_ID_KEY, tenantId);
  }

  isSystem(): boolean {
    return Boolean(this.cls.get<boolean>(CLS_IS_SYSTEM_KEY));
  }

  async runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.cls.runWith(
      { [CLS_TENANT_ID_KEY]: tenantId, [CLS_IS_SYSTEM_KEY]: false },
      fn,
    );
  }

  async runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
    return this.cls.runWith(
      { [CLS_TENANT_ID_KEY]: null, [CLS_IS_SYSTEM_KEY]: true },
      fn,
    );
  }
}
```

Create `apps/api/src/common/context/tenant-context.interceptor.ts`:
```typescript
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context
        .switchToHttp()
        .getRequest<Request & { user?: AuthenticatedUser }>();
      const tenantId = req.user?.organizationId;
      if (tenantId) {
        this.tenantContext.setTenantId(tenantId);
      }
    }
    return next.handle();
  }
}
```

Create `apps/api/src/common/context/tenant-context.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
  ],
  providers: [
    TenantContextService,
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [TenantContextService],
})
export class TenantContextModule {}
```

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `pnpm --filter api test tenant-context.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Register `TenantContextModule` in `app.module.ts` and `worker.module.ts`**

Modify `apps/api/src/app.module.ts`:
Import `TenantContextModule` and add to `imports`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/common/context apps/api/src/app.module.ts
git commit -m "feat(api): implement TenantContextModule and ClsService"
```

---

### Task 2: Database Migration for Column Standardization (`organization_id` -> `tenant_id`)

**Files:**
- Create: `apps/api/src/database/migrations/1787500000000-StandardizeTenantIdColumns.ts`

**Interfaces:**
- Consumes: PostgreSQL schema with legacy `organization_id` columns in `contacts`, `customers`, `teams`, `users`, `roles`, `invitations`, `document_templates`
- Produces: Normalized columns named `tenant_id` with updated indexes and foreign keys

- [ ] **Step 1: Write the migration file**

Create `apps/api/src/database/migrations/1787500000000-StandardizeTenantIdColumns.ts`:
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class StandardizeTenantIdColumns1787500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. contacts
    await queryRunner.query(
      `ALTER TABLE "contacts" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );

    // 2. customers
    await queryRunner.query(
      `ALTER TABLE "customers" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_customers_org_company" RENAME TO "uq_customers_tenant_company"`,
    );

    // 3. teams
    await queryRunner.query(
      `ALTER TABLE "teams" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_teams_org_name" RENAME TO "idx_teams_tenant_name"`,
    );

    // 4. users
    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );

    // 5. roles
    await queryRunner.query(
      `ALTER TABLE "roles" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_roles_org_slug" RENAME TO "uq_roles_tenant_slug"`,
    );

    // 6. invitations
    await queryRunner.query(
      `ALTER TABLE "invitations" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );

    // 7. document_templates
    await queryRunner.query(
      `ALTER TABLE "document_templates" RENAME COLUMN "organization_id" TO "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_document_templates_org" RENAME TO "idx_document_templates_tenant"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_document_templates_tenant" RENAME TO "idx_document_templates_org"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_templates" RENAME COLUMN "tenant_id" TO "organization_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "invitations" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_roles_tenant_slug" RENAME TO "uq_roles_org_slug"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roles" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_teams_tenant_name" RENAME TO "idx_teams_org_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "teams" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_customers_tenant_company" RENAME TO "uq_customers_org_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "contacts" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );
  }
}
```

- [ ] **Step 2: Run migration**

Run: `pnpm migration:run`
Expected: Migration `StandardizeTenantIdColumns1787500000000` executes successfully.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/migrations/1787500000000-StandardizeTenantIdColumns.ts
git commit -m "feat(db): migration to standardize tenant_id column across legacy tables"
```

---

### Task 3: Update Entities & Services for Standardized `tenantId`

**Files:**
- Modify: `apps/api/src/common/entities/base.entity.ts`
- Modify: `apps/api/src/modules/contacts/entities/contact.entity.ts`
- Modify: `apps/api/src/modules/customers/entities/customer.entity.ts`
- Modify: `apps/api/src/modules/users/entities/user.entity.ts`
- Modify: `apps/api/src/modules/teams/entities/team.entity.ts`
- Modify: `apps/api/src/modules/rbac/entities/role.entity.ts`
- Modify: `apps/api/src/modules/invitations/entities/invitation.entity.ts`
- Modify: `apps/api/src/modules/document-templates/entities/document-template.entity.ts`
- Modify: `apps/api/src/modules/contacts/contacts.service.ts`
- Modify: `apps/api/src/modules/customers/customers.service.ts`

**Interfaces:**
- Produces: `TenantBaseEntity`, `TenantSoftDeletableEntity` with `@Column({ name: 'tenant_id' }) tenantId: string;`
- Updates services from `organizationId` to `tenantId`.

- [ ] **Step 1: Define `TenantBaseEntity` and `TenantSoftDeletableEntity`**

Modify `apps/api/src/common/entities/base.entity.ts`:
```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

export abstract class SoftDeletableEntity extends BaseEntity {
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}

export abstract class TenantBaseEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;
}

export abstract class TenantSoftDeletableEntity extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;
}
```

- [ ] **Step 2: Update Contact, Customer, User, Team, Role, Invitation, DocumentTemplate entities**

Update `Contact`:
- Change `organizationId` property to `tenantId` mapping to `@Column({ name: 'tenant_id' })`.
- Update `@ManyToOne(() => Organization)` join column to `{ name: 'tenant_id' }`.

Update `Customer`:
- Change `organizationId` property to `tenantId` mapping to `@Column({ name: 'tenant_id' })`.
- Update `@Index('uq_customers_tenant_company', ['tenantId', 'companyName'])`.

Update `Team`, `User`, `Role`, `Invitation`, `DocumentTemplate` similarly.

- [ ] **Step 3: Update `ContactsService` and `CustomersService` queries**

In `ContactsService`:
- Update `organizationId` usages in `scoped()`:
  `where('contact.tenantId = :tenantId', { tenantId: actor.organizationId })`
- Update `create()`: `tenantId: actor.organizationId`

In `CustomersService`:
- Update `organizationId` usages in `scoped()`:
  `where('customer.tenantId = :tenantId', { tenantId: actor.organizationId })`

- [ ] **Step 4: Run unit tests across affected modules**

Run:
```bash
pnpm --filter api test contacts.service.spec.ts customers.service.spec.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/entities/base.entity.ts apps/api/src/modules/
git commit -m "refactor: update entities and services to standardized tenantId"
```

---

### Task 4: Database Migration for PostgreSQL Row-Level Security (RLS)

**Files:**
- Create: `apps/api/src/database/migrations/1787600000000-EnablePostgresRowLevelSecurity.ts`

**Interfaces:**
- Produces: RLS enabled and forced on all tenant tables with `tenant_isolation_policy`.

- [ ] **Step 1: Write RLS migration**

Create `apps/api/src/database/migrations/1787600000000-EnablePostgresRowLevelSecurity.ts`:
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_TABLES = [
  'contacts',
  'customers',
  'teams',
  'users',
  'roles',
  'invitations',
  'document_templates',
  'quotes',
  'invoices',
  'invoice_payments',
  'sales_orders',
  'sales_order_lines',
  'delivery_notes',
  'delivery_note_lines',
  'work_orders',
  'work_order_operations',
  'time_entries',
  'purchase_orders',
  'purchase_order_lines',
  'suppliers',
  'supplier_materials',
  'purchase_policies',
  'supplier_bills',
  'supplier_bill_lines',
  'bill_payments',
  'finance_accounts',
  'expense_claims',
  'recurring_expenses',
  'category_budgets',
  'ledger_accounts',
  'journal_entries',
  'fx_rates',
  'stock_items',
  'stock_locations',
  'stock_movements',
  'goods_receipts',
  'notifications',
  'audit_logs',
  'attachments',
  'taxes',
  'tax_rules',
];

export class EnablePostgresRowLevelSecurity1787600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}"`,
      );
      await queryRunner.query(`
        CREATE POLICY tenant_isolation_policy ON "${table}"
          FOR ALL
          USING (
            current_setting('app.bypass_rls', true) = 'on'
            OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          )
          WITH CHECK (
            current_setting('app.bypass_rls', true) = 'on'
            OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`,
      );
    }
  }
}
```

- [ ] **Step 2: Run migration**

Run: `pnpm migration:run`
Expected: Migration `EnablePostgresRowLevelSecurity1787600000000` executes successfully.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/migrations/1787600000000-EnablePostgresRowLevelSecurity.ts
git commit -m "feat(db): enable PostgreSQL Row-Level Security on all tenant tables"
```

---

### Task 5: Implement TypeORM RLS Connection Subscriber

**Files:**
- Create: `apps/api/src/database/tenant-rls.subscriber.ts`
- Modify: `apps/api/src/config/root-imports.ts`
- Test: `apps/api/test/multi-tenancy-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `TenantContextService` from `apps/api/src/common/context/tenant-context.service.ts`
- Produces: TypeORM `EntitySubscriberInterface` executing `SET LOCAL app.current_tenant_id` or `SET LOCAL app.bypass_rls = 'on'` on transaction/query execution.

- [ ] **Step 1: Implement `TenantRlsSubscriber`**

Create `apps/api/src/database/tenant-rls.subscriber.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  TransactionStartEvent,
} from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';

@Injectable()
@EventSubscriber()
export class TenantRlsSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(TenantRlsSubscriber.name);

  constructor(
    dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {
    dataSource.subscribers.push(this);
  }

  async afterTransactionStart(event: TransactionStartEvent): Promise<void> {
    const isSystem = this.tenantContext.isSystem();
    const tenantId = this.tenantContext.getTenantId();

    if (isSystem) {
      await event.queryRunner.query(`SET LOCAL app.bypass_rls = 'on'`);
      return;
    }

    if (tenantId) {
      await event.queryRunner.query(
        `SET LOCAL app.current_tenant_id = '${tenantId}'`,
      );
      await event.queryRunner.query(`SET LOCAL app.bypass_rls = 'off'`);
    } else {
      // Clear variables so fail-closed kicks in
      await event.queryRunner.query(`SET LOCAL app.current_tenant_id = ''`);
      await event.queryRunner.query(`SET LOCAL app.bypass_rls = 'off'`);
    }
  }
}
```

- [ ] **Step 2: Register subscriber in TypeORM config**

Modify `apps/api/src/config/root-imports.ts`:
Import `TenantRlsSubscriber` and register in `subscribers` array or inject into `AppModule`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/tenant-rls.subscriber.ts apps/api/src/config/root-imports.ts
git commit -m "feat(api): add TenantRlsSubscriber for automatic RLS variable binding"
```

---

### Task 6: Wrap System Boot Jobs and Webhooks with `runAsSystem`

**Files:**
- Modify: `apps/api/src/modules/rbac/rbac.service.ts`
- Modify: `apps/api/src/modules/billing/billing.service.ts`

**Interfaces:**
- Consumes: `TenantContextService.runAsSystem`
- Produces: Seamless execution of cross-tenant startup synchronization and Stripe webhook operations under RLS.

- [ ] **Step 1: Wrap `RbacService.onModuleInit` with `runAsSystem`**

Modify `apps/api/src/modules/rbac/rbac.service.ts`:
Inject `TenantContextService`.
Wrap `onModuleInit()`:
```typescript
async onModuleInit(): Promise<void> {
  await this.tenantContext.runAsSystem(async () => {
    await this.syncPermissionCatalog();
    await this.syncSystemRolesForAllOrganizations();
  });
}
```

- [ ] **Step 2: Wrap Stripe Webhook Processing with `runAsSystem`**

Modify `apps/api/src/modules/billing/billing.service.ts`:
Ensure `handleStripeWebhookEvent` calls run within `this.tenantContext.runAsSystem(...)`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/rbac/rbac.service.ts apps/api/src/modules/billing/billing.service.ts
git commit -m "fix(rbac,billing): wrap system boot jobs and webhooks in runAsSystem"
```

---

### Task 7: End-to-End Verification & Multi-Tenancy RLS Tests

**Files:**
- Create: `apps/api/test/multi-tenancy-rls.e2e-spec.ts`

- [ ] **Step 1: Write E2E tests for RLS isolation, fail-closed, and system bypass**

Create `apps/api/test/multi-tenancy-rls.e2e-spec.ts`:
```typescript
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { setupTestApp } from './test-helper';

describe('PostgreSQL Row-Level Security (E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let contextService: TenantContextService;

  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    const context = await setupTestApp();
    app = context.app;
    dataSource = app.get(DataSource);
    contextService = app.get(TenantContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('prevents Tenant A from viewing Tenant B contacts even with raw query', async () => {
    // Seed contact for Tenant B via system context
    let contactBId: string;
    await contextService.runAsSystem(async () => {
      await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Contact);
        const contactB = await repo.save(
          repo.create({
            tenantId: tenantB,
            firstName: 'Secret',
            lastName: 'Customer B',
            email: 'b@secret.com',
            source: 'other',
          }),
        );
        contactBId = contactB.id;
      });
    });

    // Query under Tenant A context
    await contextService.runWithTenant(tenantA, async () => {
      await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Contact);
        // Deliberately raw query without WHERE tenantId
        const contacts = await repo.find();
        expect(contacts.some((c) => c.id === contactBId)).toBe(false);

        const directFind = await repo.findOne({ where: { id: contactBId } });
        expect(directFind).toBeNull();
      });
    });
  });

  it('enforces fail-closed: returns 0 rows when context is unset', async () => {
    await dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Contact);
      const rows = await repo.find();
      expect(rows.length).toBe(0);
    });
  });

  it('allows system context to bypass RLS and view all records', async () => {
    await contextService.runAsSystem(async () => {
      await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Contact);
        const allContacts = await repo.find();
        expect(allContacts.length).toBeGreaterThan(0);
      });
    });
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `pnpm --filter api test:e2e multi-tenancy-rls.e2e-spec.ts`
Expected: PASS (All isolation, fail-closed, and system bypass tests succeed).

- [ ] **Step 3: Run Schema Drift and Books Verification**

Run:
```bash
pnpm check:drift
pnpm check:books
pnpm test
```
Expected: All checks pass without drift or accounting discrepancies.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/multi-tenancy-rls.e2e-spec.ts
git commit -m "test: add comprehensive e2e test suite for PostgreSQL RLS multi-tenancy"
```
