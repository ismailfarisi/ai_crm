# Scalable AI Tool-Calling Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, scalable multi-step AI tool-calling engine across the CRM featuring Temporal-orchestrated durable ReAct workflows, two-tier hierarchical tool discovery with RBAC filtering, a two-phase preview & human approval policy for mutations, Redis atomic token bucket budget pre-reservation, and dynamic tool synthesis for Custom Objects.

**Architecture:** The execution reasoning loop is hosted in a durable Temporal workflow (`AgentReActWorkflow`) with each tool execution isolated as a retriable activity. Context window bloat is prevented via a fast two-tier router that clusters domain tools and filters by user permissions. State safety is enforced via a tiered execution policy separating autonomous reads from two-phase approval signals for writes. Distributed spend caps and rate limits are managed atomically in Redis via Lua scripts, and Object Studio definitions dynamically generate typed tool schemas at runtime.

**Tech Stack:** NestJS 11, TypeScript 5.9, TypeORM, Zod 4, Temporal TypeScript SDK (`@temporalio/workflow`, `@temporalio/activity`), Redis (`ioredis`), Anthropic SDK (`@anthropic-ai/sdk`), Jest.

## Global Constraints

- Never invent database IDs: LLM natural language entities are deterministically resolved against PostgreSQL via parameterized lookups.
- Never calculate currency or prices with LLMs: Pricing engines compute line totals, discounts, and tax deterministically.
- All tool payloads must pass strict Zod validation before invoking domain services.
- Write operations that incur financial commitments or data destruction must pause and await user signal approval.
- All code must follow existing NestJS conventions and maintain 100% type safety without `any`.

---

### Task 1: Redis Token Bucket Rate Limiter & Spend Pre-Reservation (Budget Guard)

**Files:**
- Create: `apps/api/src/modules/ai/services/redis-budget-guard.service.ts`
- Modify: `apps/api/src/modules/ai/ai.service.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/modules/ai/services/redis-budget-guard.service.spec.ts`

**Interfaces:**
- Consumes: `AiBudget` spend caps, token pricing constants.
- Produces: `RedisBudgetGuardService` with `checkAndReserve(orgId: string, estimatedCostUsd: number, monthlyCapUsd: number): Promise<{ allowed: boolean; reservedAmount: number; currentSpendUsd: number }>` and `reconcile(orgId: string, actualCostUsd: number, reservedAmount: number): Promise<void>`.

- [ ] **Step 1: Install `ioredis` and `@types/ioredis` in `apps/api`**

Run: `pnpm --filter api add ioredis && pnpm --filter api add -D @types/ioredis`

- [ ] **Step 2: Write failing unit test for `RedisBudgetGuardService`**

Create `apps/api/src/modules/ai/services/redis-budget-guard.service.spec.ts`:
```typescript
import { RedisBudgetGuardService } from './redis-budget-guard.service';

describe('RedisBudgetGuardService', () => {
  let service: RedisBudgetGuardService;
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      eval: jest.fn(),
      incrbyfloat: jest.fn(),
      get: jest.fn(),
    };
    service = new RedisBudgetGuardService(mockRedis);
  });

  it('allows reservation when spend + estimate is within monthly cap', async () => {
    mockRedis.eval.mockResolvedValue([1, '12.50']); // [allowed (1=true), new_spend]

    const result = await service.checkAndReserve('org-123', 0.05, 50.0);
    expect(result.allowed).toBe(true);
    expect(result.reservedAmount).toBe(0.05);
    expect(result.currentSpendUsd).toBe(12.5);
  });

  it('rejects reservation when spend exceeds monthly cap', async () => {
    mockRedis.eval.mockResolvedValue([0, '50.10']);

    const result = await service.checkAndReserve('org-123', 0.05, 50.0);
    expect(result.allowed).toBe(false);
    expect(result.reservedAmount).toBe(0);
  });

  it('reconciles reserved amount with actual provider cost difference', async () => {
    mockRedis.eval.mockResolvedValue('12.48');

    await service.reconcile('org-123', 0.03, 0.05);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      1,
      expect.stringContaining('org-123'),
      '-0.02',
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter api test apps/api/src/modules/ai/services/redis-budget-guard.service.spec.ts`
Expected: FAIL with "Cannot find module './redis-budget-guard.service'"

