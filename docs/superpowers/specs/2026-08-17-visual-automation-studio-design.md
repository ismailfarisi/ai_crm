# Design Specification: n8n-Style Visual Automation Studio with Temporal Orchestration

## Overview
This specification details the architecture, data models, user interface, and execution engine for an **n8n-style Visual Automation Studio** within Relay CRM. The system empowers users to visually design, deploy, and inspect automated workflows using an interactive 2D node graph canvas (`@xyflow/react`), backed by a durable, fault-tolerant **Temporal.io Dynamic DAG Execution Engine**.

---

## 1. User Interface & Canvas Architecture (`apps/web`)

### 1.1 Routes & Views
1. **Automations Dashboard (`/automations`)**:
   - Lists all created workflows with status indicators (Active, Inactive/Draft), trigger types, total execution count, last execution timestamp, and quick-action menu (Edit, Duplicate, Delete, Run Now).
   - "New Automation" button to open blank template or starter presets (e.g., *Quote Approval to Invoice*, *Inbound Lead Webhook to CRM Contact*, *Daily Cron Follow-up*).

2. **Workflow Studio Canvas (`/automations/[id]`)**:
   - **Header Bar**: Workflow title editor, status pill, "Save" button with dirty state indicator, "Test Run" button, "Activate / Pause" toggle switch, and "Execution History" link.
   - **Canvas Viewport (`@xyflow/react`)**:
     - Infinite panning & zooming surface with grid background.
     - Custom styled node cards with icons, category headers, input/output handles, status badges, and execution metrics.
     - Smooth animated bezier curves between connected nodes.
     - Mini-map and navigation controls (Zoom In/Out, Fit View, Center).
   - **Searchable Node Drawer (Left Sidebar)**:
     - Categories: Triggers, Logic/Flow, Actions, Integrations, Human-in-the-Loop.
     - Drag-and-drop or click-to-place onto canvas.
   - **Node Inspector Drawer (Right Sidebar)**:
     - Opens when clicking any node on the canvas.
     - Parameter inputs, variable pickers, JSON schema editors, and live expression evaluator preview.
   - **Test Run & Live Execution Drawer (Bottom/Right)**:
     - Real-time step-by-step trace showing per-node status (Running, Succeeded, Failed, Paused).
     - Inspect raw JSON input and output payloads for any executed node.

3. **Execution History & Audit Log (`/automations/[id]/executions` and `/automations/executions/[execId]`)**:
   - Chronological table of all workflow runs.
   - Detailed execution replay canvas where node status highlights in green/red and shows runtime durations.

---

## 2. Supported Node Types & Capabilities

### 2.1 Triggers (Entry Points)
* **Webhook Trigger (`webhookTrigger`)**:
  - Generates a tenant-scoped webhook URL (`/api/automations/webhook/:slug`).
  - Supports HTTP methods (POST, GET), custom secret header verification, and automatic payload schema inference.
* **Schedule Trigger (`scheduleTrigger`)**:
  - Cron expression or human-friendly intervals (Every 15 min, Daily at 9am, Weekly on Mondays).
* **CRM Event Trigger (`crmEventTrigger`)**:
  - Listens to internal CRM events: `QUOTE_CREATED`, `QUOTE_APPROVED`, `CONTACT_CREATED`, `DEAL_STAGE_CHANGED`.
* **Manual / On-Demand (`manualTrigger`)**:
  - Triggered via API or "Run Now" UI button with custom test parameters.

### 2.2 Core Logic & Flow Control
* **If / Condition (`conditionNode`)**:
  - Evaluates comparison expressions (e.g. `$json.amount > 5000`, `$json.customerEmail contains "@corp.com"`).
  - Two distinct output handles: `true` (Green) and `false` (Gray).
* **Code / Transform (`transformNode`)**:
  - Safe sandboxed JavaScript / JSON mapping.
  - Allows array transformations, arithmetic calculations, date formatting, and custom object reshaping.
* **Delay / Timer (`delayNode`)**:
  - Pauses execution for a duration (e.g., 2 hours, 3 days) or until a specific timestamp using Temporal durable timers.

### 2.3 Actions
* **HTTP Request (`httpRequestNode`)**:
  - Full REST client: Method (GET/POST/PUT/PATCH/DELETE), URL, Headers, Query Params, Basic/Bearer Auth, JSON Body.
* **AI Prompt / Completion (`aiPromptNode`)**:
  - Calls internal LLM engine with customizable prompt templates and context interpolation (e.g., `"Summarize this deal for {{ $json.customerName }}: {{ $json.notes }}"`).
* **Send Email (`sendEmailNode`)**:
  - Sends formatted transactional or notification emails with dynamic recipients and templates.
