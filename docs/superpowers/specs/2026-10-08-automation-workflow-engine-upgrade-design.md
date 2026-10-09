# Automation Workflow Engine Upgrade — Phase 1 Design Spec

## 1. Goal
Modernize Relay CRM's automation workflow engine to achieve Attio-grade extensibility and AI autonomy. Phase 1 bridges the Custom Objects engine (PR #9) and the Scalable AI Tool-Calling Engine (PR #10) with a unified domain event bus with field diffing and autonomous Temporal ReAct agent nodes.

## 2. Architecture & Components

### 2.1 Domain Event Bus with Field Diffing (`CrmEventBusService`)
- Provides a centralized event pipeline across the NestJS API.
- Emits structured events with before and after snapshots:
  ```typescript
  export interface CrmDomainEvent<T = any> {
    tenantId: string;
    eventType: 'record.created' | 'record.updated' | 'record.deleted' | 'link.created' | 'link.deleted';
    entityType: 'core' | 'custom_object';
    entityName: string; // e.g. 'contact', 'quote', 'invoice', or custom object slug like 'vehicle'
    entityId: string;
    actorUserId?: string | null;
    timestamp: string;
    snapshot: {
      before?: T | null;
      after: T;
      changedFields: string[];
    };
  }
  ```

### 2.2 Entity Event Producers
- **Custom Objects:** `CustomRecordsService` produces events on `create`, `update`, `delete`, and `RecordLinksService` on `link`/`unlink`.
- **Core Entities:** `ContactsService`, `QuotesService`, and `InvoicesService` emit domain events on state updates.

### 2.3 Intelligent Event Bridge (`AutomationEventBridgeService`)
- Subscribes to `CrmEventBusService`.
- Matches active automation workflows with `triggerType: 'CRM_EVENT'`.
- Evaluates attribute-level filter conditions in `triggerConfig` (e.g. `changedFields.includes('status') && after.status === 'ISSUED'`).
- Dispatches executions to Temporal DAG workflow with rich `$json` context.

### 2.4 Autonomous ReAct Agent Node (`aiAgentNode`)
- Add `aiAgentNode` to `AutomationNodeType` in `@saas/shared`.
- Define `AiAgentNodeConfig`:
  ```typescript
  export interface AiAgentNodeConfig {
    goal: string;
    allowedDomains?: Array<'SALES' | 'PRODUCTION' | 'FINANCE' | 'CUSTOM_OBJECTS' | 'GENERAL'>;
    autoApprove?: boolean;
    timeoutDuration?: string;
  }
  ```
- In `dynamic-dag.workflow.ts`:
  - Dispatches `agentReActWorkflow` as a Temporal Child Workflow (`executeChild`).
  - Passes tenant context, tool cluster scope, and input variables from earlier nodes.
  - Intercepts `COMMIT_MUTATION` states; pauses node if approval is required until `approveNodeSignal` is signaled.
  - Outputs full execution telemetry: `resultText`, `stepsTaken`, `toolCalls`, `totalTokens`, `estimatedCostUsd`.

## 3. Global Constraints
- Node >= 22, TypeScript 5.9, NestJS 11, TypeORM 1, Temporal SDK 1.22.
- Multi-tenant data isolation strictly enforced via RLS and explicit `tenantId` query scoping.
- Non-blocking spend: budget pre-reservations must invoke `RedisBudgetGuardService`.