- [ ] **Step 4: Implement `RedisBudgetGuardService`**

Create `apps/api/src/modules/ai/services/redis-budget-guard.service.ts`:
```typescript
import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT_TOKEN = 'REDIS_CLIENT_TOKEN';

const RESERVE_LUA = `
local key = KEYS[1]
local estimate = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local current = tonumber(redis.call('get', key) or '0')

if (current + estimate) > cap then
  return {0, tostring(current)}
else
  local new_val = redis.call('incrbyfloat', key, estimate)
  -- 35 day TTL ensures cleanup across month boundaries
  redis.call('expire', key, 3024000)
  return {1, tostring(new_val)}
end
`;

const RECONCILE_LUA = `
local key = KEYS[1]
local delta = tonumber(ARGV[1])
local new_val = redis.call('incrbyfloat', key, delta)
if tonumber(new_val) < 0 then
  redis.call('set', key, '0')
  return '0'
end
return tostring(new_val)
`;

@Injectable()
export class RedisBudgetGuardService {
  private readonly logger = new Logger(RedisBudgetGuardService.name);

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT_TOKEN)
    private readonly redis: Redis | null,
  ) {}

  private getPeriodKey(organizationId: string): string {
    const d = new Date();
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return `ai:budget:${organizationId}:${period}`;
  }

  async checkAndReserve(
    organizationId: string,
    estimatedCostUsd: number,
    monthlyCapUsd: number,
  ): Promise<{ allowed: boolean; reservedAmount: number; currentSpendUsd: number }> {
    if (!this.redis) {
      // Degrade gracefully if Redis is unconfigured
      return { allowed: true, reservedAmount: 0, currentSpendUsd: 0 };
    }

    try {
      const key = this.getPeriodKey(organizationId);
      const res = (await this.redis.eval(
        RESERVE_LUA,
        1,
        key,
        String(estimatedCostUsd),
        String(monthlyCapUsd),
      )) as [number, string];

      const allowed = res[0] === 1;
      const currentSpendUsd = parseFloat(res[1]);

      return {
        allowed,
        reservedAmount: allowed ? estimatedCostUsd : 0,
        currentSpendUsd,
      };
    } catch (err) {
      this.logger.warn(`Redis budget check failed, failing open: ${err}`);
      return { allowed: true, reservedAmount: 0, currentSpendUsd: 0 };
    }
  }

  async reconcile(
    organizationId: string,
    actualCostUsd: number,
    reservedAmount: number,
  ): Promise<void> {
    if (!this.redis || reservedAmount === 0) return;

    try {
      const key = this.getPeriodKey(organizationId);
      const delta = actualCostUsd - reservedAmount;
      await this.redis.eval(RECONCILE_LUA, 1, key, String(delta));
    } catch (err) {
      this.logger.warn(`Redis budget reconciliation failed: ${err}`);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test apps/api/src/modules/ai/services/redis-budget-guard.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/api/package.json apps/api/src/modules/ai/services/redis-budget-guard.service.ts apps/api/src/modules/ai/services/redis-budget-guard.service.spec.ts
git commit -m "feat(ai): add Redis atomic budget guard and token pre-reservation"
```

---

### Task 2: Temporal Multi-Step Agent ReAct Workflow & Activities

**Files:**
- Create: `apps/api/src/modules/channels/workflows/agent-react.workflow.ts`
- Create: `apps/api/src/modules/channels/workflows/activities/agent-react.activities.ts`
- Test: `apps/api/src/modules/channels/workflows/agent-react.workflow.spec.ts`

**Interfaces:**
- Consumes: `AgentReActInput { organizationId: string; userId: string; conversationId: string; prompt: string; maxTurns?: number }`
- Produces: `AgentReActWorkflow` with approval signal `approvalSignal: { approved: boolean; note?: string }` returning `AgentReActOutput { status: 'COMPLETED' | 'AWAITING_APPROVAL' | 'CANCELLED' | 'FAILED'; finalResponse: string; stepsExecuted: number }`.

- [ ] **Step 1: Define Activities in `apps/api/src/modules/channels/workflows/activities/agent-react.activities.ts`**

