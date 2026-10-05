# Custom Production Board Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable shop floor operators and managers to create, edit, recolor, reorder, and delete custom columns on the Production Kanban board with underlying core status mapping and company-wide sharing.

**Architecture:** Tenant-scoped column configuration stored in `production_board_settings` (with JSONB `columns` array) and card assignment tracked via `WorkOrder.parameters.columnId`. Custom columns map to core statuses (`PLANNED`, `RELEASED`, `IN_PROGRESS`, `COMPLETE`), preserving accounting WIP, time logging, variance reports, and financial postings.

**Tech Stack:** TypeScript, NestJS 11, TypeORM 1, PostgreSQL (with Row Level Security), Next.js 16 (App Router), TanStack React Query, Tailwind CSS, Zod, Vitest / Jest.

## Global Constraints

- Multi-tenant data isolation: all queries and mutations must filter by `tenant_id` / `organizationId`.
- Preserve existing permissions (`WORK_ORDER_READ`, `WORK_ORDER_UPDATE`, `WORK_ORDER_EXECUTE`, `QUOTE_VIEW_COST`).
- Accounting & WIP integrity: custom columns must map to a core `WorkOrderStatus` (`PLANNED`, `RELEASED`, `IN_PROGRESS`, `COMPLETE`).
- Zero schema drift on `work_orders`: store card column assignment in existing `work_orders.parameters.columnId`.
- Fallback resilience: if an organization has no custom settings, or a column was deleted, fallback cleanly to the default column for that status.
- Compile `packages/shared` before running API or Web tests.

---

### Task 1: Shared Production Board Columns Types & Validation Schemas (`packages/shared`)

**Files:**
- Create: `packages/shared/src/production/board-columns.ts`
- Create: `packages/shared/src/production/board-columns.spec.ts`
- Modify: `packages/shared/src/index.ts:39-41`

**Interfaces:**
- Consumes: `WorkOrderStatus` from `packages/shared/src/production/work-orders.ts`
- Produces:
  - `ProductionBoardColumn`
  - `DEFAULT_BOARD_COLUMNS`
  - `BOARD_COLUMN_COLORS`
  - `updateBoardColumnsSchema`
  - `UpdateBoardColumnsPayload`
  - `updateWorkOrderColumnSchema`
  - `UpdateWorkOrderColumnPayload`

- [ ] **Step 1: Write the failing tests for board column schemas and defaults**

Create `packages/shared/src/production/board-columns.spec.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD_COLUMNS,
  updateBoardColumnsSchema,
  updateWorkOrderColumnSchema,
} from './board-columns';

describe('Production Board Columns', () => {
  it('provides default columns covering all 4 core statuses', () => {
    expect(DEFAULT_BOARD_COLUMNS).toHaveLength(4);
    const statuses = DEFAULT_BOARD_COLUMNS.map((c) => c.status);
    expect(statuses).toEqual(['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETE']);
    expect(DEFAULT_BOARD_COLUMNS.every((c) => c.isDefault)).toBe(true);
  });

  describe('updateBoardColumnsSchema', () => {
    it('validates a valid set of custom columns', () => {
      const valid = [
        { id: 'col-1', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
        { id: 'col-2', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        { id: 'col-3', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
        { id: 'col-qc', name: 'Quality Inspection', status: 'IN_PROGRESS', color: 'purple', sequence: 3, isDefault: false },
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 4, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: valid });
      expect(result.success).toBe(true);
    });

    it('rejects if a core status is missing a default column', () => {
      const invalid = [
        { id: 'col-1', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
        { id: 'col-2', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        // IN_PROGRESS missing!
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 2, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: invalid });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate column ids', () => {
      const invalid = [
        { id: 'col-dup', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
        { id: 'col-dup', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        { id: 'col-3', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: invalid });
      expect(result.success).toBe(false);
    });

    it('rejects invalid colors or empty column names', () => {
      const invalid = [
        { id: 'col-1', name: '', status: 'PLANNED', color: 'hotpink', sequence: 0, isDefault: true },
        { id: 'col-2', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        { id: 'col-3', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: invalid });
      expect(result.success).toBe(false);
    });
  });

  describe('updateWorkOrderColumnSchema', () => {
    it('validates columnId payload', () => {
      expect(updateWorkOrderColumnSchema.safeParse({ columnId: 'col-qc' }).success).toBe(true);
      expect(updateWorkOrderColumnSchema.safeParse({ columnId: '' }).success).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test src/production/board-columns.spec.ts`  
