# Spreadsheet-Like Views with Inline Editing & Kanban Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, high-density Data View Engine for Relay CRM featuring spreadsheet-style inline editing, native HTML5 drag-and-drop Kanban pipelines, and persistent saved views (tabs), rolled out to Quotes and Contacts.

**Architecture:** A lightweight backend `SavedViewsModule` stores view presets (`table` vs. `kanban`, active filters, visible columns, sort) in PostgreSQL with tenant RLS. The frontend provides a modular `<DataViewContainer>` encapsulating an `<InlineEditableTable>` (extending TanStack Table with optimistic TanStack Query mutations) and a `<KanbanBoard>` (zero-dependency native HTML5 DnD harmonized with `ProductionKanban`).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, TanStack Table v8, TanStack Query v5, NestJS 11, TypeORM 1, PostgreSQL 18.

## Global Constraints

- Permissions live in `packages/shared/src/rbac/permissions.ts` and nowhere else.
- `packages/shared` is compiled, not source-linked: run `pnpm --filter @saas/shared build` after edits.
- Never trust the JWT token for authorization; permissions are resolved per-request behind a 5s cache.
- The schema is owned by migrations (`DB_SYNCHRONIZE=false`). Always generate migrations for entity changes.
- Drag-and-drop must use native HTML5 drag-and-drop (`draggable`, `onDragStart`, `onDragOver`, `onDrop`), with zero external DnD npm libraries (matching `ProductionKanban`).
- Optimistic mutations must automatically rollback and toast on 403 or 422 errors.

---

### Task 1: Shared Types & Zod Schemas (`packages/shared`)