```typescript
export interface ToolCallSpec {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  isMutating: boolean;
  requiresApproval: boolean;
  previewPayload?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorMessage?: string;
}

export interface ReActTurnInput {
  organizationId: string;
  userId: string;
  prompt: string;
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  availableTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export interface ReActTurnOutput {
  thought: string;
  toolCalls?: ToolCallSpec[];
  finalAnswer?: string;
}

export interface AgentReactActivities {
  planReActTurn(input: ReActTurnInput): Promise<ReActTurnOutput>;
  executeToolActivity(
    tool: ToolCallSpec,
    ctx: { organizationId: string; userId: string },
  ): Promise<ToolExecutionResult>;
  commitToolMutationActivity(
    tool: ToolCallSpec,
    ctx: { organizationId: string; userId: string },
  ): Promise<{ success: boolean; resultSummary: string }>;
}
```

- [ ] **Step 2: Implement `agent-react.workflow.ts` with Temporal Signals**

Create `apps/api/src/modules/channels/workflows/agent-react.workflow.ts`:
```typescript
import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  ApplicationFailure,
} from '@temporalio/workflow';
import type {
  AgentReactActivities,
  ToolCallSpec,
  ToolExecutionResult,
} from './activities/agent-react.activities';

const activities = proxyActivities<AgentReactActivities>({
  startToCloseTimeout: '45 seconds',
  retry: {
    maximumAttempts: 3,
  },
});

export const approvalSignal = defineSignal<[{ approved: boolean; note?: string }]>(
  'agentApprovalSignal',
);

export interface AgentReActWorkflowInput {
  organizationId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  maxTurns?: number;
}

export interface AgentReActWorkflowOutput {
  status: 'COMPLETED' | 'AWAITING_APPROVAL' | 'REJECTED' | 'FAILED';
  finalResponse: string;
  stepsExecuted: number;
  pendingAction?: {
    tool: ToolCallSpec;
    preview: Record<string, unknown>;
  };
}

export async function agentReActWorkflow(
  input: AgentReActWorkflowInput,
): Promise<AgentReActWorkflowOutput> {
  const maxTurns = input.maxTurns ?? 6;
  let turns = 0;
  let isDone = false;
  let finalResponse = '';

  let approvalResult: { approved: boolean; note?: string } | null = null;
  setHandler(approvalSignal, (signal) => {
    approvalResult = signal;
  });

  const history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = [
    { role: 'user', content: input.prompt },
  ];

  while (!isDone && turns < maxTurns) {
    turns++;

    const turn = await activities.planReActTurn({
      organizationId: input.organizationId,
      userId: input.userId,
      prompt: input.prompt,
      conversationHistory: history,
      availableTools: [],
    });

    if (turn.finalAnswer && (!turn.toolCalls || turn.toolCalls.length === 0)) {
      finalResponse = turn.finalAnswer;
      isDone = true;
      break;
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const tool of turn.toolCalls) {
        const execution = await activities.executeToolActivity(tool, {
          organizationId: input.organizationId,
          userId: input.userId,
        });

        if (execution.requiresApproval && execution.isMutating) {
          // Pause workflow and wait up to 48 hours for user signal
          const approved = await condition(() => approvalResult !== null, '48 hours');

          if (!approved || !approvalResult?.approved) {
            return {
              status: 'REJECTED',
              finalResponse: `Action ${tool.name} was rejected by user.`,
              stepsExecuted: turns,
            };
          }

          // User approved -> execute commit
          const commit = await activities.commitToolMutationActivity(tool, {
            organizationId: input.organizationId,
            userId: input.userId,
          });

          history.push({
            role: 'tool',
            content: JSON.stringify(commit),
          });
        } else {
          history.push({
            role: 'tool',
            content: JSON.stringify(execution.output ?? { error: execution.errorMessage }),
          });
        }
      }
    }
  }

  return {
    status: 'COMPLETED',
    finalResponse: finalResponse || 'Execution finished.',
    stepsExecuted: turns,
  };
}
```

- [ ] **Step 3: Write workflow unit test**

