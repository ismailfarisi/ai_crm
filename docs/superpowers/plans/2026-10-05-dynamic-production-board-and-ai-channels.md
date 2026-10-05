# Dynamic Production Board, Gantt Chart & AI Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the static shop floor Production board into an interactive Jira-like Kanban and Gantt timeline, enable natural language production control and queries via Telegram/WhatsApp channels, and deploy a proactive check-in cron job to monitor running timers and delayed jobs.

**Architecture:** 
- The existing `ProductionService` remains the single domain source of truth for work order status transitions and operation clock timers.
- On the backend, we introduce `WorkOrderManageSkill` and `WorkOrderQuerySkill` into `SkillRegistry`, expanding natural language channel control via Telegram, alongside `ProductionCheckInService` that runs on a schedule to ping operators about overdue or long-running steps.
- On the frontend, `ProductionBoard` is decomposed into a dynamic Kanban board (`production-kanban.tsx`, `work-order-card.tsx`) with drag-and-drop status changes, live operation steppers, and a slide-over detail drawer (`work-order-drawer.tsx`), paired with a toggleable dual-mode Gantt chart (`production-gantt.tsx`).

**Tech Stack:** Next.js 15, React 19, Tailwind CSS, Lucide icons, TanStack React Query, NestJS 11, TypeORM, Zod, Jest, Vitest.

## Global Constraints

- Preserve all existing permissions (`WORK_ORDER_READ`, `WORK_ORDER_CREATE`, `WORK_ORDER_UPDATE`, `WORK_ORDER_EXECUTE`, `QUOTE_VIEW_COST`).
- Multi-tenant data isolation: all queries and mutations must filter by tenant/organization ID.
- Maintain existing database entity schemas without breaking drift checks or requiring unexpected migrations.
- Conversational channels must route through `SkillRegistry` and map inputs into strict Zod schemas.

---

### Task 1: Shared Channel Skills Vocabulary & Types (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/channels/skills.ts`
- Modify: `packages/shared/src/channels/skills.spec.ts`

**Interfaces:**
- Produces: `CHANNEL_SKILLS.WORK_ORDER_MANAGE = 'work_order.manage'` and `CHANNEL_SKILLS.WORK_ORDER_QUERY = 'work_order.query'` in `ChannelSkillName`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/channels/skills.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { CHANNEL_SKILLS } from './skills';