* **CRM Mutation (`crmMutateNode`)**:
  - Direct internal operations: Create Invoice, Update Quote, Add Contact Note, Create Task.

### 2.4 Human-in-the-Loop
* **Approval Gate (`approvalNode`)**:
  - Pauses workflow execution in Temporal.
  - Sends approval request to assigned user/manager.
  - Two output branches: `Approved` and `Rejected`. Resumes immediately upon receiving approval or rejection signal from UI or email action link.

---

## 3. Database Schema (`apps/api`)

### 3.1 `AutomationWorkflow` Entity
```typescript
@Entity('automation_workflows')
export class AutomationWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 50, default: 'DRAFT' })
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';

  @Column({ type: 'varchar', length: 50 })
  triggerType: 'WEBHOOK' | 'SCHEDULE' | 'CRM_EVENT' | 'MANUAL';

  @Column({ type: 'jsonb', default: {} })
  triggerConfig: Record<string, any>;

  @Column({ type: 'jsonb', default: [] })
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: {
      label: string;
      config: Record<string, any>;
      continueOnFail?: boolean;
      retryCount?: number;
    };
  }>;

  @Column({ type: 'jsonb', default: [] })
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  webhookSlug?: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 3.2 `AutomationExecution` Entity
```typescript
@Entity('automation_executions')
export class AutomationExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'uuid' })
  workflowId: string;

  @Column({ type: 'varchar', length: 150 })
  temporalWorkflowId: string;

  @Column({ type: 'varchar', length: 50, default: 'RUNNING' })
  status: 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

  @Column({ type: 'jsonb', default: {} })
  triggerPayload: Record<string, any>;

  @Column({ type: 'jsonb', default: {} })
  nodeResults: Record<string, {
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING';
    input?: any;
    output?: any;
    error?: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
  }>;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;
}
```

---

## 4. Temporal Dynamic DAG Engine (`apps/api`)

### 4.1 Expression Evaluator (`{{ expression }}`)
The workflow maintains an execution context dictionary:
```typescript
interface ExecutionContext {
  $trigger: Record<string, any>;
  $json: Record<string, any>; // Last parent node output
  $node: Record<string, { json: any }>; // All completed nodes by label/ID
  $env: Record<string, string>;
}
```
All string templates are interpolated with dynamic values before activity dispatch.

### 4.2 Dynamic DAG Traversal Workflow (`dynamicDagWorkflow`)
1. **Initialization**:
   - Parses `nodes` and `edges` graph.
   - Builds adjacency list and in-degree maps.
   - Registers Signal handlers (`approveNodeSignal`, `rejectNodeSignal`, `cancelWorkflowSignal`).
   - Registers Query handlers (`getExecutionStateQuery`).
2. **Topological Execution Loop**:
   - Traverses nodes starting from the Trigger node.
   - Evaluates node configs and resolves expression parameters.
   - If node is **Condition**: Evaluates expression and activates either the `true` or `false` outbound edges.
   - If node is **Delay**: Invokes `workflow.sleep(durationMs)`.
   - If node is **Approval**: Transitions execution status to `WAITING_APPROVAL`, notifies reviewers, and halts at `await condition(() => isApproved || isRejected)`.
   - If node is an **Action Activity** (HTTP, AI, Email, CRM): Calls activity proxy with retry policy and logs output.
3. **Execution State Persistence**:
   - Executes `recordNodeResultActivity` on completion of each step, updating the `AutomationExecution` table in PostgreSQL for live UI monitoring.

---

## 5. Security & Multi-Tenancy
* **Multi-Tenant Isolation**: Every workflow query, execution, and webhook verification enforces tenant scoping via `tenantId`.
* **Safe Sandbox Execution**: Transform code nodes run in a secure isolated context without access to process environment or native file systems.
* **RBAC Permissions**:
  - `AUTOMATION_READ`: View workflows and execution logs.
  - `AUTOMATION_CREATE` / `AUTOMATION_UPDATE`: Create and edit workflow graphs.
  - `AUTOMATION_EXECUTE`: Test run and trigger workflows manually.
  - `AUTOMATION_APPROVE`: Approve/reject human-in-the-loop steps.

---

## 6. Verification & Testing Plan
* **Unit Tests**:
  - Graph topological sorting & DAG branch evaluation tests (`vitest`).
  - Expression evaluator syntax replacement tests (`{{ $json.foo }}`).
* **Temporal Workflow & Activities Tests**:
  - Mocked activity execution tests using `@temporalio/testing`.
  - Signal and Approval Gate resumption tests.
* **Frontend E2E & Component Tests**:
  - Canvas drag-and-drop, node creation, edge connection, and inspector update testing.
  - Live execution viewer state rendering tests.