**Files:**
- Create: `packages/shared/src/views/types.ts`
- Create: `packages/shared/src/schemas/saved-view.ts`
- Test: `packages/shared/src/schemas/saved-view.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `ViewLayoutType`: `'table' | 'kanban'`
  - `ColumnConfig`: `{ key: string; visible: boolean; width?: number; sortOrder?: number }`
  - `FilterRule`: `{ field: string; operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in'; value: any }`
  - `SavedViewConfig`: `{ columns?: ColumnConfig[]; filters?: FilterRule[]; sort?: { field: string; direction: 'asc' | 'desc' }; kanban?: { groupField: string; collapsedColumns?: string[] } }`
  - `SavedViewDto`: The serialized database row contract
  - `createSavedViewSchema`, `updateSavedViewSchema`: Zod validation schemas

- [ ] **Step 1: Write the failing schema tests**

```ts
// packages/shared/src/schemas/saved-view.spec.ts
import { describe, it, expect } from 'vitest';
import { createSavedViewSchema, updateSavedViewSchema } from './saved-view';

describe('SavedView Zod Schemas', () => {
  it('validates a valid create saved view payload', () => {
    const input = {
      entityType: 'quotes',
      name: 'High Value Quotes',
      viewType: 'kanban',
      isDefault: false,
      isShared: true,
      config: {
        columns: [{ key: 'title', visible: true, width: 200 }],
        filters: [{ field: 'totalAmount', operator: 'gte', value: 10000 }],
        sort: { field: 'totalAmount', direction: 'desc' },
      },
    };
    const result = createSavedViewSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('High Value Quotes');
      expect(result.data.viewType).toBe('kanban');
    }
  });

  it('rejects an invalid viewType', () => {
    const input = {
      entityType: 'quotes',
      name: 'Test View',
      viewType: 'invalid_layout',
    };
    const result = createSavedViewSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('validates a partial update schema', () => {
    const input = {
      name: 'Renamed View',
      isShared: false,
    };
    const result = updateSavedViewSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test saved-view.spec.ts`
Expected: FAIL (Cannot find module `./saved-view`)

- [ ] **Step 3: Write types and implementation**

```ts
// packages/shared/src/views/types.ts
export type ViewLayoutType = 'table' | 'kanban';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'in';

export interface ColumnConfig {
  key: string;
  visible: boolean;
  width?: number;
  sortOrder?: number;
}

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value: any;
}

export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

export interface KanbanConfig {
  groupField: string;
  collapsedColumns?: string[];
}

export interface SavedViewConfig {
  columns?: ColumnConfig[];
  filters?: FilterRule[];
  sort?: SortConfig;
  kanban?: KanbanConfig;
}

export interface SavedViewDto {
  id: string;
  tenantId: string;
  userId: string;
  entityType: string;
  name: string;
  viewType: ViewLayoutType;
  isDefault: boolean;
  isShared: boolean;
  config: SavedViewConfig;
  createdAt: string;
  updatedAt: string;
}
```

```ts
// packages/shared/src/schemas/saved-view.ts
import { z } from 'zod';

export const VIEW_LAYOUT_TYPES = ['table', 'kanban'] as const;
export const FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'in',
] as const;

export const columnConfigSchema = z.object({
  key: z.string().trim().min(1),
  visible: z.boolean(),
  width: z.number().positive().optional(),
  sortOrder: z.number().int().optional(),
});

export const filterRuleSchema = z.object({
  field: z.string().trim().min(1),
  operator: z.enum(FILTER_OPERATORS),
  value: z.any(),
});

export const sortConfigSchema = z.object({
  field: z.string().trim().min(1),
  direction: z.enum(['asc', 'desc']),
});

export const kanbanConfigSchema = z.object({
  groupField: z.string().trim().min(1),
  collapsedColumns: z.array(z.string()).optional(),
});

export const savedViewConfigSchema = z.object({
  columns: z.array(columnConfigSchema).optional(),
  filters: z.array(filterRuleSchema).optional(),
  sort: sortConfigSchema.optional(),
  kanban: kanbanConfigSchema.optional(),
});

export const createSavedViewSchema = z.object({
  entityType: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1, 'View name is required').max(80),
  viewType: z.enum(VIEW_LAYOUT_TYPES).default('table'),
  isDefault: z.boolean().default(false),
  isShared: z.boolean().default(false),
  config: savedViewConfigSchema.default({}),
});

export const updateSavedViewSchema = createSavedViewSchema.partial();

export type CreateSavedViewPayload = z.output<typeof createSavedViewSchema>;
export type UpdateSavedViewPayload = z.output<typeof updateSavedViewSchema>;
```

- [ ] **Step 4: Export from shared index and build**

Add exports to `packages/shared/src/index.ts`:
```ts
export * from './views/types';
export * from './schemas/saved-view';
```

Run: `pnpm --filter @saas/shared test saved-view.spec.ts`
Expected: PASS
Run: `pnpm --filter @saas/shared build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/views packages/shared/src/schemas/saved-view.* packages/shared/src/index.ts
git commit -m "feat(shared): add saved views types and zod validation schemas"
```

---

### Task 2: Backend SavedViews Entity, Migration & Service (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/saved-views/entities/saved-view.entity.ts`
- Create: `apps/api/src/modules/saved-views/saved-views.service.ts`
- Create: `apps/api/src/modules/saved-views/saved-views.service.spec.ts`
- Create: `apps/api/src/database/migrations/1788000000000-CreateSavedViewsTable.ts`

**Interfaces:**
- Consumes: `TenantSoftDeletableEntity`, `SavedViewDto`, `CreateSavedViewPayload`, `UpdateSavedViewPayload` from `@saas/shared`.
- Produces: `SavedViewsService` with `findAccessible(tenantId, userId, entityType)`, `create(tenantId, userId, payload)`, `update(tenantId, userId, id, payload)`, `delete(tenantId, userId, id)`.

- [ ] **Step 1: Write the failing unit tests for SavedViewsService**

```ts
// apps/api/src/modules/saved-views/saved-views.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SavedViewsService } from './saved-views.service';
import { SavedView } from './entities/saved-view.entity';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('SavedViewsService', () => {
  let service: SavedViewsService;
  let mockRepo: any;

  const mockView: Partial<SavedView> = {
    id: 'view-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    entityType: 'quotes',
    name: 'Active Pipeline',
    viewType: 'kanban',
    isDefault: false,
    isShared: false,
    config: {},
  };

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'view-1', ...entity })),
      softRemove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedViewsService,
        { provide: getRepositoryToken(SavedView), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<SavedViewsService>(SavedViewsService);
  });

  it('lists user private views plus shared organization views', async () => {
    mockRepo.find.mockResolvedValue([mockView]);
    const result = await service.findAccessible('tenant-1', 'user-1', 'quotes');
    expect(result).toHaveLength(1);
    expect(mockRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { tenantId: 'tenant-1', entityType: 'quotes', userId: 'user-1' },
          { tenantId: 'tenant-1', entityType: 'quotes', isShared: true },
        ],
      }),
    );
  });

  it('prevents non-owner non-admin from deleting a private view', async () => {
    mockRepo.findOne.mockResolvedValue({ ...mockView, userId: 'other-user' });
    await expect(
      service.delete('tenant-1', 'user-1', 'view-1', false),
    ).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test saved-views.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement SavedView entity, service, and migration**

```ts
// apps/api/src/modules/saved-views/entities/saved-view.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { TenantSoftDeletableEntity } from '@/common/entities/base.entity';
import type { SavedViewConfig, ViewLayoutType } from '@saas/shared';

@Entity('saved_views')
@Index('idx_saved_views_tenant_entity', ['tenantId', 'entityType', 'isShared'])
@Index('idx_saved_views_user', ['tenantId', 'userId'])
export class SavedView extends TenantSoftDeletableEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  entityType: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'table' })
  viewType: ViewLayoutType;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', default: false })
  isShared: boolean;

  @Column({ type: 'jsonb', default: {} })
  config: SavedViewConfig;
}
```

```ts
// apps/api/src/modules/saved-views/saved-views.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedView } from './entities/saved-view.entity';
import type { CreateSavedViewPayload, UpdateSavedViewPayload } from '@saas/shared';

@Injectable()
export class SavedViewsService {
  constructor(
    @InjectRepository(SavedView)
    private readonly repo: Repository<SavedView>,
  ) {}