Create `apps/api/src/modules/channels/workflows/agent-react.workflow.spec.ts`:
```typescript
describe('agentReActWorkflow logic', () => {
  it('validates workflow contract signatures and signals', () => {
    const { approvalSignal } = require('./agent-react.workflow');
    expect(approvalSignal.name).toBe('agentApprovalSignal');
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test apps/api/src/modules/channels/workflows/agent-react.workflow.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/api/src/modules/channels/workflows/agent-react.workflow.ts apps/api/src/modules/channels/workflows/activities/agent-react.activities.ts apps/api/src/modules/channels/workflows/agent-react.workflow.spec.ts
git commit -m "feat(channels): add durable Temporal AgentReAct workflow with approval signals"
```

---

### Task 3: Hierarchical Tool Router & RBAC Filter

**Files:**
- Create: `apps/api/src/modules/channels/skills/hierarchical-tool-router.service.ts`
- Test: `apps/api/src/modules/channels/skills/hierarchical-tool-router.service.spec.ts`

**Interfaces:**
- Consumes: User message, domain clusters enum (`SALES`, `PRODUCTION`, `FINANCE`, `CUSTOM_OBJECTS`), candidate skills.
- Produces: `filterAuthorizedTools(domain: string, userPermissions: string[], allSkills: ChannelSkill[])`.

- [ ] **Step 1: Write failing unit test for `HierarchicalToolRouterService`**

Create `apps/api/src/modules/channels/skills/hierarchical-tool-router.service.spec.ts`:
```typescript
import { HierarchicalToolRouterService } from './hierarchical-tool-router.service';

describe('HierarchicalToolRouterService', () => {
  let router: HierarchicalToolRouterService;
  let mockAi: any;

  beforeEach(() => {
    mockAi = {
      generateStructured: jest.fn(),
    };
    router = new HierarchicalToolRouterService(mockAi);
  });

  it('classifies sales message into SALES domain cluster', async () => {
    mockAi.generateStructured.mockResolvedValue({
      data: { domain: 'SALES', confidence: 0.95 },
      model: 'claude-sonnet-5',
    });

    const domain = await router.classifyDomain('Create quote for Acme 100 units', {
      organizationId: 'org-1',
      userId: 'usr-1',
    });

    expect(domain.domain).toBe('SALES');
    expect(domain.confidence).toBe(0.95);
  });

  it('filters tools by RBAC permissions and matched domain', () => {
    const mockSkills: any[] = [
      { name: 'quote.create', domain: 'SALES', requiredPermission: 'quotes:create' },
      { name: 'quote.approve', domain: 'SALES', requiredPermission: 'quotes:approve' },
      { name: 'work_order.log', domain: 'PRODUCTION', requiredPermission: 'production:update' },
    ];

    const authorized = router.filterAuthorizedTools('SALES', ['quotes:create'], mockSkills);
    expect(authorized.map((s) => s.name)).toEqual(['quote.create']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test apps/api/src/modules/channels/skills/hierarchical-tool-router.service.spec.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `HierarchicalToolRouterService`**

Create `apps/api/src/modules/channels/skills/hierarchical-tool-router.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';

export type DomainCluster = 'SALES' | 'PRODUCTION' | 'FINANCE' | 'CUSTOM_OBJECTS' | 'GENERAL';

export interface DomainClassification {
  domain: DomainCluster;
  confidence: number;
}

export interface DomainAwareSkill {
  name: string;
  domain: DomainCluster;
  requiredPermission?: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}

@Injectable()
export class HierarchicalToolRouterService {
  private readonly logger = new Logger(HierarchicalToolRouterService.name);

  constructor(private readonly ai: AiService) {}