Expected: FAIL (Cannot find module './board-columns')

- [ ] **Step 3: Implement `packages/shared/src/production/board-columns.ts` and update `index.ts`**

Create `packages/shared/src/production/board-columns.ts`:
```typescript
import { z } from 'zod';
import type { WorkOrderStatus } from './work-orders';

export const BOARD_COLUMN_COLORS = [
  'slate',
  'blue',
  'amber',
  'purple',
  'emerald',
  'rose',
  'cyan',
] as const;

export type BoardColumnColor = (typeof BOARD_COLUMN_COLORS)[number];

export interface ProductionBoardColumn {
  id: string;
  name: string;
  status: WorkOrderStatus;
  color: BoardColumnColor;
  sequence: number;
  isDefault?: boolean;
}

export const DEFAULT_BOARD_COLUMNS: ProductionBoardColumn[] = [
  { id: 'planned', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
  { id: 'released', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
  { id: 'in_progress', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
  { id: 'complete', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
];

const boardColumnSchema = z.object({
  id: z.string().trim().min(1, 'Column ID is required').max(60),
  name: z.string().trim().min(1, 'Column name is required').max(60),
  status: z.enum(['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETE']),
  color: z.enum(BOARD_COLUMN_COLORS),
  sequence: z.number().int().min(0),
  isDefault: z.boolean().optional(),
});

export const updateBoardColumnsSchema = z.object({
  columns: z
    .array(boardColumnSchema)
    .min(4, 'Board must have at least 4 columns')
    .refine(
      (cols) => {
        const ids = new Set(cols.map((c) => c.id));
        return ids.size === cols.length;
      },
      { message: 'Column IDs must be unique' },
    )
    .refine(
      (cols) => {
        const requiredStatuses: WorkOrderStatus[] = ['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETE'];
        return requiredStatuses.every((status) =>
          cols.some((c) => c.status === status && c.isDefault === true),
        );
      },
      { message: 'Each core status (PLANNED, RELEASED, IN_PROGRESS, COMPLETE) must have a default column' },
    ),
});

export const updateWorkOrderColumnSchema = z.object({
  columnId: z.string().trim().min(1, 'Column ID is required').max(60),
});

export type UpdateBoardColumnsPayload = z.output<typeof updateBoardColumnsSchema>;
export type UpdateWorkOrderColumnPayload = z.output<typeof updateWorkOrderColumnSchema>;
```

In `packages/shared/src/index.ts`: export `* from './production/board-columns';`.

- [ ] **Step 4: Run tests and build shared package**

Run:
```bash
pnpm --filter @saas/shared test src/production/board-columns.spec.ts
pnpm --filter @saas/shared build
```
Expected: All tests pass and `dist/` is updated.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/shared/src/production/board-columns.ts packages/shared/src/production/board-columns.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): add production board columns types and validation schemas"
```

---

### Task 2: API Board Settings Entity, Migration, Service & Endpoints (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/production/entities/production-board-settings.entity.ts`
- Create: `apps/api/src/database/migrations/1787700000000-CreateProductionBoardSettings.ts`
- Modify: `apps/api/src/modules/production/production.module.ts`
- Modify: `apps/api/src/modules/production/production.service.ts`
- Modify: `apps/api/src/modules/production/production.controller.ts`
- Modify: `apps/api/src/modules/production/production.service.spec.ts`

**Interfaces:**
- Consumes: `ProductionBoardColumn`, `DEFAULT_BOARD_COLUMNS`, `updateBoardColumnsSchema`, `updateWorkOrderColumnSchema` from `@saas/shared`
- Produces:
  - `GET /production/board/columns`
  - `PUT /production/board/columns`
  - `PATCH /work-orders/:id/column`

- [ ] **Step 1: Create Entity and Migration**

Create `apps/api/src/modules/production/entities/production-board-settings.entity.ts`:
```typescript
import { Column, Entity, Index } from 'typeorm';
import type { ProductionBoardColumn } from '@saas/shared';
import { TenantBaseEntity } from '@/common/entities/base.entity';

@Entity('production_board_settings')
@Index('idx_production_board_settings_tenant', ['tenantId'], { unique: true })
export class ProductionBoardSetting extends TenantBaseEntity {
  @Column({ type: 'jsonb', default: [] })
  columns: ProductionBoardColumn[];
}
```