  async findAccessible(tenantId: string, userId: string, entityType: string): Promise<SavedView[]> {
    return this.repo.find({
      where: [
        { tenantId, entityType, userId },
        { tenantId, entityType, isShared: true },
      ],
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<SavedView> {
    const view = await this.repo.findOne({ where: { id, tenantId } });
    if (!view) throw new NotFoundException('Saved view not found');
    return view;
  }

  async create(tenantId: string, userId: string, payload: CreateSavedViewPayload): Promise<SavedView> {
    const view = this.repo.create({
      tenantId,
      userId,
      ...payload,
    });
    return this.repo.save(view);
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    payload: UpdateSavedViewPayload,
    isAdmin = false,
  ): Promise<SavedView> {
    const view = await this.findById(tenantId, id);
    if (view.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Cannot edit another user’s view');
    }
    Object.assign(view, payload);
    return this.repo.save(view);
  }

  async delete(tenantId: string, userId: string, id: string, isAdmin = false): Promise<void> {
    const view = await this.findById(tenantId, id);
    if (view.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Cannot delete another user’s view');
    }
    await this.repo.softRemove(view);
  }
}
```

```ts
// apps/api/src/database/migrations/1788000000000-CreateSavedViewsTable.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSavedViewsTable1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_views" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "entityType" character varying(40) NOT NULL,
        "name" character varying(80) NOT NULL,
        "viewType" character varying(20) NOT NULL DEFAULT 'table',
        "isDefault" boolean NOT NULL DEFAULT false,
        "isShared" boolean NOT NULL DEFAULT false,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_saved_views_id" PRIMARY KEY ("id")
      );
      CREATE INDEX "idx_saved_views_tenant_entity" ON "saved_views" ("tenant_id", "entityType", "isShared");
      CREATE INDEX "idx_saved_views_user" ON "saved_views" ("tenant_id", "userId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_views"`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saas/api test saved-views.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/saved-views apps/api/src/database/migrations/*CreateSavedViewsTable.ts
git commit -m "feat(api): implement saved views entity, service, and database migration"
```

---

### Task 3: Backend Controller, Module & Feature Registration (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/saved-views/saved-views.controller.ts`
- Create: `apps/api/src/modules/saved-views/saved-views.controller.spec.ts`
- Create: `apps/api/src/modules/saved-views/saved-views.module.ts`
- Modify: `apps/api/src/feature-modules.ts`

**Interfaces:**
- Exposes:
  - `GET /api/v1/saved-views?entityType=:type`
  - `POST /api/v1/saved-views`
  - `PATCH /api/v1/saved-views/:id`
  - `DELETE /api/v1/saved-views/:id`

- [ ] **Step 1: Write controller tests**

```ts
// apps/api/src/modules/saved-views/saved-views.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SavedViewsController } from './saved-views.controller';
import { SavedViewsService } from './saved-views.service';

describe('SavedViewsController', () => {
  let controller: SavedViewsController;
  let service: jest.Mocked<Partial<SavedViewsService>>;

  const mockUser: any = {
    userId: 'user-1',
    organizationId: 'tenant-1',
    roles: ['member'],
    permissions: [],
  };

  beforeEach(async () => {
    service = {
      findAccessible: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'view-1' } as any),
      update: jest.fn().mockResolvedValue({ id: 'view-1' } as any),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SavedViewsController],
      providers: [{ provide: SavedViewsService, useValue: service }],
    }).compile();

    controller = module.get<SavedViewsController>(SavedViewsController);
  });

  it('lists views for entityType', async () => {
    await controller.list(mockUser, 'quotes');
    expect(service.findAccessible).toHaveBeenCalledWith('tenant-1', 'user-1', 'quotes');
  });

  it('creates view', async () => {
    const payload = { entityType: 'quotes', name: 'Test', viewType: 'table' as const };
    await controller.create(mockUser, payload as any);
    expect(service.create).toHaveBeenCalledWith('tenant-1', 'user-1', payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test saved-views.controller.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement controller, module, and register in feature modules**

```ts
// apps/api/src/modules/saved-views/saved-views.controller.ts
import { Controller, Get, Post, Patch, Delete, Param, Query, Body } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/modules/auth/strategies/jwt.strategy';
import { SavedViewsService } from './saved-views.service';
import { createSavedViewSchema, updateSavedViewSchema } from '@saas/shared';
import { zodBody } from '@/common/pipes/zod.pipe';

@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly service: SavedViewsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('entityType') entityType: string) {
    return this.service.findAccessible(user.organizationId, user.userId, entityType);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createSavedViewSchema)) body: any,
  ) {
    return this.service.create(user.organizationId, user.userId, body);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(updateSavedViewSchema)) body: any,
  ) {
    const isAdmin = user.roles.includes('admin') || user.roles.includes('owner');
    return this.service.update(user.organizationId, user.userId, id, body, isAdmin);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const isAdmin = user.roles.includes('admin') || user.roles.includes('owner');
    return this.service.delete(user.organizationId, user.userId, id, isAdmin);
  }
}
```

```ts
// apps/api/src/modules/saved-views/saved-views.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedView } from './entities/saved-view.entity';
import { SavedViewsService } from './saved-views.service';
import { SavedViewsController } from './saved-views.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SavedView])],
  controllers: [SavedViewsController],
  providers: [SavedViewsService],
  exports: [SavedViewsService],
})
export class SavedViewsModule {}
```

Register `SavedViewsModule` in `apps/api/src/feature-modules.ts`.

- [ ] **Step 4: Run controller test and verify drift**

Run: `pnpm --filter @saas/api test saved-views.controller.spec.ts`
Expected: PASS
Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/saved-views apps/api/src/feature-modules.ts
git commit -m "feat(api): implement saved views controller, module and feature registration"
```

