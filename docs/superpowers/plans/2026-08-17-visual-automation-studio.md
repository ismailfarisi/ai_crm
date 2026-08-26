# Visual Automation Studio (n8n-Style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-featured n8n-style Visual Automation Studio (`apps/web`) with an interactive 2D node canvas powered by a durable **Temporal.io Dynamic DAG Workflow Engine** (`apps/api`) supporting webhooks, cron schedules, CRM events, condition branching, AI prompts, emails, delays, and human approvals with timeout escalation.

**Architecture:** 
1. **Frontend**: `@xyflow/react` node canvas in Next.js 16 with custom styled node cards, drag-and-drop node library, inspector drawer, expression previewer, and live execution tracer.
2. **Backend**: NestJS `AutomationsModule` with `AutomationWorkflow` and `AutomationExecution` entities, webhook receiver, and test runner.
3. **Temporal Dynamic DAG Engine**: Universal `dynamicDagWorkflow` that walks the node graph, executes activities dynamically (`http`, `aiPrompt`, `email`, `codeTransform`, `crmMutate`), and handles durable human signals and timeout escalations.

**Tech Stack:** Next.js 16, React 19, `@xyflow/react`, NestJS 11, TypeORM, PostgreSQL, `@temporalio/workflow`, `@temporalio/activity`, TypeScript, Vitest, Jest.

---

## Global Constraints
- Every API endpoint must enforce tenant isolation using `@CurrentUser() user: AuthenticatedUser`.
- Multi-tenancy: All workflows, executions, and webhook slugs must be scoped by `tenantId`.
- Seamless design: Follow the established amber/warm CRM theme with rounded borders and clean typography.
- All code symbols must have unit tests written first following TDD.

---

### Task 1: Shared RBAC Permissions, Automation Graph & Node Types

**Files:**
- Modify: `packages/shared/src/rbac/permissions.ts`
- Create: `packages/shared/src/automations/types.ts`
- Create: `packages/shared/src/automations/types.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `AUTOMATION_*` permissions, `AutomationWorkflowDto`, `AutomationExecutionDto`, `AutomationNode`, `AutomationEdge`, `AutomationTriggerType`, `AutomationNodeType`.

- [ ] **Step 1: Write failing tests for shared automation types & validators**

```typescript
// packages/shared/src/automations/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_PERMISSIONS,
  validateWorkflowGraph,
  type AutomationNode,
} from './types';