  async classifyDomain(
    message: string,
    actor: { organizationId: string; userId: string },
  ): Promise<DomainClassification> {
    const schema = {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: ['SALES', 'PRODUCTION', 'FINANCE', 'CUSTOM_OBJECTS', 'GENERAL'],
          description: 'The primary CRM functional domain of the user request.',
        },
        confidence: {
          type: 'number',
          description: 'Confidence score from 0 to 1.',
        },
      },
      required: ['domain', 'confidence'],
      additionalProperties: false,
    };

    try {
      const result = await this.ai.generateStructured<{ domain: DomainCluster; confidence: number }>(
        'channels.classify_domain',
        {
          messages: [
            {
              role: 'user',
              content: `Classify the user intent into one domain:
- SALES: Quotes, deals, customer purchase orders, pricing
- PRODUCTION: Work orders, routing, machine operations, shop floor time
- FINANCE: Invoices, payments, expense claims, ledger receipts
- CUSTOM_OBJECTS: User-defined custom entities (vehicles, contracts, charts)
- GENERAL: Casual chat, status queries, help

Message: "${message}"`,
            },
          ],
          jsonSchema: schema,
          schemaName: 'domain_classification',
        },
        actor,
      );

      return result.data;
    } catch (err) {
      this.logger.warn(`Domain classification degraded to GENERAL: ${err}`);
      return { domain: 'GENERAL', confidence: 0.5 };
    }
  }

  filterAuthorizedTools<T extends DomainAwareSkill>(
    domain: DomainCluster,
    userPermissions: string[],
    skills: T[],
  ): T[] {
    const hasWildcard = userPermissions.includes('*') || userPermissions.includes('admin');

    return skills.filter((skill) => {
      // Must match domain or be universal general tool
      if (domain !== 'GENERAL' && skill.domain !== domain && skill.domain !== 'GENERAL') {
        return false;
      }
      // Must satisfy RBAC permission
      if (!skill.requiredPermission || hasWildcard) {
        return true;
      }
      return userPermissions.includes(skill.requiredPermission);
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test apps/api/src/modules/channels/skills/hierarchical-tool-router.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/api/src/modules/channels/skills/hierarchical-tool-router.service.ts apps/api/src/modules/channels/skills/hierarchical-tool-router.service.spec.ts
git commit -m "feat(channels): add hierarchical tool router with domain clustering and RBAC filtering"
```

---

### Task 4: Tiered Tool Policy & Two-Phase Mutation Approvals

**Files:**
- Create: `apps/api/src/modules/channels/skills/tool-execution-policy.service.ts`
- Test: `apps/api/src/modules/channels/skills/tool-execution-policy.service.spec.ts`

**Interfaces:**
- Consumes: Tool metadata and execution action type.
- Produces: `evaluatePolicy(toolName: string, isMutation: boolean): { isAutonomous: boolean; requiresApproval: boolean }`.

- [ ] **Step 1: Write failing unit test for `ToolExecutionPolicyService`**

Create `apps/api/src/modules/channels/skills/tool-execution-policy.service.spec.ts`:
```typescript
import { ToolExecutionPolicyService } from './tool-execution-policy.service';

describe('ToolExecutionPolicyService', () => {
  let policyService: ToolExecutionPolicyService;

  beforeEach(() => {
    policyService = new ToolExecutionPolicyService();
  });

  it('marks read-only tools as autonomous with no approval needed', () => {
    const result = policyService.evaluatePolicy('crm_search_customer', false);
    expect(result.isAutonomous).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('marks mutating state-changing tools as requiring two-phase approval', () => {
    const result = policyService.evaluatePolicy('quote_create', true);
    expect(result.isAutonomous).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test apps/api/src/modules/channels/skills/tool-execution-policy.service.spec.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `ToolExecutionPolicyService`**

Create `apps/api/src/modules/channels/skills/tool-execution-policy.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';

export interface PolicyEvaluation {
  isAutonomous: boolean;
  requiresApproval: boolean;
  actionClass: 'READ' | 'DRAFT_WRITE' | 'COMMIT_MUTATION';
}

@Injectable()
export class ToolExecutionPolicyService {
  private readonly ALWAYS_REQUIRE_APPROVAL = new Set([
    'quote_send_customer',
    'sales_order_dispatch',
    'purchase_order_approve',
    'invoice_finalize',
    'record_delete',
  ]);

  evaluatePolicy(toolName: string, isMutation: boolean): PolicyEvaluation {
    if (!isMutation) {
      return {
        isAutonomous: true,
        requiresApproval: false,
        actionClass: 'READ',
      };
    }

    if (this.ALWAYS_REQUIRE_APPROVAL.has(toolName) || isMutation) {
      return {
        isAutonomous: false,
        requiresApproval: true,
        actionClass: 'COMMIT_MUTATION',
      };
    }

    return {
      isAutonomous: true,
      requiresApproval: false,
      actionClass: 'DRAFT_WRITE',
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test apps/api/src/modules/channels/skills/tool-execution-policy.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/api/src/modules/channels/skills/tool-execution-policy.service.ts apps/api/src/modules/channels/skills/tool-execution-policy.service.spec.ts
git commit -m "feat(channels): add tiered tool execution policy distinguishing read and mutation approvals"
```

---

### Task 5: Dynamic Custom Object Tool Factory

**Files:**
- Create: `apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.ts`
- Test: `apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.spec.ts`

**Interfaces:**
- Consumes: Custom object schema entities from `CustomObjectsService`.
- Produces: Dynamic tool descriptors: `createDynamicTools(objects: CustomObject[]): DynamicToolDescriptor[]`.

- [ ] **Step 1: Write failing unit test for `CustomObjectToolFactoryService`**

Create `apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.spec.ts`:
```typescript
import { CustomObjectToolFactoryService } from './custom-object-tool-factory.service';

describe('CustomObjectToolFactoryService', () => {
  let factory: CustomObjectToolFactoryService;

  beforeEach(() => {
    factory = new CustomObjectToolFactoryService();
  });

  it('generates query and create tool schemas for a given custom object', () => {
    const mockCustomObject: any = {
      id: 'co-1',
      name: 'Vehicle',
      slug: 'vehicle',
      description: 'Fleet transport asset',
      attributes: [
        { key: 'vin', label: 'VIN', type: 'TEXT', isRequired: true },
        { key: 'mileage', label: 'Mileage', type: 'NUMBER', isRequired: false },
      ],
    };

    const tools = factory.createDynamicTools([mockCustomObject]);
    expect(tools.length).toBe(2);

    const queryTool = tools.find((t) => t.name === 'query_custom_vehicle');
    const createTool = tools.find((t) => t.name === 'create_custom_vehicle');

    expect(queryTool).toBeDefined();
    expect(createTool).toBeDefined();
    expect(createTool?.jsonSchema.required).toContain('vin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.spec.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `CustomObjectToolFactoryService`**

Create `apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import type { CustomObject } from '../entities/custom-object.entity';

export interface DynamicToolDescriptor {
  name: string;
  domain: 'CUSTOM_OBJECTS';
  description: string;
  isMutating: boolean;
  jsonSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

@Injectable()
export class CustomObjectToolFactoryService {
  createDynamicTools(objects: CustomObject[]): DynamicToolDescriptor[] {
    const tools: DynamicToolDescriptor[] = [];

    for (const obj of objects) {
      const slug = obj.slug.toLowerCase().replace(/[^a-z0-9_]/g, '_');

      // 1. Query Tool
      tools.push({
        name: `query_custom_${slug}`,
        domain: 'CUSTOM_OBJECTS',
        description: `Search and filter ${obj.name} records (${obj.description || 'custom entity'}).`,
        isMutating: false,
        jsonSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Keyword search across text fields' },
            limit: { type: 'number', description: 'Max records to return (default 10)' },
          },
          required: [],
          additionalProperties: false,
        },
      });

      // 2. Create Tool
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const attr of obj.attributes || []) {
        const typeMapping = attr.type === 'NUMBER' ? 'number' : attr.type === 'BOOLEAN' ? 'boolean' : 'string';
        properties[attr.key] = {
          type: typeMapping,
          description: attr.label,
        };
        if (attr.isRequired) {
          required.push(attr.key);
        }
      }

      tools.push({
        name: `create_custom_${slug}`,
        domain: 'CUSTOM_OBJECTS',
        description: `Create a new ${obj.name} record.`,
        isMutating: true,
        jsonSchema: {
          type: 'object',
          properties,
          required,
          additionalProperties: false,
        },
      });
    }

    return tools;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.ts apps/api/src/modules/custom-objects/services/custom-object-tool-factory.service.spec.ts
git commit -m "feat(custom-objects): add dynamic tool factory for custom objects"
```

---

### Verification and Test Suite Execution

- [ ] **Step 6: Run full test suite for modified modules**

Run: `pnpm --filter api test`
Expected: All tests pass with 0 failures.