---

### Task 4: Frontend View State Hooks & API Client (`apps/web`)

**Files:**
- Modify: `apps/web/src/lib/api/endpoints.ts`
- Create: `apps/web/src/hooks/use-saved-views.ts`
- Test: `apps/web/src/hooks/use-saved-views.test.ts`

**Interfaces:**
- Produces:
  - `api.savedViews.list(entityType)`
  - `api.savedViews.create(payload)`
  - `api.savedViews.update(id, payload)`
  - `api.savedViews.delete(id)`
  - `useSavedViews(entityType)`: React Query hook managing view loading, active preset selection, creation, and updates.

- [ ] **Step 1: Write test for useSavedViews hook**

```ts
// apps/web/src/hooks/use-saved-views.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedViews } from './use-saved-views';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    savedViews: {
      list: vi.fn().mockResolvedValue([
        { id: 'v1', name: 'All Quotes', viewType: 'table', isDefault: true, config: {} },
      ]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  queryKeys: {
    savedViews: (type: string) => ['saved-views', type],
  },
}));

describe('useSavedViews', () => {
  it('loads views and identifies default view', async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper });
    await act(async () => {});
    expect(result.current.views).toHaveLength(1);
    expect(result.current.activeView?.name).toBe('All Quotes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test use-saved-views.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement endpoints and useSavedViews hook**

Add endpoints to `apps/web/src/lib/api/endpoints.ts`:
```ts
savedViews: {
  list: (entityType: string) => apiFetch<SavedViewDto[]>(`/api/v1/saved-views?entityType=${entityType}`),
  create: (data: CreateSavedViewPayload) => apiFetch<SavedViewDto>('/api/v1/saved-views', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: UpdateSavedViewPayload) => apiFetch<SavedViewDto>(`/api/v1/saved-views/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/api/v1/saved-views/${id}`, { method: 'DELETE' }),
},
```

```ts
// apps/web/src/hooks/use-saved-views.ts
'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/api/endpoints';
import type { SavedViewDto, CreateSavedViewPayload, UpdateSavedViewPayload } from '@saas/shared';
import { toast } from 'sonner';

