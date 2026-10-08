# Automation Workflow Engine Upgrade (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 1 of the Attio-grade automation workflow engine, adding a centralized domain event bus with before/after field diffing and autonomous Temporal ReAct agent nodes (`aiAgentNode`).

**Architecture:** A domain event bus (`CrmEventBusService`) captures mutations across custom objects and core entities with field-level diffs. `AutomationEventBridgeService` evaluates granular attribute filters to trigger `dynamic-dag.workflow.ts`, which dispatches multi-step autonomous tool-calling tasks as Temporal child workflows via `agentReActWorkflow`.

**Tech Stack:** NestJS 11, TypeORM 1, Temporal SDK 1.22, TypeScript 5.9, Jest, Redis (ioredis), pnpm workspace.

**Spec:** [docs/superpowers/specs/2026-10-08-automation-workflow-engine-upgrade-design.md](file:///C:/Users/Keerthana/ai_crm/docs/superpowers/specs/2026-10-08-automation-workflow-engine-upgrade-design.md)

## Global Constraints
- Node >= 22, TypeScript 5.9, NestJS 11, TypeORM 1, Temporal SDK 1.22.
- `packages/shared` is compiled, not source-linked: run `pnpm --filter shared build` after modifying.
- Multi-tenant data isolation strictly enforced via RLS and explicit `tenantId` query scoping.
- Non-blocking spend: budget pre-reservations must invoke `RedisBudgetGuardService`.
- No new schema drift: any migration or entity change must pass `pnpm check:drift`.

## Review Focus
1. **Unchanged Field False Positives:** `CrmEventBusService` diffing must ignore identical values (e.g. `updatedAt` alone shouldn't trigger an attribute filter).
2. **Missing Before Snapshot on First Create:** New records have `before: null`; trigger filters expecting `from` conditions must safely evaluate to false without throwing.
3. **Child Workflow Timeout & Cancellation:** When `dynamic-dag.workflow.ts` times out or is cancelled, the child `agentReActWorkflow` must cleanly abort.
4. **Tenant Isolation in Event Dispatch:** Event bridge must never evaluate or trigger workflows across tenant boundaries.
5. **Tool Scope Restrictions:** When an `aiAgentNode` specifies `allowedDomains: ['SALES']`, it must never be routed tools from `FINANCE` or other clusters.

---

### Task 1: Shared Types & Contracts for Events and AI Agent Node

**Files:**
- Modify: `packages/shared/src/automations/types.ts`
- Test: `packages/shared/src/automations/types.test.ts`

**Interfaces:**
- Produces: `CrmDomainEvent`, `AiAgentNodeConfig`, `AiAgentNodeResult`, updated `AutomationNodeType` including `'aiAgentNode'`.

- [ ] **Step 1: Write the failing test**
Add assertions in `packages/shared/src/automations/types.test.ts` validating that `'aiAgentNode'` is recognized by `validateWorkflowGraph` and that `CrmDomainEvent` and `AiAgentNodeConfig` compile cleanly.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @saas/shared test`
Expected: FAIL with missing types.

- [ ] **Step 3: Implement types in `packages/shared/src/automations/types.ts`**
Add `'aiAgentNode'` to `AutomationNodeType`, export `CrmDomainEvent`, `AiAgentNodeConfig`, and `AiAgentNodeResult`.

- [ ] **Step 4: Run test and build to verify it passes**
Run: `pnpm --filter @saas/shared test && pnpm --filter shared build`
Expected: PASS with clean build.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/
git commit -m "feat(shared): add aiAgentNode and CrmDomainEvent contracts"
```

---

### Task 2: Central Domain Event Bus Service

**Files:**
- Create: `apps/api/src/common/events/crm-event-bus.service.ts`
- Create: `apps/api/src/common/events/crm-event-bus.service.spec.ts`
- Modify: `apps/api/src/common/common.module.ts` (or relevant core module)

**Interfaces:**
- Consumes: `CrmDomainEvent` from `@saas/shared`.
- Produces: `CrmEventBusService.publish(event: CrmDomainEvent)`, `CrmEventBusService.subscribe(handler: (event: CrmDomainEvent) => Promise<void>)`, `computeChangedFields(before: any, after: any): string[]`.

- [ ] **Step 1: Write the failing test**
Create `apps/api/src/common/events/crm-event-bus.service.spec.ts` asserting:
1. `publish` notifies all registered subscribers.
2. `computeChangedFields` accurately detects modified keys and ignores identical scalar/object keys.
3. Errors in one subscriber do not disrupt other subscribers.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter api test src/common/events/crm-event-bus.service.spec.ts`
Expected: FAIL with service not found.

- [ ] **Step 3: Implement `CrmEventBusService` in `apps/api/src/common/events/crm-event-bus.service.ts`**
Implement the pub/sub event bus with error shielding and field diff calculation.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter api test src/common/events/crm-event-bus.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/common/events/
git commit -m "feat(events): implement CrmEventBusService with field diff calculation"
```

---

### Task 3: Custom Object & Core Entity Event Producers

**Files:**
- Modify: `apps/api/src/modules/custom-objects/services/custom-records.service.ts`
- Modify: `apps/api/src/modules/custom-objects/services/record-links.service.ts`
- Modify: `apps/api/src/modules/contacts/contacts.service.ts`
- Modify: `apps/api/src/modules/quotes/quotes.service.ts`
- Test: `apps/api/src/modules/custom-objects/services/custom-records.service.spec.ts`

**Interfaces:**
- Consumes: `CrmEventBusService` from Task 2.
- Produces: Emitted `record.created`, `record.updated`, `record.deleted` events with `before` and `after` snapshots.

- [ ] **Step 1: Write the failing test**
In `custom-records.service.spec.ts`, assert that `create`, `update`, and `delete` publish `CrmDomainEvent` to `CrmEventBusService` with correct `changedFields`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter api test src/modules/custom-objects/services/custom-records.service.spec.ts`
Expected: FAIL with event bus not called.

- [ ] **Step 3: Inject `CrmEventBusService` and emit events on mutations**
Update `CustomRecordsService`, `RecordLinksService`, `ContactsService`, and `QuotesService` to publish events after state changes.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter api test src/modules/custom-objects/services/custom-records.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/
git commit -m "feat(custom-objects): publish domain events on record and link mutations"
```

---

### Task 4: Intelligent Event Trigger Filtering in `AutomationEventBridgeService`

**Files:**
- Modify: `apps/api/src/modules/automations/services/automation-event-bridge.service.ts`
- Modify: `apps/api/src/modules/automations/services/automation-event-bridge.service.spec.ts`

**Interfaces:**
- Consumes: `CrmEventBusService`, `CrmDomainEvent`.
- Produces: Granular trigger matching on `entityName`, `eventType`, and field conditions (e.g. `changedFields.includes('status')`).

- [ ] **Step 1: Write the failing test**
In `automation-event-bridge.service.spec.ts`, add test cases asserting:
1. Triggers execute when `triggerConfig.event` and attribute conditions match.
2. Triggers ignore events when modified fields do not match `triggerConfig.fields`.
3. Tenant isolation guarantees no cross-tenant workflow execution.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter api test src/modules/automations/services/automation-event-bridge.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement trigger condition matching in `AutomationEventBridgeService`**
Wire `AutomationEventBridgeService` to subscribe on module initialization and evaluate field predicates before calling `automationsService.triggerExecution`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter api test src/modules/automations/services/automation-event-bridge.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/automations/services/
git commit -m "feat(automations): add field-level trigger condition matching in event bridge"
```

---

### Task 5: Temporal Child Workflow Execution for `aiAgentNode`

**Files:**
- Modify: `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.ts`
- Modify: `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.spec.ts`
- Modify: `apps/api/src/modules/automations/workflows/interfaces.ts`

**Interfaces:**
- Consumes: `agentReActWorkflow` from channels module, `AiAgentNodeConfig`.
- Produces: Execution of `executeChild(agentReActWorkflow, ...)` on `aiAgentNode`, populating `$json` context and forwarding approval signals.

- [ ] **Step 1: Write the failing test**
In `dynamic-dag.workflow.spec.ts`, create a workflow containing an `aiAgentNode` and assert:
1. `executeChild` is called with the node's goal, tenantId, and allowed tool domains.
2. The agent's output is saved into `executionState.nodeResults[nodeId].output`.
3. If the agent emits an approval state, `executionState.status` transitions to `WAITING_APPROVAL` until `approveNodeSignal` is signaled.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter api test src/modules/automations/workflows/dynamic-dag.workflow.spec.ts`
Expected: FAIL with `aiAgentNode` unsupported.

- [ ] **Step 3: Implement `aiAgentNode` handling in `dynamic-dag.workflow.ts`**
Add the `case 'aiAgentNode':` block, dispatching the child workflow with activity options, context substitution, and signal handling.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter api test src/modules/automations/workflows/dynamic-dag.workflow.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/automations/workflows/
git commit -m "feat(automations): execute agentReActWorkflow child workflow for aiAgentNode"
```

---

### Task 6: Full Integration Verification & Build

**Files:**
- Test: Full monorepo verification

- [ ] **Step 1: Verify shared, api, and web builds**
Run: `pnpm build`
Expected: Clean build across all packages.

- [ ] **Step 2: Run unit and integration tests**
Run: `pnpm test`
Expected: 100% test pass.

- [ ] **Step 3: Run schema drift check**
Run: `pnpm check:drift` (or test with node)
Expected: "No new drift."

- [ ] **Step 4: Final commit & push**
```bash
git commit -m "feat(automations): complete Phase 1 automation workflow engine upgrade"
```