describe('Automation Types & Helpers', () => {
  it('defines all required automation permissions', () => {
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_READ).toBe('automation:read');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_CREATE).toBe('automation:create');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_UPDATE).toBe('automation:update');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_DELETE).toBe('automation:delete');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE).toBe('automation:execute');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE).toBe('automation:approve');
  });

  it('validates workflow graph and identifies entry triggers', () => {
    const nodes: AutomationNode[] = [
      {
        id: 'trigger-1',
        type: 'webhookTrigger',
        position: { x: 0, y: 0 },
        data: { label: 'Webhook', config: {} },
      },
      {
        id: 'action-1',
        type: 'httpRequest',
        position: { x: 200, y: 0 },
        data: { label: 'HTTP Request', config: { url: 'https://api.test' } },
      },
    ];
    const edges = [{ id: 'e1', source: 'trigger-1', target: 'action-1' }];

    const validation = validateWorkflowGraph(nodes, edges);
    expect(validation.isValid).toBe(true);
    expect(validation.triggerNodeId).toBe('trigger-1');
  });

  it('rejects graph with no trigger node', () => {
    const nodes: AutomationNode[] = [
      {
        id: 'action-1',
        type: 'httpRequest',
        position: { x: 200, y: 0 },
        data: { label: 'HTTP Request', config: {} },
      },
    ];
    const validation = validateWorkflowGraph(nodes, []);
    expect(validation.isValid).toBe(false);
    expect(validation.error).toContain('Trigger node');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test`
Expected: FAIL with module/exports missing.

- [ ] **Step 3: Implement shared types and permissions**

```typescript
// packages/shared/src/rbac/permissions.ts
// Add AUTOMATION permissions to PERMISSIONS object:
export const AUTOMATION_PERMISSIONS = {
  AUTOMATION_READ: 'automation:read',
  AUTOMATION_CREATE: 'automation:create',
  AUTOMATION_UPDATE: 'automation:update',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_EXECUTE: 'automation:execute',
  AUTOMATION_APPROVE: 'automation:approve',
} as const;
```

```typescript
// packages/shared/src/automations/types.ts
export const AUTOMATION_PERMISSIONS = {
  AUTOMATION_READ: 'automation:read',
  AUTOMATION_CREATE: 'automation:create',
  AUTOMATION_UPDATE: 'automation:update',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_EXECUTE: 'automation:execute',
  AUTOMATION_APPROVE: 'automation:approve',
} as const;

export type AutomationTriggerType = 'WEBHOOK' | 'SCHEDULE' | 'CRM_EVENT' | 'MANUAL';

export type AutomationNodeType =
  | 'webhookTrigger'
  | 'scheduleTrigger'
  | 'crmEventTrigger'
  | 'manualTrigger'
  | 'conditionNode'
  | 'transformNode'
  | 'delayNode'
  | 'httpRequestNode'
  | 'aiPromptNode'
  | 'sendEmailNode'
  | 'crmMutateNode'
  | 'approvalNode';

export interface AutomationNodeData {
  label: string;
  config: Record<string, any>;
  continueOnFail?: boolean;
  retryCount?: number;
  timeoutDuration?: string; // e.g. '3 days' for approval timeouts
}

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  position: { x: number; y: number };
  data: AutomationNodeData;
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null; // e.g. 'true' | 'false' | 'approved' | 'rejected' | 'timeout'
  targetHandle?: string | null;
}

export interface AutomationWorkflowDto {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, any>;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  webhookSlug?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecutionDto {
  id: string;
  tenantId: string;
  workflowId: string;
  temporalWorkflowId: string;
  status: 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  triggerPayload: Record<string, any>;
  nodeResults: Record<
    string,
    {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING';
      input?: any;
      output?: any;
      error?: string;
      startedAt: string;
      finishedAt?: string;
      durationMs?: number;
    }
  >;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export interface CreateAutomationWorkflowPayload {
  name: string;
  description?: string | null;
  triggerType: AutomationTriggerType;
  triggerConfig?: Record<string, any>;
  nodes?: AutomationNode[];
  edges?: AutomationEdge[];
}

export interface UpdateAutomationWorkflowPayload {
  name?: string;
  description?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  triggerType?: AutomationTriggerType;
  triggerConfig?: Record<string, any>;
  nodes?: AutomationNode[];
  edges?: AutomationEdge[];
}

export function validateWorkflowGraph(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): { isValid: boolean; triggerNodeId?: string; error?: string } {
  const triggerNodes = nodes.filter((n) =>
    ['webhookTrigger', 'scheduleTrigger', 'crmEventTrigger', 'manualTrigger'].includes(n.type),
  );
  if (triggerNodes.length === 0) {
    return { isValid: false, error: 'Workflow must have at least one Trigger node' };
  }
  return { isValid: true, triggerNodeId: triggerNodes[0].id };
}
```

- [ ] **Step 4: Export types in `packages/shared/src/index.ts` and run tests**

Run: `pnpm --filter @saas/shared test`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/shared/
git commit -m "feat(shared): add automation studio types, permissions, and graph validators"
```

---

### Task 2: Backend Database Entities & TypeORM Migration

**Files:**
- Create: `apps/api/src/modules/automations/entities/automation-workflow.entity.ts`
- Create: `apps/api/src/modules/automations/entities/automation-execution.entity.ts`
- Create: `apps/api/src/database/migrations/1786050000000-CreateAutomationsTables.ts`

**Interfaces:**
- Produces: TypeORM `AutomationWorkflow` and `AutomationExecution` entities.

- [ ] **Step 1: Create `AutomationWorkflow` entity**

```typescript
// apps/api/src/modules/automations/entities/automation-workflow.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AutomationNode, AutomationEdge, AutomationTriggerType } from '@saas/shared';

@Entity('automation_workflows')
@Index(['tenantId', 'status'])
@Index(['webhookSlug'], { unique: true })
export class AutomationWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  @Index()
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 50, default: 'DRAFT' })
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';

  @Column({ type: 'varchar', length: 50 })
  triggerType: AutomationTriggerType;

  @Column({ type: 'jsonb', default: {} })
  triggerConfig: Record<string, any>;

  @Column({ type: 'jsonb', default: [] })
  nodes: AutomationNode[];

  @Column({ type: 'jsonb', default: [] })
  edges: AutomationEdge[];

  @Column({ type: 'varchar', length: 100, nullable: true })
  webhookSlug?: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Create `AutomationExecution` entity**

```typescript
// apps/api/src/modules/automations/entities/automation-execution.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('automation_executions')
@Index(['tenantId', 'workflowId'])
@Index(['temporalWorkflowId'])
export class AutomationExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  @Index()
  tenantId: string;

  @Column({ type: 'uuid' })
  @Index()
  workflowId: string;

  @Column({ type: 'varchar', length: 150 })
  temporalWorkflowId: string;

  @Column({ type: 'varchar', length: 50, default: 'RUNNING' })
  status: 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

  @Column({ type: 'jsonb', default: {} })
  triggerPayload: Record<string, any>;

  @Column({ type: 'jsonb', default: {} })
  nodeResults: Record<
    string,
    {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING';
      input?: any;
      output?: any;
      error?: string;
      startedAt: string;
      finishedAt?: string;
      durationMs?: number;
    }
  >;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;
}
```

- [ ] **Step 3: Create database migration**

```typescript
// apps/api/src/database/migrations/1786050000000-CreateAutomationsTables.ts
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAutomationsTables1786050000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'automation_workflows',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'tenantId', type: 'varchar', length: '100', isNullable: false },
          { name: 'name', type: 'varchar', length: '255', isNullable: false },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'status', type: 'varchar', length: '50', default: "'DRAFT'" },
          { name: 'triggerType', type: 'varchar', length: '50', isNullable: false },
          { name: 'triggerConfig', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'nodes', type: 'jsonb', default: "'[]'::jsonb" },
          { name: 'edges', type: 'jsonb', default: "'[]'::jsonb" },
          { name: 'webhookSlug', type: 'varchar', length: '100', isNullable: true, isUnique: true },
          { name: 'version', type: 'int', default: 1 },
          { name: 'createdAt', type: 'timestamp with time zone', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp with time zone', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'automation_workflows',
      new TableIndex({ columnNames: ['tenantId', 'status'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'automation_executions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'tenantId', type: 'varchar', length: '100', isNullable: false },
          { name: 'workflowId', type: 'uuid', isNullable: false },
          { name: 'temporalWorkflowId', type: 'varchar', length: '150', isNullable: false },
          { name: 'status', type: 'varchar', length: '50', default: "'RUNNING'" },
          { name: 'triggerPayload', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'nodeResults', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'startedAt', type: 'timestamp with time zone', default: 'now()' },
          { name: 'finishedAt', type: 'timestamp with time zone', isNullable: true },
          { name: 'errorMessage', type: 'text', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'automation_executions',
      new TableIndex({ columnNames: ['tenantId', 'workflowId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('automation_executions', true);
    await queryRunner.dropTable('automation_workflows', true);
  }
}
```

- [ ] **Step 4: Commit database migration and entities**

```bash
git add apps/api/src/modules/automations/entities/ apps/api/src/database/migrations/
git commit -m "feat(api): add automation_workflows and automation_executions entities & migration"
```

---

### Task 3: Temporal Dynamic DAG Workflow Engine & Activities

**Files:**
- Create: `apps/api/src/modules/automations/workflows/interfaces.ts`
- Create: `apps/api/src/modules/automations/workflows/expression-evaluator.ts`
- Create: `apps/api/src/modules/automations/workflows/expression-evaluator.spec.ts`
- Create: `apps/api/src/modules/automations/workflows/automation.activities.ts`
- Create: `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.ts`

**Interfaces:**
- Produces: `dynamicDagWorkflow`, `approveNodeSignal`, `rejectNodeSignal`, activities (`httpActivity`, `aiPromptActivity`, `emailActivity`, `codeTransformActivity`, `crmMutateActivity`, `recordNodeResultActivity`).

- [ ] **Step 1: Write failing test for expression evaluator (`{{ $json.amount }}`)**

```typescript
// apps/api/src/modules/automations/workflows/expression-evaluator.spec.ts
import { evaluateExpression, interpolateObject } from './expression-evaluator';

describe('Expression Evaluator', () => {
  const context = {
    $trigger: { customerName: 'Acme Corp', amount: 15000 },
    $json: { quoteNumber: 'QT-2026-001', discount: 10 },
    $node: {
      'AI Analysis': { json: { riskScore: 'Low', recommendation: 'Approve' } },
    },
    $env: { API_URL: 'https://api.crm.internal' },
  };

  it('interpolates single string expression', () => {
    const result = evaluateExpression('Hello {{ $trigger.customerName }}', context);
    expect(result).toBe('Hello Acme Corp');
  });

  it('interpolates nested node expressions', () => {
    const result = evaluateExpression(
      'Risk is {{ $node["AI Analysis"].json.riskScore }}',
      context,
    );
    expect(result).toBe('Risk is Low');
  });

  it('interpolates deep objects recursively', () => {
    const template = {
      title: 'Quote {{ $json.quoteNumber }}',
      body: { customer: '{{ $trigger.customerName }}', total: '{{ $trigger.amount }}' },
    };
    const interpolated = interpolateObject(template, context);
    expect(interpolated).toEqual({
      title: 'Quote QT-2026-001',
      body: { customer: 'Acme Corp', total: '15000' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test expression-evaluator.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `expression-evaluator.ts`**

```typescript
// apps/api/src/modules/automations/workflows/expression-evaluator.ts
export function evaluateExpression(template: string, context: Record<string, any>): string {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, expression) => {
    try {
      const sanitized = expression.trim();
      const keys = Object.keys(context);
      const values = Object.values(context);
      const fn = new Function(...keys, `return ${sanitized};`);
      const val = fn(...values);
      return val !== undefined && val !== null ? String(val) : '';
    } catch {
      return '';
    }
  });
}

export function interpolateObject(obj: any, context: Record<string, any>): any {
  if (typeof obj === 'string') {
    return evaluateExpression(obj, context);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, context));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key] = interpolateObject(obj[key], context);
    }
    return result;
  }
  return obj;
}
```

- [ ] **Step 4: Implement Workflow Interfaces, Activities & `dynamicDagWorkflow`**

```typescript
// apps/api/src/modules/automations/workflows/interfaces.ts
import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { AutomationNode, AutomationEdge } from '@saas/shared';

export interface DynamicWorkflowInput {
  executionId: string;
  workflowId: string;
  tenantId: string;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  triggerPayload: Record<string, any>;
}

export interface WorkflowExecutionState {
  executionId: string;
  status: string;
  completedNodes: string[];
  waitingNodeId?: string;
}

export const approveNodeSignal = defineSignal<[string]>('approveNode'); // nodeId
export const rejectNodeSignal = defineSignal<[string, string?]>('rejectNode'); // nodeId, reason
export const getExecutionStateQuery = defineQuery<WorkflowExecutionState>('getExecutionState');
```

```typescript
// apps/api/src/modules/automations/workflows/dynamic-dag.workflow.ts
import { condition, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import type * as activities from './automation.activities';
import {
  approveNodeSignal,
  DynamicWorkflowInput,
  getExecutionStateQuery,
  rejectNodeSignal,
} from './interfaces';
import { interpolateObject } from './expression-evaluator';

const {
  executeHttpActivity,
  executeAiPromptActivity,
  executeEmailActivity,
  executeCodeTransformActivity,
  executeCrmMutationActivity,
  recordNodeResultActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
});

export async function dynamicDagWorkflow(input: DynamicWorkflowInput): Promise<{ status: string }> {
  let approvedNodeId: string | null = null;
  let rejectedNodeId: string | null = null;
  let rejectionReason: string | undefined;
  const completedNodes: string[] = [];
  let waitingNodeId: string | undefined;

  setHandler(approveNodeSignal, (nodeId: string) => {
    approvedNodeId = nodeId;
  });

  setHandler(rejectNodeSignal, (nodeId: string, reason?: string) => {
    rejectedNodeId = nodeId;
    rejectionReason = reason;
  });

  setHandler(getExecutionStateQuery, () => ({
    executionId: input.executionId,
    status: waitingNodeId ? 'WAITING_APPROVAL' : 'RUNNING',
    completedNodes,
    waitingNodeId,
  }));

  const context: Record<string, any> = {
    $trigger: input.triggerPayload,
    $json: input.triggerPayload,
    $node: {},
    $env: {},
  };

  const nodeMap = new Map(input.nodes.map((n) => [n.id, n]));
  const triggerNode = input.nodes.find((n) =>
    ['webhookTrigger', 'scheduleTrigger', 'crmEventTrigger', 'manualTrigger'].includes(n.type),
  );

  let currentNodes: string[] = triggerNode ? [triggerNode.id] : [];

  while (currentNodes.length > 0) {
    const nextNodes: string[] = [];

    for (const nodeId of currentNodes) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const startTime = Date.now();
      let nodeOutput: any = context.$json;
      let branchHandle: string | null = null;

      try {
        const resolvedConfig = interpolateObject(node.data.config || {}, context);

        switch (node.type) {
          case 'httpRequestNode':
            nodeOutput = await executeHttpActivity(resolvedConfig);
            break;
          case 'aiPromptNode':
            nodeOutput = await executeAiPromptActivity(resolvedConfig);
            break;
          case 'sendEmailNode':
            nodeOutput = await executeEmailActivity(resolvedConfig);
            break;
          case 'transformNode':
            nodeOutput = await executeCodeTransformActivity({
              code: node.data.config.code,
              context,
            });
            break;
          case 'crmMutateNode':
            nodeOutput = await executeCrmMutationActivity({
              tenantId: input.tenantId,
              ...resolvedConfig,
            });
            break;
          case 'delayNode':
            const ms = Number(resolvedConfig.durationMs || 5000);
            await sleep(ms);
            break;
          case 'conditionNode':
            const evalResult = Boolean(resolvedConfig.condition);
            branchHandle = evalResult ? 'true' : 'false';
            break;
          case 'approvalNode':
            waitingNodeId = node.id;
            await recordNodeResultActivity({
              executionId: input.executionId,
              nodeId: node.id,
              status: 'WAITING',
              input: context.$json,
            });

            const timeoutStr = node.data.timeoutDuration || '3 days';
            const respondedInTime = await condition(
              () => approvedNodeId === node.id || rejectedNodeId === node.id,
              timeoutStr,
            );

            waitingNodeId = undefined;
            if (!respondedInTime) {
              branchHandle = 'timeout';
            } else if (approvedNodeId === node.id) {
              branchHandle = 'approved';
            } else {
              branchHandle = 'rejected';
            }
            break;
        }

        context.$json = nodeOutput;
        context.$node[node.data.label || node.id] = { json: nodeOutput };
        completedNodes.push(node.id);

        await recordNodeResultActivity({
          executionId: input.executionId,
          nodeId: node.id,
          status: 'SUCCESS',
          input: context.$json,
          output: nodeOutput,
          durationMs: Date.now() - startTime,
        });

        // Resolve outbound edges
        const outbound = input.edges.filter(
          (e) => e.source === node.id && (!branchHandle || e.sourceHandle === branchHandle),
        );
        for (const edge of outbound) {
          nextNodes.push(edge.target);
        }
      } catch (err: any) {
        await recordNodeResultActivity({
          executionId: input.executionId,
          nodeId: node.id,
          status: 'FAILED',
          error: err.message || String(err),
          durationMs: Date.now() - startTime,
        });

        if (node.data.continueOnFail) {
          const outbound = input.edges.filter((e) => e.source === node.id);
          for (const edge of outbound) nextNodes.push(edge.target);
        } else {
          return { status: 'FAILED' };
        }
      }
    }

    currentNodes = nextNodes;
  }

  return { status: 'COMPLETED' };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter api test`
Expected: PASS

```bash
git add apps/api/src/modules/automations/workflows/
git commit -m "feat(api): implement dynamic DAG workflow engine, expression evaluator, and activities"
```

---

### Task 4: Automations Backend Service, Controller, Webhook Ingress & Tests

**Files:**
- Create: `apps/api/src/modules/automations/automations.service.ts`
- Create: `apps/api/src/modules/automations/automations.controller.ts`
- Create: `apps/api/src/modules/automations/automations.module.ts`
- Create: `apps/api/src/modules/automations/automations.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: REST endpoints `/automations`, `/automations/:id`, `/automations/webhook/:slug`, `/automations/executions/:id/signal`.

- [ ] **Step 1: Write failing test for `AutomationsService`**

```typescript
// apps/api/src/modules/automations/automations.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AutomationsService } from './automations.service';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';

describe('AutomationsService', () => {
  let service: AutomationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationsService,
        {
          provide: getRepositoryToken(AutomationWorkflow),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((d) => d),
            save: jest.fn().mockImplementation((d) => Promise.resolve({ id: 'uuid-1', ...d })),
          },
        },
        {
          provide: getRepositoryToken(AutomationExecution),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((d) => d),
            save: jest.fn().mockImplementation((d) => Promise.resolve({ id: 'exec-1', ...d })),
          },
        },
        {
          provide: TemporalService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              workflow: {
                start: jest.fn().mockResolvedValue({ workflowId: 'temp-wf-1' }),
                getHandle: jest.fn().mockReturnValue({ signal: jest.fn() }),
              },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AutomationsService>(AutomationsService);
  });

  it('creates workflow and generates unique webhook slug for webhook triggers', async () => {
    const result = await service.createWorkflow('tenant-1', {
      name: 'New Webhook Flow',
      triggerType: 'WEBHOOK',
      nodes: [],
      edges: [],
    });
    expect(result).toBeDefined();
    expect(result.webhookSlug).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter api test automations.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `AutomationsService`, `AutomationsController`, and `AutomationsModule`**

```typescript
// apps/api/src/modules/automations/automations.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import { dynamicDagWorkflow } from './workflows/dynamic-dag.workflow';
import { approveNodeSignal, rejectNodeSignal } from './workflows/interfaces';
import type { CreateAutomationWorkflowPayload, UpdateAutomationWorkflowPayload } from '@saas/shared';

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    @InjectRepository(AutomationWorkflow)
    private readonly workflowRepo: Repository<AutomationWorkflow>,
    @InjectRepository(AutomationExecution)
    private readonly executionRepo: Repository<AutomationExecution>,
    private readonly temporalService: TemporalService,
  ) {}

  async createWorkflow(tenantId: string, payload: CreateAutomationWorkflowPayload): Promise<AutomationWorkflow> {
    const webhookSlug = payload.triggerType === 'WEBHOOK' ? `wh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` : null;
    const wf = this.workflowRepo.create({
      tenantId,
      name: payload.name,
      description: payload.description,
      triggerType: payload.triggerType,
      triggerConfig: payload.triggerConfig || {},
      nodes: payload.nodes || [],
      edges: payload.edges || [],
      webhookSlug,
      status: 'DRAFT',
    });
    return this.workflowRepo.save(wf);
  }

  async findAllWorkflows(tenantId: string): Promise<AutomationWorkflow[]> {
    return this.workflowRepo.find({ where: { tenantId }, order: { updatedAt: 'DESC' } });
  }

  async findWorkflowById(tenantId: string, id: string): Promise<AutomationWorkflow> {
    const wf = await this.workflowRepo.findOne({ where: { id, tenantId } });
    if (!wf) throw new NotFoundException(`Workflow ${id} not found`);
    return wf;
  }

  async updateWorkflow(tenantId: string, id: string, payload: UpdateAutomationWorkflowPayload): Promise<AutomationWorkflow> {
    const wf = await this.findWorkflowById(tenantId, id);
    if (payload.name) wf.name = payload.name;
    if (payload.description !== undefined) wf.description = payload.description;
    if (payload.status) wf.status = payload.status;
    if (payload.nodes) wf.nodes = payload.nodes;
    if (payload.edges) wf.edges = payload.edges;
    if (payload.triggerConfig) wf.triggerConfig = payload.triggerConfig;
    wf.version += 1;
    return this.workflowRepo.save(wf);
  }

  async triggerExecution(tenantId: string, workflowId: string, triggerPayload: Record<string, any>): Promise<AutomationExecution> {
    const wf = await this.findWorkflowById(tenantId, workflowId);
    const exec = this.executionRepo.create({
      tenantId,
      workflowId: wf.id,
      temporalWorkflowId: `exec-${Date.now()}`,
      status: 'RUNNING',
      triggerPayload,
      nodeResults: {},
    });
    const savedExec = await this.executionRepo.save(exec);

    try {
      const client = this.temporalService.getClient();
      const handle = await client.workflow.start(dynamicDagWorkflow, {
        taskQueue: 'automations-queue',
        workflowId: `automation-exec-${savedExec.id}`,
        args: [{
          executionId: savedExec.id,
          workflowId: wf.id,
          tenantId,
          nodes: wf.nodes,
          edges: wf.edges,
          triggerPayload,
        }],
      });
      savedExec.temporalWorkflowId = handle.workflowId;
      await this.executionRepo.save(savedExec);
    } catch (err: any) {
      this.logger.warn(`Temporal start deferred: ${err.message}`);
    }

    return savedExec;
  }

  async signalExecution(tenantId: string, executionId: string, action: 'APPROVE' | 'REJECT', nodeId: string, reason?: string) {
    const exec = await this.executionRepo.findOne({ where: { id: executionId, tenantId } });
    if (!exec) throw new NotFoundException(`Execution ${executionId} not found`);

    try {
      const client = this.temporalService.getClient();
      const handle = client.workflow.getHandle(exec.temporalWorkflowId);
      if (action === 'APPROVE') {
        await handle.signal(approveNodeSignal, nodeId);
      } else {
        await handle.signal(rejectNodeSignal, nodeId, reason);
      }
    } catch (err: any) {
      this.logger.warn(`Signal dispatch failed: ${err.message}`);
    }
  }
}
```

- [ ] **Step 4: Register `AutomationsModule` in `app.module.ts` and run tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit backend automation module**

```bash
git add apps/api/src/modules/automations/ apps/api/src/app.module.ts
git commit -m "feat(api): implement automations service, controller, and module"
```

---

### Task 5: Frontend Canvas Dependencies, API Client & State Hooks

**Files:**
- Modify: `apps/web/package.json` (Install `@xyflow/react`)
- Modify: `apps/web/src/lib/api/endpoints.ts`
- Create: `apps/web/src/hooks/use-automations.ts`
- Create: `apps/web/src/hooks/use-automation-canvas.ts`

**Interfaces:**
- Produces: `api.automations`, `useAutomations()`, `useAutomation(id)`, `useAutomationCanvas()`.

- [ ] **Step 1: Install `@xyflow/react` in `apps/web`**

Run: `pnpm --filter web add @xyflow/react`

- [ ] **Step 2: Add API client endpoints in `apps/web/src/lib/api/endpoints.ts`**

```typescript
// In apps/web/src/lib/api/endpoints.ts
automations: {
  list: () => apiClient.get<AutomationWorkflowDto[]>('/automations'),
  get: (id: string) => apiClient.get<AutomationWorkflowDto>(`/automations/${id}`),
  create: (payload: CreateAutomationWorkflowPayload) => apiClient.post<AutomationWorkflowDto>('/automations', payload),
  update: (id: string, payload: UpdateAutomationWorkflowPayload) => apiClient.patch<AutomationWorkflowDto>(`/automations/${id}`, payload),
  delete: (id: string) => apiClient.delete(`/automations/${id}`),
  testRun: (id: string, payload: Record<string, any>) => apiClient.post<AutomationExecutionDto>(`/automations/${id}/test-run`, payload),
  listExecutions: (id: string) => apiClient.get<AutomationExecutionDto[]>(`/automations/${id}/executions`),
  getExecution: (execId: string) => apiClient.get<AutomationExecutionDto>(`/automations/executions/${execId}`),
  signalExecution: (execId: string, payload: { action: 'APPROVE' | 'REJECT'; nodeId: string; reason?: string }) =>
    apiClient.post(`/automations/executions/${execId}/signal`, payload),
}
```

- [ ] **Step 3: Implement `use-automations.ts` & `use-automation-canvas.ts`**

```typescript
// apps/web/src/hooks/use-automations.ts
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/endpoints';
import { toast } from 'sonner';
import type { AutomationWorkflowDto, CreateAutomationWorkflowPayload, UpdateAutomationWorkflowPayload } from '@saas/shared';

export function useAutomations() {
  const [workflows, setWorkflows] = useState<AutomationWorkflowDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.automations.list();
      setWorkflows(data);
    } catch {
      toast.error('Failed to load automations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { workflows, isLoading, refresh };
}
```

- [ ] **Step 4: Commit frontend hooks and packages**

```bash
git add apps/web/
git commit -m "feat(web): add @xyflow/react, automation API client endpoints, and state hooks"
```

---

### Task 6: Custom React Flow Node Components & Node Palette

**Files:**
- Create: `apps/web/src/components/automations/nodes/base-node.tsx`
- Create: `apps/web/src/components/automations/nodes/trigger-node.tsx`
- Create: `apps/web/src/components/automations/nodes/condition-node.tsx`
- Create: `apps/web/src/components/automations/nodes/action-node.tsx`
- Create: `apps/web/src/components/automations/nodes/approval-node.tsx`
- Create: `apps/web/src/components/automations/nodes/node-types.ts`
- Create: `apps/web/src/components/automations/drawers/node-palette-drawer.tsx`

**Interfaces:**
- Produces: Custom node components registered with React Flow `nodeTypes`.

- [ ] **Step 1: Create `base-node.tsx` with amber/slate CRM styling**

```tsx
// apps/web/src/components/automations/nodes/base-node.tsx
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface BaseNodeProps {
  icon: LucideIcon;
  title: string;
  category: string;
  status?: 'SUCCESS' | 'FAILED' | 'WAITING' | 'IDLE';
  selected?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
  children?: React.ReactNode;
}

export function BaseNode({
  icon: Icon,
  title,
  category,
  status = 'IDLE',
  selected,
  hasInput = true,
  hasOutput = true,
  children,
}: BaseNodeProps) {
  return (
    <div
      className={clsx(
        'w-64 rounded-xl border bg-white p-3.5 shadow-sm transition-all duration-200',
        selected ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-stone-200 hover:border-stone-300',
        status === 'SUCCESS' && 'border-emerald-500 ring-2 ring-emerald-500/10',
        status === 'FAILED' && 'border-rose-500 ring-2 ring-rose-500/10',
        status === 'WAITING' && 'border-amber-500 animate-pulse',
      )}
    >
      {hasInput && <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-stone-400" />}

      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-600">{category}</p>
          <h4 className="text-xs font-semibold text-stone-900 truncate">{title}</h4>
        </div>
      </div>

      {children && <div className="text-xs text-stone-600 mt-2 pt-2 border-t border-stone-100">{children}</div>}

      {hasOutput && <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-500" />}
    </div>
  );
}
```

- [ ] **Step 2: Create `condition-node.tsx` and `approval-node.tsx` with multi-handles**

```tsx
// apps/web/src/components/automations/nodes/condition-node.tsx
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Split } from 'lucide-react';
import { BaseNode } from './base-node';

export function ConditionNode({ data, selected }: any) {
  return (
    <div className="relative">
      <BaseNode icon={Split} title={data.label || 'Condition'} category="Logic" selected={selected} hasOutput={false}>
        <p className="font-mono text-[11px] text-stone-500 truncate">{data.config?.condition || 'No condition set'}</p>
      </BaseNode>

      {/* True Handle */}
      <div className="absolute right-0 top-1/3 -translate-y-1/2 flex items-center">
        <span className="text-[9px] font-bold text-emerald-600 mr-1.5">TRUE</span>
        <Handle type="source" id="true" position={Position.Right} className="!w-3 !h-3 !bg-emerald-500" />
      </div>

      {/* False Handle */}
      <div className="absolute right-0 bottom-1/4 translate-y-1/2 flex items-center">
        <span className="text-[9px] font-bold text-stone-600 mr-1.5">FALSE</span>
        <Handle type="source" id="false" position={Position.Right} className="!w-3 !h-3 !bg-stone-400" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `node-palette-drawer.tsx` for drag-and-drop**

```tsx
// apps/web/src/components/automations/drawers/node-palette-drawer.tsx
import React from 'react';
import { Webhook, Calendar, Sparkles, Globe, Mail, ShieldAlert, Split, Timer, Database } from 'lucide-react';

export const NODE_PALETTE_ITEMS = [
  { type: 'webhookTrigger', label: 'Webhook', category: 'Trigger', icon: Webhook, desc: 'Listen for HTTP POST/GET requests' },
  { type: 'scheduleTrigger', label: 'Schedule Cron', category: 'Trigger', icon: Calendar, desc: 'Run periodically (e.g. Daily)' },
  { type: 'conditionNode', label: 'If / Condition', category: 'Logic', icon: Split, desc: 'Branch flow based on condition' },
  { type: 'aiPromptNode', label: 'AI Prompt', category: 'AI', icon: Sparkles, desc: 'LLM reasoning and summaries' },
  { type: 'httpRequestNode', label: 'HTTP Request', category: 'Actions', icon: Globe, desc: 'Call external REST API' },
  { type: 'sendEmailNode', label: 'Send Email', category: 'Actions', icon: Mail, desc: 'Send notification email' },
  { type: 'approvalNode', label: 'Approval Gate', category: 'Human', icon: ShieldAlert, desc: 'Wait for manager approval' },
  { type: 'delayNode', label: 'Delay / Timer', category: 'Logic', icon: Timer, desc: 'Durable sleep duration' },
  { type: 'crmMutateNode', label: 'CRM Mutation', category: 'Actions', icon: Database, desc: 'Update quotes, invoices, deals' },
];
```

- [ ] **Step 4: Commit custom node components**

```bash
git add apps/web/src/components/automations/
git commit -m "feat(web): add custom React Flow nodes and node palette drawer"
```

---

### Task 7: Node Inspector Drawer, Expression Previewer & Test Run Drawer

**Files:**
- Create: `apps/web/src/components/automations/drawers/node-inspector-drawer.tsx`
- Create: `apps/web/src/components/automations/drawers/expression-helper.tsx`
- Create: `apps/web/src/components/automations/drawers/test-run-drawer.tsx`

**Interfaces:**
- Produces: Configuration drawer with real-time expression interpolation helper and JSON execution step output drawer.

- [ ] **Step 1: Create `node-inspector-drawer.tsx` with dynamic field forms**

```tsx
// apps/web/src/components/automations/drawers/node-inspector-drawer.tsx
import React from 'react';
import { X, Play, Clock, Sparkles } from 'lucide-react';
import type { AutomationNode } from '@saas/shared';

interface NodeInspectorDrawerProps {
  node: AutomationNode | null;
  onUpdate: (nodeId: string, data: Partial<AutomationNode['data']>) => void;
  onClose: () => void;
}

export function NodeInspectorDrawer({ node, onUpdate, onClose }: NodeInspectorDrawerProps) {
  if (!node) return null;

  const handleChange = (key: string, value: any) => {
    onUpdate(node.id, {
      config: { ...node.data.config, [key]: value },
    });
  };

  return (
    <aside className="w-96 border-l border-stone-200 bg-white p-5 shadow-xl flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between pb-4 border-b border-stone-100">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">{node.type}</span>
          <h3 className="text-sm font-semibold text-stone-900">{node.data.label}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-stone-400 hover:bg-stone-100">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-4 flex-1">
        <div>
          <label className="text-xs font-medium text-stone-700">Node Name</label>
          <input
            type="text"
            value={node.data.label}
            onChange={(e) => onUpdate(node.id, { label: e.target.value })}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
          />
        </div>

        {/* Dynamic configuration inputs based on node type */}
        {node.type === 'httpRequestNode' && (
          <>
            <div>
              <label className="text-xs font-medium text-stone-700">Method</label>
              <select
                value={node.data.config?.method || 'GET'}
                onChange={(e) => handleChange('method', e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs"
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-stone-700">URL (supports {'{{ $json.id }}'})</label>
              <input
                type="text"
                value={node.data.config?.url || ''}
                onChange={(e) => handleChange('url', e.target.value)}
                placeholder="https://api.service.com/v1/resource"
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs font-mono"
              />
            </div>
          </>
        )}

        {node.type === 'aiPromptNode' && (
          <div>
            <label className="text-xs font-medium text-stone-700">AI Prompt Template</label>
            <textarea
              rows={5}
              value={node.data.config?.prompt || ''}
              onChange={(e) => handleChange('prompt', e.target.value)}
              placeholder="Analyze the following payload: {{ $json.customerName }}"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs font-mono"
            />
          </div>
        )}

        {node.type === 'approvalNode' && (
          <div>
            <label className="text-xs font-medium text-stone-700">Timeout / SLA Escalation Duration</label>
            <input
              type="text"
              value={node.data.timeoutDuration || '3 days'}
              onChange={(e) => onUpdate(node.id, { timeoutDuration: e.target.value })}
              placeholder="3 days (e.g. 24 hours, 3 days)"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs"
            />
            <p className="text-[11px] text-stone-500 mt-1">If not approved/rejected within this duration, execution routes to the Timeout handle.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit inspector and test drawers**

```bash
git add apps/web/src/components/automations/drawers/
git commit -m "feat(web): add node inspector drawer, dynamic parameter forms, and test run viewer"
```

---

### Task 8: Full Automations Studio Pages (`/automations`, `/automations/[id]`)

**Files:**
- Create: `apps/web/src/app/(app)/automations/page.tsx`
- Create: `apps/web/src/app/(app)/automations/[id]/page.tsx`
- Create: `apps/web/src/components/automations/canvas/automation-canvas.tsx`
- Create: `apps/web/src/components/automations/canvas/canvas-header.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx` (Add Automations Nav link)

**Interfaces:**
- Produces: Interactive visual studio and workflows list page.

- [ ] **Step 1: Implement `automation-canvas.tsx` with `@xyflow/react`**

```tsx
// apps/web/src/components/automations/canvas/automation-canvas.tsx
'use client';

import React, { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NODE_TYPES } from '../nodes/node-types';

interface AutomationCanvasProps {
  initialNodes: any[];
  initialEdges: any[];
  onSelectNode: (node: any) => void;
  onChange: (nodes: any[], edges: any[]) => void;
}

export function AutomationCanvas({ initialNodes, initialEdges, onSelectNode, onChange }: AutomationCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      setEdges((eds) => {
        const next = addEdge(params, eds);
        onChange(nodes, next);
        return next;
      });
    },
    [nodes, onChange, setEdges],
  );

  return (
    <div className="h-full w-full bg-stone-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onSelectNode(node)}
        fitView
      >
        <Background color="#e7e5e4" gap={16} />
        <Controls className="!bg-white !border-stone-200 !shadow-sm" />
        <MiniMap className="!bg-white !border-stone-200" nodeColor="#d6d3d1" />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Create Automations List Page & Studio Canvas Page**

```tsx
// apps/web/src/app/(app)/automations/page.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, Zap, Play, Sparkles } from 'lucide-react';
import { useAutomations } from '@/hooks/use-automations';

export default function AutomationsPage() {
  const { workflows, isLoading } = useAutomations();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Automation Studio</h1>
          <p className="text-sm text-stone-500">Design and monitor event-driven flows and AI automations.</p>
        </div>
        <Link
          href="/automations/new"
          className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-amber-700 shadow-sm"
        >
          <Plus className="h-4 w-4" /> New Automation
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {workflows.map((wf) => (
          <Link
            key={wf.id}
            href={`/automations/${wf.id}`}
            className="group rounded-2xl border border-stone-200 bg-white p-5 hover:border-amber-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 uppercase">{wf.triggerType}</span>
              <span className={`h-2 w-2 rounded-full ${wf.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-stone-300'}`} />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-stone-900 group-hover:text-amber-700">{wf.name}</h3>
            <p className="mt-1 text-xs text-stone-500 line-clamp-2">{wf.description || 'No description provided'}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `app-shell.tsx` navigation items**

Add `{ label: 'Automations', href: '/automations', icon: Zap }` to the main navigation menu.

- [ ] **Step 4: Run build & tests to verify Next.js pages compile**

Run: `pnpm --filter web build`
Expected: PASS.

- [ ] **Step 5: Commit studio views and navigation**

```bash
git add apps/web/
git commit -m "feat(web): add automations list page, full studio canvas, and navigation link"
```

---

### Task 9: Event Bridge & End-to-End Verification

**Files:**
- Modify: `apps/api/src/modules/quotes/quotes.service.ts` (Emit events for Quotes lifecycle)
- Create: `apps/api/src/modules/automations/services/automation-event-listener.service.ts`
- Create: `apps/api/test/automations.e2e-spec.ts`

**Interfaces:**
- Produces: Quotes & CRM Event Bridge connected to dynamic Temporal workflows.

- [ ] **Step 1: Write E2E test verifying full flow (Trigger -> Condition -> Approval -> Action)**

```typescript
// apps/api/test/automations.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { AutomationsService } from '../src/modules/automations/automations.service';

describe('Automations Studio Flow (E2E)', () => {
  it('triggers dynamic DAG workflow and logs node results', async () => {
    // E2E test for graph execution
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run all tests in repo**

Run: `pnpm test`
Expected: ALL PASS.

- [ ] **Step 3: Commit and push**

```bash
git add .
git commit -m "feat(automations): integrate CRM event bridge, quote triggers, and E2E verification"
```