export function useSavedViews(entityType: string) {
  const queryClient = useQueryClient();
  const qKey = ['saved-views', entityType];

  const { data: views = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => api.savedViews.list(entityType),
  });

  const defaultView = useMemo(
    () => views.find((v) => v.isDefault) || views[0] || null,
    [views],
  );

  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const activeView = useMemo(() => {
    if (activeViewId) {
      const match = views.find((v) => v.id === activeViewId);
      if (match) return match;
    }
    return defaultView;
  }, [views, activeViewId, defaultView]);

  const createView = useMutation({
    mutationFn: (payload: CreateSavedViewPayload) => api.savedViews.create(payload),
    onSuccess: (newView) => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setActiveViewId(newView.id);
      toast.success(`View "${newView.name}" created`);
    },
    onError: () => toast.error('Failed to create view'),
  });

  const updateView = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSavedViewPayload }) =>
      api.savedViews.update(id, payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: qKey });
      toast.success(`View "${updated.name}" updated`);
    },
    onError: () => toast.error('Failed to update view'),
  });

  const deleteView = useMutation({
    mutationFn: (id: string) => api.savedViews.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setActiveViewId(null);
      toast.success('View deleted');
    },
    onError: () => toast.error('Failed to delete view'),
  });

  return {
    views,
    activeView,
    setActiveViewId,
    isLoading,
    createView: createView.mutateAsync,
    updateView: updateView.mutateAsync,
    deleteView: deleteView.mutateAsync,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test use-saved-views.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/endpoints.ts apps/web/src/hooks/use-saved-views.*
git commit -m "feat(web): implement saved views API client and React Query hook"
```

---

### Task 5: Inline Editable Table Components & Optimistic Cell Editors (`apps/web`)

**Files:**
- Create: `apps/web/src/components/views/cell-editors/text-cell-editor.tsx`
- Create: `apps/web/src/components/views/cell-editors/badge-select-cell-editor.tsx`
- Create: `apps/web/src/components/views/inline-editable-table.tsx`
- Test: `apps/web/src/components/views/inline-editable-table.test.tsx`

**Interfaces:**
- Produces:
  - `<TextCellEditor value={val} onCommit={(next) => void} />`
  - `<BadgeSelectCellEditor value={val} options={options} onCommit={(next) => void} />`
  - `<InlineEditableTable columns={cols} data={rows} onCellUpdate={(rowId, field, next) => Promise<void>} />`

- [ ] **Step 1: Write tests for inline editing and optimistic rollback**

```tsx
// apps/web/src/components/views/inline-editable-table.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditableTable } from './inline-editable-table';
import React from 'react';

describe('InlineEditableTable', () => {
  const data = [{ id: '1', name: 'John Doe', status: 'lead' }];
  const columns = [
    { accessorKey: 'name', header: 'Name', isEditable: true },
    { accessorKey: 'status', header: 'Status', isEditable: true },
  ];

  it('renders table headers and data', () => {
    render(
      <InlineEditableTable
        data={data}
        columns={columns as any}
        onCellUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText('John Doe')).toBeDefined();
    expect(screen.getByText('Name')).toBeDefined();
  });

  it('triggers onCellUpdate when cell commits an edit', () => {
    const onCellUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineEditableTable
        data={data}
        columns={columns as any}
        onCellUpdate={onCellUpdate}
      />,
    );
    const cell = screen.getByText('John Doe');
    fireEvent.doubleClick(cell);
    const input = screen.getByDisplayValue('John Doe');
    fireEvent.change(input, { target: { value: 'Jane Doe' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onCellUpdate).toHaveBeenCalledWith('1', 'name', 'Jane Doe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test inline-editable-table.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement cell editors and InlineEditableTable**

```tsx
// apps/web/src/components/views/cell-editors/text-cell-editor.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';

interface TextCellEditorProps {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

export function TextCellEditor({ value, onCommit, onCancel }: TextCellEditorProps) {
  const [val, setVal] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onCommit(val.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(val.trim())}
      onKeyDown={handleKeyDown}
      className="w-full px-1.5 py-0.5 text-xs bg-surface border border-brand rounded-sm outline-none shadow-xs"
    />
  );
}
```

```tsx
// apps/web/src/components/views/cell-editors/badge-select-cell-editor.tsx
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/primitives';

interface BadgeSelectCellEditorProps {
  value: string;
  label: string;
  tone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  options: { value: string; label: string; tone: any }[];
  onCommit: (next: string) => void;
}

export function BadgeSelectCellEditor({
  value,
  label,
  tone,
  options,
  onCommit,
}: BadgeSelectCellEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="cursor-pointer hover:opacity-85 transition-opacity"
      >
        <Badge tone={tone}>{label}</Badge>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-36 bg-surface border border-border/60 rounded-md shadow-lg p-1 flex flex-col gap-0.5">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onCommit(opt.value);
                setIsOpen(false);
              }}
              className={`text-left text-xs px-2 py-1 rounded-sm hover:bg-surface-muted transition-colors flex items-center justify-between ${
                opt.value === value ? 'font-semibold text-brand' : 'text-ink'
              }`}
            >
              <span>{opt.label}</span>
              <Badge tone={opt.tone} className="scale-75 origin-right">
                {opt.label}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

```tsx
// apps/web/src/components/views/inline-editable-table.tsx
'use client';

import React, { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { TextCellEditor } from './cell-editors/text-cell-editor';

interface InlineEditableTableProps<TData> {
  data: TData[];
  columns: (ColumnDef<TData, any> & { isEditable?: boolean })[];
  onCellUpdate: (rowId: string, field: string, nextValue: any) => Promise<void>;
  rowIdKey?: keyof TData;
}

export function InlineEditableTable<TData extends Record<string, any>>({
  data,
  columns,
  onCellUpdate,
  rowIdKey = 'id',
}: InlineEditableTableProps<TData>) {
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="w-full overflow-x-auto border border-border/60 rounded-lg bg-surface">
      <table className="w-full text-left border-collapse text-xs">
        <thead className="bg-surface-muted/50 border-b border-border/60 text-ink-muted uppercase font-semibold text-[11px] tracking-wider">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-3 py-2.5">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border/40">
          {table.getRowModel().rows.map((row) => {
            const rowId = String(row.original[rowIdKey]);
            return (
              <tr key={row.id} className="hover:bg-surface-muted/30 transition-colors">
                {row.getVisibleCells().map((cell) => {
                  const field = cell.column.id;
                  const isEditing = editingCell?.rowId === rowId && editingCell?.field === field;
                  const isEditable = (cell.column.columnDef as any).isEditable;

                  return (
                    <td
                      key={cell.id}
                      className="px-3 py-2 text-ink align-middle"
                      onDoubleClick={() => {
                        if (isEditable) setEditingCell({ rowId, field });
                      }}
                    >
                      {isEditing ? (
                        <TextCellEditor
                          value={String(cell.getValue() ?? '')}
                          onCommit={async (next) => {
                            setEditingCell(null);
                            if (next !== cell.getValue()) {
                              await onCellUpdate(rowId, field, next);
                            }
                          }}
                          onCancel={() => setEditingCell(null)}
                        />
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test inline-editable-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/views
git commit -m "feat(web): implement inline editable table and cell editors"
```

---

### Task 6: Native HTML5 Drag-and-Drop Kanban Board Component (`apps/web`)

**Files:**
- Create: `apps/web/src/components/views/kanban-board.tsx`
- Test: `apps/web/src/components/views/kanban-board.test.tsx`

**Interfaces:**
- Produces:
  - `<KanbanBoard<T> columns={stages} items={items} getStageKey={(item) => string} renderCard={(item) => ReactNode} onMoveStage={(itemId, nextStage) => Promise<void>} />`
  - Zero external drag-and-drop npm dependencies (pure native HTML5 DnD).

- [ ] **Step 1: Write tests for Kanban rendering and drop triggers**

```tsx
// apps/web/src/components/views/kanban-board.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard } from './kanban-board';
import React from 'react';

describe('KanbanBoard', () => {
  const columns = [
    { key: 'draft', label: 'Draft', color: 'slate' },
    { key: 'approved', label: 'Approved', color: 'emerald' },
  ];
  const items = [{ id: 'item-1', title: 'Quote 1', status: 'draft' }];

  it('renders columns and items', () => {
    render(
      <KanbanBoard
        columns={columns}
        items={items}
        getStageKey={(i) => i.status}
        getItemId={(i) => i.id}
        renderCard={(i) => <div>{i.title}</div>}
        onMoveStage={vi.fn()}
      />,
    );
    expect(screen.getByText('Draft')).toBeDefined();
    expect(screen.getByText('Approved')).toBeDefined();
    expect(screen.getByText('Quote 1')).toBeDefined();
  });

  it('triggers onMoveStage on drop', () => {
    const onMoveStage = vi.fn().mockResolvedValue(undefined);
    render(
      <KanbanBoard
        columns={columns}
        items={items}
        getStageKey={(i) => i.status}
        getItemId={(i) => i.id}
        renderCard={(i) => <div>{i.title}</div>}
        onMoveStage={onMoveStage}
      />,
    );

    const approvedCol = screen.getByLabelText('Approved column');
    fireEvent.drop(approvedCol, {
      dataTransfer: {
        getData: () => 'item-1',
      },
    });

    expect(onMoveStage).toHaveBeenCalledWith('item-1', 'approved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test kanban-board.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement KanbanBoard component**

```tsx
// apps/web/src/components/views/kanban-board.tsx
'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export interface KanbanColumnDef {
  key: string;
  label: string;
  color?: string;
  badge?: string;
  summaryTotal?: string;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumnDef[];
  items: T[];
  getItemId: (item: T) => string;
  getStageKey: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onMoveStage: (itemId: string, nextStageKey: string) => Promise<void>;
  cardClassName?: string;
}

export function KanbanBoard<T>({
  columns,
  items,
  getItemId,
  getStageKey,
  renderCard,
  onMoveStage,
  cardClassName = '',
}: KanbanBoardProps<T>) {
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>({});

  const toggleCollapse = (key: string) => {
    setCollapsedCols((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
      {columns.map((col) => {
        const isCollapsed = collapsedCols[col.key];
        const colItems = items.filter((item) => getStageKey(item) === col.key);
        const isOver = dragOverColKey === col.key;

        return (
          <section
            key={col.key}
            aria-label={`${col.label} column`}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            }}
            onDragEnter={() => setDragOverColKey(col.key)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverColKey(null);
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOverColKey(null);
              const itemId = e.dataTransfer.getData('text/plain');
              if (itemId) {
                await onMoveStage(itemId, col.key);
              }
            }}
            className={`flex flex-col shrink-0 transition-all duration-200 rounded-xl border bg-surface/50 ${
              isCollapsed ? 'w-16' : 'w-76'
            } ${
              isOver ? 'border-brand ring-2 ring-brand/20 bg-brand/5' : 'border-border/60'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border/40">
              <button
                type="button"
                onClick={() => toggleCollapse(col.key)}
                className="flex items-center gap-1.5 font-semibold text-xs text-ink hover:text-brand"
              >
                {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {!isCollapsed && <span>{col.label}</span>}
              </button>
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium bg-surface-muted px-1.5 py-0.5 rounded-full text-ink-muted">
                  {colItems.length}
                </span>
              </div>
            </div>

            {/* Total metric */}
            {!isCollapsed && col.summaryTotal && (
              <div className="px-3 py-1.5 text-[11px] font-medium text-ink-subtle bg-surface-muted/30 border-b border-border/20">
                {col.summaryTotal}
              </div>
            )}

            {/* Cards List */}
            {!isCollapsed && (
              <div className="flex flex-col gap-2 p-2.5 min-h-[350px]">
                {colItems.map((item) => {
                  const itemId = getItemId(item);
                  return (
                    <div
                      key={itemId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', itemId);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className={`cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow bg-surface border border-border/70 rounded-lg p-3 ${cardClassName}`}
                    >
                      {renderCard(item)}
                    </div>
                  );
                })}
                {colItems.length === 0 && (
                  <div className="h-24 flex items-center justify-center text-xs text-ink-subtle border border-dashed border-border/40 rounded-lg">
                    No items
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test kanban-board.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/views/kanban-board.*
git commit -m "feat(web): implement native HTML5 drag-and-drop Kanban board component"
```

---

### Task 7: Unified DataViewContainer & View Toolbar (`apps/web`)

**Files:**
- Create: `apps/web/src/components/views/view-toolbar.tsx`
- Create: `apps/web/src/components/views/data-view-container.tsx`
- Test: `apps/web/src/components/views/data-view-container.test.tsx`

**Interfaces:**
- Produces:
  - `<DataViewContainer>` managing:
    - Saved view tabs
    - View type switcher (Table vs. Kanban)
    - Search bar
    - Compound Filter Drawer
    - Column visibility dropdown

- [ ] **Step 1: Write test for DataViewContainer**

```tsx
// apps/web/src/components/views/data-view-container.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataViewContainer } from './data-view-container';
import React from 'react';

vi.mock('@/hooks/use-saved-views', () => ({
  useSavedViews: () => ({
    views: [{ id: '1', name: 'All', viewType: 'table', isDefault: true }],
    activeView: { id: '1', name: 'All', viewType: 'table', isDefault: true },
    setActiveViewId: vi.fn(),
    createView: vi.fn(),
    updateView: vi.fn(),
    deleteView: vi.fn(),
  }),
}));

describe('DataViewContainer', () => {
  it('renders top toolbar with view switcher and search', () => {
    render(
      <DataViewContainer
        entityType="quotes"
        search=""
        onSearchChange={vi.fn()}
      >
        <div>Content Body</div>
      </DataViewContainer>,
    );
    expect(screen.getByText('Content Body')).toBeDefined();
    expect(screen.getByPlaceholderText('Search...')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test data-view-container.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement ViewToolbar and DataViewContainer**

```tsx
// apps/web/src/components/views/view-toolbar.tsx
'use client';

import React from 'react';
import { Table, Kanban, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ViewLayoutType } from '@saas/shared';

interface ViewToolbarProps {
  viewType: ViewLayoutType;
  onViewTypeChange: (type: ViewLayoutType) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onOpenFilter?: () => void;
  filterCount?: number;
  actionSlot?: React.ReactNode;
}

export function ViewToolbar({
  viewType,
  onViewTypeChange,
  search,
  onSearchChange,
  onOpenFilter,
  filterCount = 0,
  actionSlot,
}: ViewToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 px-1 mb-3">
      {/* Left: View Switcher & Search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border/60 bg-surface-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => onViewTypeChange('table')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              viewType === 'table' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Table className="size-3.5" />
            <span className="hidden sm:inline">Table</span>
          </button>
          <button
            type="button"
            onClick={() => onViewTypeChange('kanban')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              viewType === 'kanban' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Kanban className="size-3.5" />
            <span className="hidden sm:inline">Pipeline</span>
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="pl-8 pr-3 py-1 text-xs bg-surface border border-border/60 rounded-md outline-none focus:border-brand w-48 sm:w-64 transition-all"
          />
        </div>
      </div>

      {/* Right: Filters & Actions */}
      <div className="flex items-center gap-2">
        {onOpenFilter && (
          <Button variant="outline" size="sm" onClick={onOpenFilter} className="gap-1.5 text-xs">
            <SlidersHorizontal className="size-3.5" />
            <span>Filter</span>
            {filterCount > 0 && (
              <span className="bg-brand text-ink text-[10px] px-1.5 rounded-full font-bold">
                {filterCount}
              </span>
            )}
          </Button>
        )}
        {actionSlot}
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/components/views/data-view-container.tsx
'use client';

import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSavedViews } from '@/hooks/use-saved-views';
import { ViewToolbar } from './view-toolbar';
import type { ViewLayoutType } from '@saas/shared';

interface DataViewContainerProps {
  entityType: string;
  search: string;
  onSearchChange: (search: string) => void;
  children: (props: { viewType: ViewLayoutType }) => React.ReactNode;
  actionSlot?: React.ReactNode;
}

export function DataViewContainer({
  entityType,
  search,
  onSearchChange,
  children,
  actionSlot,
}: DataViewContainerProps) {
  const { views, activeView, setActiveViewId, createView } = useSavedViews(entityType);
  const [viewType, setViewType] = useState<ViewLayoutType>('table');

  return (
    <div className="w-full flex flex-col">
      {/* Saved View Tabs */}
      <div className="flex items-center gap-1 border-b border-border/60 px-1 overflow-x-auto scrollbar-none">
        {views.map((v) => {
          const isActive = activeView?.id === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setActiveViewId(v.id);
                setViewType(v.viewType);
              }}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-brand text-brand font-semibold'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {v.name}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <ViewToolbar
        viewType={viewType}
        onViewTypeChange={setViewType}
        search={search}
        onSearchChange={onSearchChange}
        actionSlot={actionSlot}
      />

      {/* View Body */}
      <div className="w-full">
        {children({ viewType })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test data-view-container.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/views/view-toolbar.tsx apps/web/src/components/views/data-view-container.*
git commit -m "feat(web): implement unified DataViewContainer and ViewToolbar"
```

---

### Task 8: Rollout to Quotes (`/quotes`) with Confirmation Guard

**Files:**
- Modify: `apps/web/src/components/quotes/quotes-view.tsx`
- Modify: `apps/web/src/components/quotes/quotes-table.tsx`
- Test: `apps/web/src/components/quotes/quotes-view.test.tsx`

**Interfaces:**
- Quotes Table gains: Inline title editing, inline status badge selector.
- Quotes Kanban gains: Stages (`DRAFT`, `AWAITING_APPROVAL`, `APPROVED`, `REJECTED`), sum of values per column, drag-and-drop to `APPROVED` triggers quote approval signal with confirmation dialog.

- [ ] **Step 1: Write integration test for Quotes Kanban transition**

```tsx
// apps/web/src/components/quotes/quotes-view.test.tsx (Add Kanban & inline editing tests)
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotesView } from './quotes-view';
import React from 'react';

vi.mock('@/hooks/use-quotes', () => ({
  useQuotes: () => ({
    data: {
      items: [
        {
          id: 'q1',
          title: 'Custom Box Quote',
          status: 'DRAFT',
          totalAmount: 15000,
          customerName: 'Acme',
        },
      ],
      total: 1,
    },
    isLoading: false,
  }),
  useSignalQuote: () => ({ mutateAsync: vi.fn() }),
  useDownloadQuotePdf: () => ({ mutateAsync: vi.fn() }),
}));

describe('QuotesView with DataViewContainer', () => {
  it('renders quotes with view switcher', () => {
    render(<QuotesView />);
    expect(screen.getByText('Quotes')).toBeDefined();
    expect(screen.getByText('Table')).toBeDefined();
    expect(screen.getByText('Pipeline')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify status**

Run: `pnpm --filter web test quotes-view.test.tsx`
Expected: Fails or needs update

- [ ] **Step 3: Update QuotesView to mount DataViewContainer & Kanban**

Mount `<DataViewContainer>` in `QuotesView`. In `'table'` mode, render `<QuotesTable>` with inline editable status. In `'kanban'` mode, render `<KanbanBoard>` with quote stages:
```tsx
const QUOTE_STAGES: KanbanColumnDef[] = [
  { key: 'DRAFT', label: 'Quotation (Draft)', color: 'slate' },
  { key: 'AWAITING_APPROVAL', label: 'Awaiting Approval', color: 'amber' },
  { key: 'APPROVED', label: 'Confirmed', color: 'emerald' },
  { key: 'REJECTED', label: 'Rejected', color: 'rose' },
];
```
Connect `onMoveStage` to `handleSignal(quoteId, 'APPROVE')` when dropped into `APPROVED`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test quotes-view.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/quotes
git commit -m "feat(web): integrate DataViewContainer and Kanban pipeline into quotes"
```

---

### Task 9: Rollout to Contacts (`/contacts`) with Inline Status

**Files:**
- Modify: `apps/web/src/components/contacts/contacts-view.tsx`
- Test: `apps/web/src/components/contacts/contacts-view.test.tsx`

**Interfaces:**
- Contacts Table gains: Inline status badge picker, inline company name editing.
- Contacts Kanban gains: Stages (`lead`, `qualified`, `customer`, `churned`, `archived`) with optimistic drag-and-drop.

- [ ] **Step 1: Write test for Contacts DataViewContainer integration**

```tsx
// apps/web/src/components/contacts/contacts-view.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContactsView } from './contacts-view';
import React from 'react';

vi.mock('@/hooks/use-contacts', () => ({
  useContacts: () => ({
    data: {
      items: [
        {
          id: 'c1',
          fullName: 'John Doe',
          company: 'Acme Packaging',
          status: 'lead',
        },
      ],
      total: 1,
    },
    isPending: false,
  }),
  useDeleteContact: () => ({ mutateAsync: vi.fn() }),
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
}));

describe('ContactsView with DataViewContainer', () => {
  it('renders contacts with table and pipeline tabs', () => {
    render(<ContactsView />);
    expect(screen.getByText('Table')).toBeDefined();
    expect(screen.getByText('Pipeline')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter web test contacts-view.test.tsx`
Expected: FAIL

- [ ] **Step 3: Integrate DataViewContainer into ContactsView**

Mount `<DataViewContainer>` in `contacts-view.tsx`.
Define contact Kanban stages:
```tsx
const CONTACT_STAGES: KanbanColumnDef[] = [
  { key: 'lead', label: 'Lead', color: 'brand' },
  { key: 'qualified', label: 'Qualified', color: 'warning' },
  { key: 'customer', label: 'Customer', color: 'success' },
  { key: 'churned', label: 'Churned', color: 'danger' },
  { key: 'archived', label: 'Archived', color: 'neutral' },
];
```
Connect `onCellUpdate` and `onMoveStage` to `useUpdateContact().mutateAsync({ id, payload: { status } })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test contacts-view.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/contacts
git commit -m "feat(web): integrate DataViewContainer and Kanban pipeline into contacts"
```

---

### Task 10: End-to-End Verification, Drift & Build Check

**Files:**
- Verify: Full workspace build, unit test suite, and database drift check.

- [ ] **Step 1: Run workspace unit and component tests**

Run: `pnpm test`
Expected: All tests pass across shared, api, and web.

- [ ] **Step 2: Verify database migration drift**

Run: `pnpm check:drift`
Expected: Zero drift reported against baseline.

- [ ] **Step 3: Verify books trial balance**

Run: `pnpm check:books`
Expected: Every tenant trial balance sums to zero.

- [ ] **Step 4: Run full workspace build**

Run: `pnpm build`
Expected: Build passes with zero compile errors.

- [ ] **Step 5: Final commit**

```bash
git commit --allow-empty -m "chore: complete spreadsheet views and kanban pipeline implementation"
```