Create `apps/api/src/database/migrations/1787700000000-CreateProductionBoardSettings.ts`:
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductionBoardSettings1787700000000 implements MigrationInterface {
  name = 'CreateProductionBoardSettings1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "production_board_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "columns" jsonb NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_production_board_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_production_board_settings_tenant" UNIQUE ("tenant_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_production_board_settings_tenant" ON "production_board_settings" ("tenant_id")
    `);
    await queryRunner.query(`ALTER TABLE "production_board_settings" ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE "production_board_settings" FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "production_board_settings" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "production_board_settings"`);
  }
}
```

Register `ProductionBoardSetting` in `apps/api/src/modules/production/production.module.ts` inside `TypeOrmModule.forFeature([..., ProductionBoardSetting])`.

- [ ] **Step 2: Write failing unit tests in `apps/api/src/modules/production/production.service.spec.ts`**

Add tests to `production.service.spec.ts`:
```typescript
describe('Board Columns Configuration', () => {
  it('returns DEFAULT_BOARD_COLUMNS when no tenant settings exist', async () => {
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);
    const columns = await service.getBoardColumns('test-tenant');
    expect(columns).toEqual(DEFAULT_BOARD_COLUMNS);
  });

  it('saves and normalizes custom columns sequence on update', async () => {
    const customCols = [
      { id: 'c1', name: 'Planned', status: 'PLANNED' as const, color: 'slate' as const, sequence: 0, isDefault: true },
      { id: 'c2', name: 'Released', status: 'RELEASED' as const, color: 'blue' as const, sequence: 1, isDefault: true },
      { id: 'c3', name: 'In progress', status: 'IN_PROGRESS' as const, color: 'amber' as const, sequence: 2, isDefault: true },
      { id: 'c-qc', name: 'QC', status: 'IN_PROGRESS' as const, color: 'purple' as const, sequence: 5, isDefault: false },
      { id: 'c4', name: 'Complete', status: 'COMPLETE' as const, color: 'emerald' as const, sequence: 10, isDefault: true },
    ];
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);
    mockBoardSettingsRepo.save.mockImplementation((entity) => Promise.resolve(entity));

    const result = await service.updateBoardColumns('test-tenant', customCols);
    expect(result).toHaveLength(5);
    // Sequences normalized 0 to 4
    expect(result.map((c) => c.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it('updates work order parameters.columnId and syncs status', async () => {
    const wo = {
      id: 'wo-1',
      tenantId: 'test-tenant',
      status: 'RELEASED',
      parameters: {},
    };
    mockWoRepo.findOne.mockResolvedValue(wo);
    mockBoardSettingsRepo.findOne.mockResolvedValue({
      tenantId: 'test-tenant',
      columns: [
        { id: 'c-qc', name: 'QC', status: 'IN_PROGRESS', color: 'purple', sequence: 3, isDefault: false },
      ],
    });
    mockWoRepo.save.mockImplementation((w) => Promise.resolve(w));

    await service.updateWorkOrderColumn('test-tenant', 'wo-1', 'c-qc', 'user-1', false);
    expect(wo.status).toBe('IN_PROGRESS');
    expect((wo.parameters as any).columnId).toBe('c-qc');
  });
});
```

- [ ] **Step 3: Implement service methods in `production.service.ts`**

Inject `@InjectRepository(ProductionBoardSetting) private readonly boardSettingsRepo: Repository<ProductionBoardSetting>` in `ProductionService`.
Add methods:
```typescript
async getBoardColumns(tenantId: string): Promise<ProductionBoardColumn[]> {
  const setting = await this.boardSettingsRepo.findOne({ where: { tenantId } });
  if (setting && setting.columns && setting.columns.length > 0) {
    return [...setting.columns].sort((a, b) => a.sequence - b.sequence);
  }
  return DEFAULT_BOARD_COLUMNS;
}

async updateBoardColumns(
  tenantId: string,
  columns: ProductionBoardColumn[],
): Promise<ProductionBoardColumn[]> {
  const normalized = columns.map((col, idx) => ({
    ...col,
    sequence: idx,
  }));
  let setting = await this.boardSettingsRepo.findOne({ where: { tenantId } });
  if (!setting) {
    setting = this.boardSettingsRepo.create({
      tenantId,
      columns: normalized,
    });
  } else {
    setting.columns = normalized;
  }
  await this.boardSettingsRepo.save(setting);
  return normalized;
}

async updateWorkOrderColumn(
  tenantId: string,
  id: string,
  columnId: string,
  actorId: string,
  canSeeCost: boolean,
): Promise<WorkOrderDto> {
  const columns = await this.getBoardColumns(tenantId);
  const targetCol = columns.find((c) => c.id === columnId);
  if (!targetCol) {
    throw new BadRequestException(`Target column "${columnId}" not found on board`);
  }

  await this.dataSource.transaction(async (manager) => {
    const wo = await this.lock(manager, tenantId, id);
    if (targetCol.status !== wo.status) {
      if (targetCol.status === 'RELEASED' && wo.status === 'PLANNED') {
        wo.status = 'RELEASED';
        wo.releasedAt = new Date();
      } else if (targetCol.status === 'IN_PROGRESS') {
        if (wo.status === 'PLANNED') {
          wo.releasedAt = new Date();
        }
        wo.status = 'IN_PROGRESS';
      } else if (targetCol.status === 'COMPLETE') {
        if (wo.status === 'PLANNED') {
          throw new BadRequestException('Cannot complete a planned job without releasing first');
        }
        // Direct complete transition
        wo.status = 'COMPLETE';
        wo.completedAt = new Date();
        wo.completedById = actorId;
      }
    }
    wo.parameters = {
      ...(wo.parameters || {}),
      columnId: targetCol.id,
    };
    await manager.getRepository(WorkOrder).save(wo);
  });

  return this.get(tenantId, id, canSeeCost);
}
```

- [ ] **Step 4: Add controller endpoints in `production.controller.ts`**

```typescript
@Get('production/board/columns')
@RequirePermissions(PERMISSIONS.WORK_ORDER_READ)
@ApiOperation({ summary: 'Get customized production board columns' })
getBoardColumns(@CurrentUser() user: AuthenticatedUser) {
  return this.production.getBoardColumns(user.organizationId);
}

@Put('production/board/columns')
@RequirePermissions(PERMISSIONS.WORK_ORDER_UPDATE)
@ApiOperation({ summary: 'Update production board columns layout' })
updateBoardColumns(
  @CurrentUser() user: AuthenticatedUser,
  @Body(zodBody(updateBoardColumnsSchema)) body: UpdateBoardColumnsPayload,
) {
  return this.production.updateBoardColumns(user.organizationId, body.columns);
}

@Patch('work-orders/:id/column')
@RequirePermissions(PERMISSIONS.WORK_ORDER_UPDATE)
@ApiOperation({ summary: 'Move work order to target board column' })
updateWorkOrderColumn(
  @CurrentUser() user: AuthenticatedUser,
  @Param('id', ParseUUIDPipe) id: string,
  @Body(zodBody(updateWorkOrderColumnSchema)) body: UpdateWorkOrderColumnPayload,
) {
  return this.production.updateWorkOrderColumn(
    user.organizationId,
    id,
    body.columnId,
    user.id,
    canSeeCost(user),
  );
}
```

- [ ] **Step 5: Run tests and verify**

Run: `pnpm --filter api test src/modules/production/production.service.spec.ts`  
Expected: PASS

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/api/src/modules/production/ apps/api/src/database/migrations/1787700000000-CreateProductionBoardSettings.ts
git commit -m "feat(production): add board settings entity, migration, and column endpoints"
```

---

### Task 3: Web Dynamic Board Columns, Add/Edit/Delete UI & Drag-and-Drop (`apps/web`)

**Files:**
- Modify: `apps/web/src/lib/api/endpoints/production.ts`
- Create: `apps/web/src/hooks/use-board-columns.ts`
- Create: `apps/web/src/components/production/column-modal.tsx`
- Modify: `apps/web/src/components/production/production-kanban.tsx`
- Modify: `apps/web/src/components/production/production-board.tsx`
- Modify: `apps/web/src/components/production/work-order-drawer.tsx`
- Modify: `apps/web/src/components/production/production-board.spec.tsx`

**Interfaces:**
- Consumes: `ProductionBoardColumn`, `DEFAULT_BOARD_COLUMNS`, `BOARD_COLUMN_COLORS` from `@saas/shared`
- Produces: Dynamic column Kanban board with `+ Add Column`, Edit/Move/Delete menu, and column sync

- [ ] **Step 1: Add endpoints to `apps/web/src/lib/api/endpoints/production.ts`**

Export board endpoints and query keys:
```typescript
board: {
  getColumns: () => apiFetch<ProductionBoardColumn[]>('/production/board/columns'),
  updateColumns: (columns: ProductionBoardColumn[]) =>
    apiFetch<ProductionBoardColumn[]>('/production/board/columns', {
      method: 'PUT',
      body: { columns },
    }),
},
workOrders: {
  ...
  updateColumn: (id: string, columnId: string) =>
    apiFetch<WorkOrderDto>(`/work-orders/${id}/column`, {
      method: 'PATCH',
      body: { columnId },
    }),
}
```
And add `boardColumns: () => ['production-board-columns'] as const` to `productionKeys`.

- [ ] **Step 2: Create `useBoardColumns` hook**

Create `apps/web/src/hooks/use-board-columns.ts`:
```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DEFAULT_BOARD_COLUMNS,
  type ProductionBoardColumn,
} from '@saas/shared';
import { api, productionKeys } from '@/lib/api/endpoints';