describe('CHANNEL_SKILLS production additions', () => {
  it('defines WORK_ORDER_MANAGE and WORK_ORDER_QUERY', () => {
    expect(CHANNEL_SKILLS.WORK_ORDER_MANAGE).toBe('work_order.manage');
    expect(CHANNEL_SKILLS.WORK_ORDER_QUERY).toBe('work_order.query');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test src/channels/skills.spec.ts`
Expected: FAIL with `CHANNEL_SKILLS.WORK_ORDER_MANAGE is undefined`

- [ ] **Step 3: Update `packages/shared/src/channels/skills.ts`**

Add `WORK_ORDER_MANAGE` and `WORK_ORDER_QUERY` to `CHANNEL_SKILLS`:
```typescript
export const CHANNEL_SKILLS = {
  QUOTE_APPROVE: 'quote.approve',
  QUOTE_CREATE: 'quote.create',
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  WORK_ORDER_LOG_TIME: 'work_order.log_time',
  WORK_ORDER_MANAGE: 'work_order.manage',
  WORK_ORDER_QUERY: 'work_order.query',
  DELIVERY_DISPATCH: 'delivery.dispatch',
  SALES_ORDER_FROM_DOCUMENT: 'sales_order.from_document',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saas/shared test src/channels/skills.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/shared/src/channels/skills.ts packages/shared/src/channels/skills.spec.ts
git commit -m "feat(shared): register work_order.manage and work_order.query channel skills"
```

---

### Task 2: AI Channel Skills — `WorkOrderManageSkill` & `WorkOrderQuerySkill` (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/channels/skills/work-order-manage.skill.ts`
- Create: `apps/api/src/modules/channels/skills/work-order-manage.skill.spec.ts`
- Create: `apps/api/src/modules/channels/skills/work-order-query.skill.ts`
- Create: `apps/api/src/modules/channels/skills/work-order-query.skill.spec.ts`
- Modify: `apps/api/src/modules/channels/skills/skill.registry.ts`

**Interfaces:**
- Consumes: `ProductionService.list`, `get`, `startOperation`, `stopOperation`, `release`, `complete`, `cancel`.
- Produces: `WorkOrderManageSkill` and `WorkOrderQuerySkill` registered in `SkillRegistry`.

- [ ] **Step 1: Write failing tests for `WorkOrderManageSkill`**

Create `apps/api/src/modules/channels/skills/work-order-manage.skill.spec.ts`:
```typescript
import { WorkOrderManageSkill } from './work-order-manage.skill';
import { ProductionService } from '../../production/production.service';
import type { SkillContext } from './skill.types';

describe('WorkOrderManageSkill', () => {
  let skill: WorkOrderManageSkill;
  let production: Partial<ProductionService>;
  const ctx: SkillContext = {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    channelProvider: 'TELEGRAM',
  };

  beforeEach(() => {
    production = {
      list: jest.fn(),
      get: jest.fn(),
      release: jest.fn(),
      complete: jest.fn(),
      startOperation: jest.fn(),
      stopOperation: jest.fn(),
    };
    skill = new WorkOrderManageSkill(production as ProductionService);
  });

  it('starts operation timer when work order and operation are specified', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        description: 'Rigid gift box',
        status: 'RELEASED',
        operations: [
          { id: 'op-1', label: 'Die cutting', status: 'PENDING', workCenterName: 'Die Cutter' },
        ],
      },
    ]);
    (production.startOperation as jest.Mock).mockResolvedValue({
      id: 'wo-1',
      woNumber: 'WO-2026-0003',
      operations: [{ id: 'op-1', label: 'Die cutting', status: 'RUNNING' }],
    });

    const res = await skill.resolve(
      { workOrderNumber: 'WO-2026-0003', action: 'START', operationQuery: 'die cutting' },
      ctx,
    );

    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(production.startOperation).toHaveBeenCalledWith('org-1', 'wo-1', 'op-1', 'user-1');
      expect(outcome.reply).toContain('Started timer for "Die cutting"');
    }
  });

  it('asks for work order number when missing', async () => {
    const res = await skill.resolve({ action: 'START' }, ctx);
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toMatch(/which work order/i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test src/modules/channels/skills/work-order-manage.skill.spec.ts`
Expected: FAIL with "Cannot find module ./work-order-manage.skill"

- [ ] **Step 3: Implement `WorkOrderManageSkill`**

Create `apps/api/src/modules/channels/skills/work-order-manage.skill.ts`:
```typescript
import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { ProductionService } from '../../production/production.service';
import type { ChannelSkill, SkillContext } from './skill.types';

const slotSchema = z.object({
  workOrderNumber: z.string().optional(),
  action: z.enum(['START', 'STOP', 'FINISH', 'RELEASE', 'COMPLETE', 'CANCEL', 'ADVANCE']).optional(),
  operationQuery: z.string().optional(),
  quantityCompleted: z.number().positive().optional(),
  cancelReason: z.string().optional(),
});

export interface ResolvedWorkOrderManage {
  workOrderId: string;
  woNumber: string;
  action: 'START' | 'STOP' | 'FINISH' | 'RELEASE' | 'COMPLETE' | 'CANCEL' | 'ADVANCE';
  operationId?: string;
  operationLabel?: string;
  quantityCompleted?: number;
  cancelReason?: string;
}

export class WorkOrderManageSkill implements ChannelSkill<ResolvedWorkOrderManage> {
  readonly name = CHANNEL_SKILLS.WORK_ORDER_MANAGE;
  readonly description =
    'Manage production work orders and operation timers: release jobs, start/pause/finish operation clocks, advance to the next step, or mark jobs complete.';
  readonly examples = [
    'start die cutting on WO-2026-0003',
    'pause timer on WO-2026-0003',
    'finish printing on WO-2026-0003 and advance',
    'release WO-2026-0003 to the floor',
    'mark WO-2026-0001 complete with 200 pcs',
  ];
  readonly requiredPermissions = [PERMISSIONS.WORK_ORDER_EXECUTE];
  readonly jsonSchema = {
    type: 'object',
    properties: {
      workOrderNumber: { type: 'string', description: 'Work order number, e.g. "WO-2026-0003"' },
      action: {
        type: 'string',
        enum: ['START', 'STOP', 'FINISH', 'RELEASE', 'COMPLETE', 'CANCEL', 'ADVANCE'],
        description: 'The production action to execute',
      },
      operationQuery: { type: 'string', description: 'Operation or machine name, e.g. "die cutting"' },
      quantityCompleted: { type: 'number', description: 'Good pieces produced when completing a job' },
      cancelReason: { type: 'string', description: 'Reason for cancellation' },
    },
    additionalProperties: false,
  };
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'wo-manage/1';

  constructor(private readonly production: ProductionService) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedWorkOrderManage>> {
    const woNum = typeof slots.workOrderNumber === 'string' ? slots.workOrderNumber.trim().toUpperCase() : null;
    if (!woNum) {
      return { kind: 'question', question: 'Which work order would you like to update? (e.g. WO-2026-0003)', slots };
    }

    const jobs = await this.production.list(ctx.organizationId, {}, false);
    const wo = jobs.find((j) => j.woNumber.toUpperCase() === woNum);
    if (!wo) {
      return { kind: 'refused', reason: `I could not find work order ${woNum}.` };
    }

    const action = (slots.action as ResolvedWorkOrderManage['action']) || 'START';

    if (action === 'RELEASE') {
      return {
        kind: 'resolved',
        value: { workOrderId: wo.id, woNumber: wo.woNumber, action: 'RELEASE' },
      };
    }

    if (action === 'COMPLETE') {
      const qty = typeof slots.quantityCompleted === 'number' ? slots.quantityCompleted : wo.qty;
      return {
        kind: 'resolved',
        value: { workOrderId: wo.id, woNumber: wo.woNumber, action: 'COMPLETE', quantityCompleted: qty },
      };
    }

    if (action === 'CANCEL') {
      return {
        kind: 'resolved',
        value: { workOrderId: wo.id, woNumber: wo.woNumber, action: 'CANCEL', cancelReason: (slots.cancelReason as string) ?? 'Cancelled via chat' },
      };
    }

    // Operation-level actions: START, STOP, FINISH, ADVANCE
    const opQuery = typeof slots.operationQuery === 'string' ? slots.operationQuery.toLowerCase().trim() : null;
    let targetOp = opQuery
      ? wo.operations.find(
          (op) =>
            op.label.toLowerCase().includes(opQuery) ||
            op.workCenterName.toLowerCase().includes(opQuery),
        )
      : undefined;

    if (!targetOp) {
      if (action === 'STOP') {
        targetOp = wo.operations.find((op) => op.status === 'RUNNING');
      } else if (action === 'START' || action === 'ADVANCE') {
        targetOp = wo.operations.find((op) => op.status === 'PENDING');
      }
    }

    if (!targetOp && (action === 'START' || action === 'STOP' || action === 'FINISH')) {
      const opList = wo.operations.map((op, i) => `${i + 1}. ${op.label} (${op.status})`).join('\n');
      return {
        kind: 'question',
        question: `Which operation on ${wo.woNumber}?\n${opList}`,
        slots: { ...slots, workOrderNumber: wo.woNumber, action },
      };
    }

    return {
      kind: 'resolved',
      value: {
        workOrderId: wo.id,
        woNumber: wo.woNumber,
        action,
        operationId: targetOp?.id,
        operationLabel: targetOp?.label,
      },
    };
  }

  async preview(value: ResolvedWorkOrderManage): Promise<string> {
    if (value.action === 'RELEASE') return `Release ${value.woNumber} to the floor?`;
    if (value.action === 'COMPLETE') return `Complete ${value.woNumber} with ${value.quantityCompleted ?? 0} pieces?`;
    if (value.action === 'CANCEL') return `Cancel ${value.woNumber}?`;
    return `${value.action} ${value.operationLabel ?? 'operation'} on ${value.woNumber}?`;
  }

  async execute(value: ResolvedWorkOrderManage, ctx: SkillContext): Promise<SkillOutcome> {
    switch (value.action) {
      case 'RELEASE': {
        await this.production.release(ctx.organizationId, value.workOrderId);
        return { reply: `✅ ${value.woNumber} has been released to the shop floor.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'COMPLETE': {
        await this.production.complete(ctx.organizationId, value.workOrderId, ctx.userId, { qtyCompleted: value.quantityCompleted ?? null }, false);
        return { reply: `✅ ${value.woNumber} marked COMPLETE (${value.quantityCompleted} units posted).`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'CANCEL': {
        await this.production.cancel(ctx.organizationId, value.workOrderId, value.cancelReason ?? 'Cancelled via chat');
        return { reply: `⚠️ ${value.woNumber} cancelled.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'START': {
        if (!value.operationId) throw new Error('Operation is required to start clock');
        await this.production.startOperation(ctx.organizationId, value.workOrderId, value.operationId, ctx.userId);
        return { reply: `⏱️ Started timer for "${value.operationLabel}" on ${value.woNumber}.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'STOP': {
        if (!value.operationId) throw new Error('Operation is required to stop clock');
        const res = await this.production.stopOperation(ctx.organizationId, value.workOrderId, value.operationId, false);
        return { reply: `⏸️ Paused "${value.operationLabel}" on ${value.woNumber}. Time logged.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'FINISH':
      case 'ADVANCE': {
        if (!value.operationId) throw new Error('Operation is required to finish');
        await this.production.stopOperation(ctx.organizationId, value.workOrderId, value.operationId, true);
        return { reply: `✅ Finished "${value.operationLabel}" on ${value.woNumber}. Step marked DONE.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
    }
  }
}
```

- [ ] **Step 4: Implement `WorkOrderQuerySkill` & Tests**

Create `apps/api/src/modules/channels/skills/work-order-query.skill.ts` and its spec `work-order-query.skill.spec.ts`.
Support querying currently running machines, work order status summary, and overdue list.

- [ ] **Step 5: Register both skills in `SkillRegistry`**

In `apps/api/src/modules/channels/skills/skill.registry.ts`:
Inject `production: ProductionService` and add instances of `WorkOrderManageSkill` and `WorkOrderQuerySkill` into `this.skills`.

- [ ] **Step 6: Run tests to verify**

Run: `pnpm --filter api test src/modules/channels/skills/work-order-manage.skill.spec.ts`
Run: `pnpm --filter api test src/modules/channels/skills/work-order-query.skill.spec.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit changes**

```bash
git add apps/api/src/modules/channels/skills/work-order-manage.skill.ts \
        apps/api/src/modules/channels/skills/work-order-manage.skill.spec.ts \
        apps/api/src/modules/channels/skills/work-order-query.skill.ts \
        apps/api/src/modules/channels/skills/work-order-query.skill.spec.ts \
        apps/api/src/modules/channels/skills/skill.registry.ts
git commit -m "feat(channels): add work_order.manage and work_order.query skills"
```

---

### Task 3: Proactive Production Check-In Cron (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/production/production-check-in.service.ts`
- Create: `apps/api/src/modules/production/production-check-in.service.spec.ts`
- Modify: `apps/api/src/modules/production/production.module.ts`

**Interfaces:**
- Consumes: `ProductionService`, `StaffChannelIdentity` repository, `ChannelsService`.
- Produces: `@Cron` background job checking long-running operations and overdue orders, sending proactive Telegram notifications with conversational TTL.

- [ ] **Step 1: Write failing test for `ProductionCheckInService`**

Create `apps/api/src/modules/production/production-check-in.service.spec.ts`:
Verify that operations with `actualMinutes + elapsed > estimated` trigger check-in pings, respect 2-hour cooldown, and resolve the correct recipient.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test src/modules/production/production-check-in.service.spec.ts`
Expected: FAIL with "Cannot find module ./production-check-in.service"

- [ ] **Step 3: Implement `ProductionCheckInService`**

Create `apps/api/src/modules/production/production-check-in.service.ts`:
Include `@Cron(CronExpression.EVERY_30_MINUTES)` execution, scan for over-estimate timers, resolve Telegram recipient via `StaffChannelIdentity`, apply cooldown check, and dispatch notification via `ChannelsService`.

- [ ] **Step 4: Register in `ProductionModule`**

Update `apps/api/src/modules/production/production.module.ts` to import `ChannelsModule`, `StaffChannelIdentity`, and register `ProductionCheckInService` as a provider.

- [ ] **Step 5: Run tests to verify**

Run: `pnpm --filter api test src/modules/production/production-check-in.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add apps/api/src/modules/production/production-check-in.service.ts \
        apps/api/src/modules/production/production-check-in.service.spec.ts \
        apps/api/src/modules/production/production.module.ts
git commit -m "feat(production): add proactive check-in cron service for channels"
```

---

### Task 4: Dynamic Jira-like Kanban Board & Slide-Over Drawer (`apps/web`)

**Files:**
- Create: `apps/web/src/components/production/work-order-card.tsx`
- Create: `apps/web/src/components/production/work-order-drawer.tsx`
- Create: `apps/web/src/components/production/production-kanban.tsx`
- Modify: `apps/web/src/components/production/production-board.tsx`
- Create: `apps/web/src/components/production/production-board.spec.tsx`

**Interfaces:**
- Consumes: `useWorkOrders`, `useWorkOrderAction`, `WorkOrderDto`.
- Produces: Drag-and-drop Kanban board, operation mini-stepper with live timer pulse, quick actions, KPI summary strip, and slide-over floor drawer.

- [ ] **Step 1: Create `work-order-card.tsx`**

Build the card with HTML5 drag attributes (`draggable`, `onDragStart`), operation mini-stepper dots, live running clock animation, quick "Release" or "Start Timer" button, and onClick drawer handler.

- [ ] **Step 2: Create `work-order-drawer.tsx`**

Build the slide-over detail drawer using `@/components/ui/dialog` or custom slide-over drawer showing operations stepper, live start/stop/finish clock controls, operator assignment, and quick time logging.

- [ ] **Step 3: Create `production-kanban.tsx`**

Build the 4-column board (`Planned`, `Released`, `In progress`, `Complete`) with drop target zones (`onDragOver`, `onDrop`), smooth drop indicators, and automatic status transition mutation triggers with optimistic updates.

- [ ] **Step 4: Update `production-board.tsx`**

Integrate:
- KPI Summary strip: Active jobs, Running clocks counter, Overdue count, Est vs actual efficiency.
- Search input (WO #, description, customer).
- View switcher segmented control: `[ Kanban Board | Gantt Timeline ]`.
- Render `ProductionKanban` when Kanban mode is selected.

- [ ] **Step 5: Write unit tests in `production-board.spec.tsx`**

Verify KPI strip calculation, search filter filtering cards, and column rendering.

- [ ] **Step 6: Run tests to verify**

Run: `pnpm --filter web test src/components/production/production-board.spec.tsx`
Expected: PASS

- [ ] **Step 7: Commit changes**

```bash
git add apps/web/src/components/production/work-order-card.tsx \
        apps/web/src/components/production/work-order-drawer.tsx \
        apps/web/src/components/production/production-kanban.tsx \
        apps/web/src/components/production/production-board.tsx \
        apps/web/src/components/production/production-board.spec.tsx
git commit -m "feat(web): add dynamic jira-like kanban board with stepper and drawer"
```

---

### Task 5: Production Gantt Chart View (`apps/web`)

**Files:**
- Create: `apps/web/src/components/production/production-gantt.tsx`
- Modify: `apps/web/src/components/production/production-board.tsx`

**Interfaces:**
- Consumes: `WorkOrderDto[]` from `useWorkOrders`.
- Produces: Interactive Gantt chart toggleable between "By Work Order" and "By Work Centre" with zoom controls and click-to-drawer interaction.

- [ ] **Step 1: Implement `production-gantt.tsx`**

Features:
- View Mode Toggle: `By Work Order` (rows = jobs, bars = job duration with operation blocks) vs `By Work Centre` (rows = machines, bars = queued operations).
- Zoom scale: `Day`, `Week`, `Month`.
- Vertical "Today / Now" red indicator line.
- Color-coded bars by status with progress fill.
- Tooltip on hover with job number, operation, and hours.
- Clicking any bar triggers the slide-over `WorkOrderDrawer`.

- [ ] **Step 2: Connect Gantt View to `production-board.tsx`**

When the view switcher is set to `Gantt Timeline`, render `<ProductionGantt workOrders={filteredJobs} onSelectWorkOrder={setSelectedWorkOrderId} />`.

- [ ] **Step 3: Run web tests to verify no regressions**

Run: `pnpm --filter web test`
Expected: ALL PASS

- [ ] **Step 4: Commit changes**

```bash
git add apps/web/src/components/production/production-gantt.tsx \
        apps/web/src/components/production/production-board.tsx
git commit -m "feat(web): add production gantt chart view by work order and work centre"
```

---

### Task 6: Full Verification & Integration Polish

- [ ] **Step 1: Run complete shared test suite**
Run: `pnpm --filter @saas/shared test`
Expected: ALL PASS

- [ ] **Step 2: Run complete backend API test suite & evals**
Run: `pnpm --filter api test`
Expected: ALL PASS

- [ ] **Step 3: Run complete web frontend test suite**
Run: `pnpm --filter web test`
Expected: ALL PASS

- [ ] **Step 4: Verify production builds**
Run: `pnpm --filter api build && pnpm --filter web build`
Expected: Clean build without TypeScript or bundle errors

- [ ] **Step 5: Final review commit**
```bash
git commit --allow-empty -m "chore(release): complete dynamic production board, gantt chart and ai channels"
```