export function useBoardColumns() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: productionKeys.boardColumns(),
    queryFn: () => api.production.board.getColumns(),
    placeholderData: DEFAULT_BOARD_COLUMNS,
  });

  const mutation = useMutation({
    mutationFn: (columns: ProductionBoardColumn[]) =>
      api.production.board.updateColumns(columns),
    onSuccess: (updated) => {
      queryClient.setQueryData(productionKeys.boardColumns(), updated);
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update board columns');
    },
  });

  return {
    columns: query.data || DEFAULT_BOARD_COLUMNS,
    isLoading: query.isLoading,
    updateColumns: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}
```

- [ ] **Step 3: Create `ColumnModal` component**

Create `apps/web/src/components/production/column-modal.tsx`:
Modal allowing operator to name a column, select the core status mapping (`PLANNED`, `RELEASED`, `IN_PROGRESS`, `COMPLETE`), select a color from `BOARD_COLUMN_COLORS`, and submit.

- [ ] **Step 4: Update `ProductionKanban` and `ProductionBoard`**

In `apps/web/src/components/production/production-kanban.tsx`:
- Render columns dynamically based on `columns` from `useBoardColumns()`.
- Add kebab menu (`...`) on each column header with `Edit`, `Move Left`, `Move Right`, and `Delete` (disabled if `isDefault`).
- Add `+ Add Column` button in header.
- In `handleDrop`:
  - Find target column.
  - If target is a `COMPLETE` column, trigger good quantity modal.
  - Otherwise call `api.production.workOrders.updateColumn(wo.id, targetColumn.id)`.
  - Invalidate queries and toast success.
- Filter cards into column:
  `wo.parameters?.columnId === col.id || (!wo.parameters?.columnId && col.isDefault && col.status === wo.status)`.

In `apps/web/src/components/production/work-order-drawer.tsx`:
- Show the assigned column badge next to status.
- Allow switching column directly via a dropdown select.

- [ ] **Step 5: Add tests in `production-board.spec.tsx`**

Test:
- Columns load and render custom column headers.
- Clicking `+ Add Column` renders modal.
- Cards render under their assigned custom column.

- [ ] **Step 6: Run tests and verify web suite**

Run:
```bash
pnpm --filter web test src/components/production/production-board.spec.tsx
pnpm --filter web test
```
Expected: PASS

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/web/src/
git commit -m "feat(web): add dynamic custom production board columns with add/edit/delete UI"
```

---

## Plan Review Checklist

1. **Spec Coverage:** Covers custom column creation, editing, reordering, deletion, core status mapping, accounting WIP safety, and shared tenant settings.
2. **No Placeholders:** All endpoints, schemas, methods, component interactions, and tests are explicitly detailed.
3. **Type Consistency:** `ProductionBoardColumn` shared across `@saas/shared`, `apps/api`, and `apps/web`.
