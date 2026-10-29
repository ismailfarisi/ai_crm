# Automation Run History and Approvals Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every automation run keeps a lasting step-by-step record in the database. Each automation's editor gets a Runs panel. The organisation gets one Approvals inbox where anyone with `automation:approve` decides waiting items.

**Architecture:** The workflow's existing `recordNodeResultActivity` call gets a real, DI-built body that merges each step into `automation_executions.nodeResults`. It also creates and closes rows in a new `automation_approvals` table. A new `recordRunFinishedActivity`, behind `patched('run-history-v1')`, writes the final status. Screens read only Postgres. Decisions go through one claim-then-signal path in a new `AutomationApprovalsService`.

**Tech Stack:** NestJS 11, TypeORM, Postgres 18 with RLS, Temporal TS SDK 1.22, Next.js 16, React Query, Vitest and Jest.

**Spec:** `docs/superpowers/specs/2026-10-29-automation-run-history-approvals-design.md`

## Global Constraints

- Permissions come from `packages/shared/src/rbac/permissions*` constants only. No hand-written permission strings.
- After editing `packages/shared`, run `pnpm --filter @saas/shared build` before the apps see it.
- The schema is owned by migrations. `pnpm check:drift` must stay green, and `pnpm migration:generate` must report no drift after your migration.
- New tenant tables get `tenant_isolation_policy` the same way as `apps/api/src/database/migrations/1787600000000-EnablePostgresRowLevelSecurity.ts` (`enableTenantPolicy`).
- Automation tables use quoted camelCase column names (`"tenantId"`, `"executionId"`).
- Workflow code (`apps/api/src/modules/automations/workflows/*.workflow.ts` and whatever they import) runs in Temporal's sandbox. Use relative imports only (no `@/`). Import shared code through narrow subpaths only, never the `@saas/shared` barrel at runtime (type-only imports are fine).
- Stored step `input` and `output` cap: **16384** characters of `JSON.stringify` each. A larger value is replaced by `{ truncated: true, size: <length>, preview: <first 4096 chars of the JSON string> }`.
- Copy, verbatim:
  - "Nothing is waiting for approval."
  - "You can't see the data in this run."
  - "Details weren't recorded for this run."
  - "Couldn't start the run"
  - "Already approved by {name}, {relative time}" and "Already rejected by {name}, {relative time}"
- Status labels: RUNNING "Running", WAITING_APPROVAL "Waiting for approval", COMPLETED "Completed", FAILED "Failed", CANCELLED "Cancelled", UNKNOWN "Unknown".
- Source labels: event "Event", webhook "Webhook", schedule "Schedule", test "Test", null "—".
- Don't stage or modify `apps/web/src/lib/api/config.ts`, `docs/DEPLOYMENT.md`, the root `package.json`, `.archify/` or `scripts/local-deploy.mjs`. Stage files by explicit path.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WKq2xivctfx72NGA78kagN
  ```

## Review Focus

1. **Two approvers click at once:** exactly one claim succeeds, and the other gets 409 naming the first decider. This is tested in Task 4.
2. **The approval step times out while the inbox is open:** deciding it answers 409 "no longer pending", and the inbox drops it after refetch. The row becomes `EXPIRED`, not `APPROVED`. Tested in Tasks 2 and 4.
3. **A member without `automation:update` opens a run:** the response has no `triggerPayload`, step `input`/`output`, or agent preview, and the panel shows "You can't see the data in this run." Tested in Tasks 5 and 6.
4. **A run started before the deploy finishes after it:** the migration has marked it `UNKNOWN`, and the workflow's later records overwrite that with real state. `patched()` keeps its replay deterministic. Tested in Tasks 2 and 3.
5. **The nav on `/automations/approvals`:** only "Approvals" is active, not "Automations" as well. The badge is hidden at 0. Tested in Task 7.

---

### Task 1: Data layer — migrations, entities, shared types

**Files:**
- Create: `apps/api/src/database/migrations/1790800000000-AutomationRunHistory.ts`
- Create: `apps/api/src/database/migrations/1790800000001-AutomationRunHistoryCloseOut.ts`
- Create: `apps/api/src/modules/automations/entities/automation-approval.entity.ts`
- Modify: `apps/api/src/modules/automations/entities/automation-execution.entity.ts`
- Modify: `apps/api/src/modules/automations/automations.module.ts` (TypeOrmModule.forFeature)
- Modify: `apps/api/src/modules/audit/audit-subjects.ts`
- Modify: `packages/shared/src/automations/types.ts` (exported from the package as today)
- Test: `packages/shared/src/automations/types.test.ts`

**Interfaces:**
- Produces, in shared:
  - `type AutomationExecutionStatus = 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'`
  - `type ExecutionTriggerSource = 'event' | 'webhook' | 'schedule' | 'test'`
  - `type AutomationApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED'`
  - `type AutomationApprovalKind = 'step' | 'agent_action'`
  - `interface ExecutionStepResultDto`:
    - `status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING'`
    - `label?: string; type?: string`
    - `input?: unknown; output?: unknown; error?: string`
    - `startedAt: string; finishedAt?: string; durationMs?: number`
  - `AutomationExecutionDto` changes:
    - `status` becomes `AutomationExecutionStatus`
    - `nodeResults` becomes `Record<string, ExecutionStepResultDto>`
    - new: `triggerSource: ExecutionTriggerSource | null; dataHidden: boolean; pendingApprovals: AutomationApprovalDto[]`
  - `interface AutomationExecutionSummaryDto`: `id, workflowId, status, triggerSource, startedAt, finishedAt: string | null, errorMessage: string | null`
  - `interface AutomationExecutionPageDto`: `items: AutomationExecutionSummaryDto[]; nextCursor: string | null`
  - `interface AutomationApprovalDto`:
    - `id, executionId, workflowId, nodeId, kind, title: string, details: Record<string, unknown>`
    - `status: AutomationApprovalStatus; requestedAt: string; expiresAt: string | null`
    - `decidedBy: { id: string; name: string } | null; decidedAt: string | null; comment: string | null`
    - `workflowName: string; triggerSource: ExecutionTriggerSource | null; triggerSummary: string`
  - `interface ApprovalDecisionPayload`: `action: 'APPROVE' | 'REJECT'; comment?: string`
  - `interface ApprovalAlreadyDecidedBody`: `message: string; status: AutomationApprovalStatus; decidedBy: { id: string; name: string } | null; decidedAt: string | null`
  - `function executionStatusLabel(s: AutomationExecutionStatus): string` and `function triggerSourceLabel(s: ExecutionTriggerSource | null): string`, returning the Global Constraints labels.
- Produces, in the API:
  - `AutomationApproval` entity on table `automation_approvals` with columns:
    - `id` uuid
    - `tenantId`, `executionId`, `workflowId`: uuid
    - `nodeId` varchar(150)
    - `kind` varchar(20)
    - `title` varchar(255)
    - `details` jsonb default `{}`
    - `status` varchar(20) default `'PENDING'`
    - `requestedAt` timestamptz, `expiresAt` timestamptz nullable
    - `decidedByUserId` uuid nullable, `decidedAt` timestamptz nullable, `comment` text nullable
  - `AutomationExecution.triggerSource: ExecutionTriggerSource | null`, as varchar(20) nullable.

- [ ] **Step 1: Write the failing shared test.** `executionStatusLabel('UNKNOWN') === 'Unknown'`, `executionStatusLabel('WAITING_APPROVAL') === 'Waiting for approval'`, `triggerSourceLabel(null) === '—'`, `triggerSourceLabel('schedule') === 'Schedule'`.
- [ ] **Step 2: Run** `pnpm --filter @saas/shared test -- types`. Expected: FAIL, because the label functions aren't defined.
- [ ] **Step 3: Implement the shared types and labels, then** `pnpm --filter @saas/shared build`.
- [ ] **Step 4: Migration `1790800000000-AutomationRunHistory`:**
  - `ALTER TYPE automation_executions_status_enum ADD VALUE IF NOT EXISTS 'UNKNOWN'`
  - add `"triggerSource" varchar(20) NULL` to `automation_executions`
  - create `automation_approvals` with:
    - FK `"executionId"` → `automation_executions(id) ON DELETE CASCADE`
    - index `idx_automation_approvals_tenant_status_requested` on `("tenantId", status, "requestedAt")`
    - partial unique index `uq_automation_approvals_pending_node` on `("executionId", "nodeId") WHERE status = 'PENDING'`
    - index on `"executionId"`
  - enable RLS with the same policy SQL as `enableTenantPolicy`
  - grant the app role the same privileges other tenant tables get (copy what `1790700000000` or the RLS migration does)
  - `down` reverses everything except the enum value (Postgres can't drop one; comment that).
- [ ] **Step 5: Migration `1790800000001-AutomationRunHistoryCloseOut`.** It's separate because a new enum value can't be used in the transaction that adds it. `UPDATE automation_executions SET status = 'UNKNOWN' WHERE status IN ('RUNNING','WAITING_APPROVAL') AND "nodeResults" = '{}'::jsonb`. `down` is a no-op with a comment.
- [ ] **Step 6: Update the entities.** Execution: add `UNKNOWN` to both the union and the `enum:` array, and add `triggerSource`. Add the `AutomationApproval` entity with `@Index` decorators matching the migration. Register it in `automations.module.ts`. Add `'automation-approvals': { subject: 'AUTOMATION_APPROVAL', entity: AutomationApproval }` to `AUDIT_SUBJECTS`.
- [ ] **Step 7: Verify.** Run `pnpm db:up && pnpm migration:run`, then `pnpm migration:generate CheckNoDrift` (expected: no changes; delete any generated file), then `pnpm check:drift` (expected: PASS). Run `pnpm --filter @saas/shared test` and `pnpm --filter api test -- automations` (expected: PASS; fix any typing fallout from the widened status union).
- [ ] **Step 8: Commit** the files above: `feat(automations): run-history and approvals schema`.

### Task 2: Run-record activities (worker side)

**Files:**
- Create: `apps/api/src/modules/automations/workflows/run-record.activities.ts`
- Create: `apps/api/src/modules/automations/workflows/run-record.activities.spec.ts`
- Create: `apps/api/src/modules/automations/workflows/duration.ts` (sandbox-safe; no imports)
- Create: `apps/api/src/modules/automations/workflows/duration.spec.ts`
- Modify: `apps/api/src/modules/automations/workflows/automation.activities.ts` (remove the `recordNodeResultActivity` stub)
- Modify: `apps/api/src/modules/automations/workflows/interfaces.ts`
- Modify: `apps/api/src/temporal-worker.ts`

**Interfaces:**
- Consumes: the Task 1 entities.
- Produces:
  - `durationToMs(value: string | undefined): number | null` accepts `"<n>"` (ms) and `"<n><unit>"` with optional space. Units: ms, s/sec/second(s), m/min/minute(s), h/hr/hour(s), d/day(s), w/week(s). Case-insensitive, decimals allowed. Anything else returns `null`.
  - `RecordNodeResultParams` gains:
    - `label?: string`
    - `approval?: { id: string; kind: AutomationApprovalKind; title: string; details: Record<string, unknown>; requestedAt: string; expiresAt: string | null }`, sent only with `status: 'WAITING'`
  - `interface RecordRunFinishedParams { executionId: string; tenantId: string; status: 'COMPLETED' | 'FAILED' | 'CANCELLED'; errorMessage?: string | null; finishedAt: string }`
  - `createRunRecordActivities(deps: { executions: Repository<AutomationExecution>; approvals: Repository<AutomationApproval>; tenantContext: Pick<TenantContextService, 'runWithTenant'> })` returns `{ recordNodeResultActivity(p: RecordNodeResultParams): Promise<RecordNodeResultResult>; recordRunFinishedActivity(p: RecordRunFinishedParams): Promise<void> }`
  - `capForStorage(value: unknown): unknown` is exported for tests and applies the 16384/4096 rule.

**Behaviour:** both run in `deps.tenantContext.runWithTenant(p.tenantId, …)`.

`recordNodeResultActivity`:
1. Merges one key into `nodeResults` with `UPDATE … SET "nodeResults" = "nodeResults" || jsonb_build_object($nodeId, $result::jsonb)`. The result holds `status, label, type (=nodeType), input/output (capped), error, startedAt, finishedAt, durationMs`.
2. If `status === 'WAITING'` and `approval` is given:
   - set any other `PENDING` row of the same (execution, node) to `CANCELLED`;
   - insert the approval with `ON CONFLICT (id) DO NOTHING`, so it's retry-safe.
3. If `status` is SUCCESS, FAILED or SKIPPED, closes that node's `PENDING` rows: `EXPIRED` where `"expiresAt" <= now()`, else `CANCELLED`.
4. Sets the execution's status, but only where its current status is in (`RUNNING`, `WAITING_APPROVAL`, `UNKNOWN`). It becomes `WAITING_APPROVAL` if any `PENDING` approval of the run remains, otherwise `RUNNING`.

`recordRunFinishedActivity`:
- Updates `status`, `errorMessage` and `finishedAt`, where the status isn't already `COMPLETED`, `FAILED` or `CANCELLED`.
- Closes all of the run's `PENDING` approvals, with the same EXPIRED/CANCELLED rule.

- [ ] **Step 1: Write the failing tests.**
  - `durationToMs`: `'3 days'` → 259200000; `'24 hours'` → 86400000; `'1 week'` → 604800000; `'90s'` → 90000; `'soon'` → null; `undefined` → null.
  - `capForStorage`: a 20000-char string value gives `{ truncated: true, size: >16384, preview.length === 4096 }`; a small object is returned unchanged.
  - Activities, against a real test DB if the repo's other activity specs do that, otherwise with mocked repositories and query-text assertions:
    - one merge writes only its own key;
    - running the same call twice leaves one approval row;
    - WAITING with an approval sets the execution to `WAITING_APPROVAL`;
    - a later SUCCESS for that node turns the approval `CANCELLED` (or `EXPIRED` when `expiresAt` is in the past) and the run back to `RUNNING`;
    - `recordRunFinishedActivity` doesn't overwrite `COMPLETED`;
    - an `UNKNOWN` row becomes `RUNNING` on the first step record.
- [ ] **Step 2: Run** `pnpm --filter api test -- run-record duration`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `duration.ts` and `run-record.activities.ts`, and delete the stub from `automation.activities.ts`.
- [ ] **Step 4: Wire the worker.** In `temporal-worker.ts`, build `createRunRecordActivities({ executions: getRepositoryToken(AutomationExecution), approvals: getRepositoryToken(AutomationApproval), tenantContext })` with `appContext.get`, and spread it into the `automations-queue` activities.
- [ ] **Step 5: Run** `pnpm --filter api test -- run-record duration automation.activities`. Expected: PASS.
- [ ] **Step 6: Commit**: `feat(automations): record each step and approval of a run`.

### Task 3: Workflow records labels, approvals and the final status

**Files:**
- Modify: `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.ts`
- Modify: `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.spec.ts`

**Interfaces:**
- Consumes: from Task 2, `recordNodeResultActivity` (extended params), `recordRunFinishedActivity` and `durationToMs`. The `proxyActivities` type becomes `typeof activities & ReturnType<typeof createAutomationActions> & ReturnType<typeof createRunRecordActivities>` (type-only import).
- Produces: no new exports.

**Changes:**
1. Every `recordNodeResultActivity` call passes `label: node.data?.label`.
2. **Approval step WAITING record:** passes `approval` with:
   - `id: uuid4()` (from `@temporalio/workflow`)
   - `kind: 'step'`, `title: node.data.label || 'Approval'`
   - `details: { message: config.message ?? null }`. `config` is already interpolated, so `{{ }}` in `message` resolves here.
   - `requestedAt` (the existing ISO string)
   - `expiresAt: ms === null ? null : new Date(Date.now() + ms).toISOString()`, using `durationToMs(timeoutDuration)`
3. **Agent approval WAITING record**, in the `agentApprovalRequestedSignal` handler: same shape with `kind: 'agent_action'`, `title: node?.data?.label ?? 'AI Agent'` and `details: { tool: request.tool, preview: request.preview }`.
4. **Approval signals.** The handlers already receive `approvedBy`/`rejectedBy`. The `approved` output already includes `approvedBy`; the rejected output must include `rejectedBy`, and both the approval-node and the agent paths must keep these fields. No change is needed if both already do; assert it in a test.
5. **Final status.** Move the current body into `async function runDag(): Promise<WorkflowExecutionState>` inside `dynamicDagWorkflow`, leaving the handlers and state where they are. Then:
   ```ts
   try {
     const state = await runDag();
     if (patched('run-history-v1')) await recordRunFinishedActivity({ executionId, tenantId, status: state.status === 'FAILED' ? 'FAILED' : 'COMPLETED', errorMessage: state.errorMessage ?? null, finishedAt: state.finishedAt ?? new Date().toISOString() });
     return state;
   } catch (err) {
     if (patched('run-history-v1')) await recordRunFinishedActivity({ executionId, tenantId, status: isCancellation(err) ? 'CANCELLED' : 'FAILED', errorMessage: isCancellation(err) ? null : failureReason(err), finishedAt: new Date().toISOString() });
     throw err;
   }
   ```
   For cancellation, run the record inside `CancellationScope.nonCancellable`.
6. The `no start node` early return must also set `finishedAt`. It already does; keep it inside `runDag`.

- [ ] **Step 1: Write the failing workflow tests**, in the existing spec style with mocked activities:
  - a 2-step run calls `recordRunFinishedActivity` once with `COMPLETED`;
  - a failing step without `continueOnFail` gets `FAILED` with the step's message;
  - an approval step's WAITING record carries `approval.kind === 'step'`, `details.message` interpolated from `{{ $trigger.payload.name }}`, and an `expiresAt` 3 days after `requestedAt` by default;
  - an agent approval request carries `kind: 'agent_action'` and the tool and preview;
  - every node record carries `label`;
  - a rejection output carries `rejectedBy`.
- [ ] **Step 2: Run** `pnpm --filter api test -- dynamic-dag`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter api test -- dynamic-dag automations-queue`. Expected: PASS. Then run `pnpm --filter api build`, and check that the worker bundle still builds: run `pnpm dev:worker` briefly or the repo's bundle check, and confirm no `@/` import or barrel import of `@saas/shared` entered the workflow graph.
- [ ] **Step 5: Commit**: `feat(automations): workflow records step labels, approvals and final status`.

### Task 4: Approvals API

**Files:**
- Create: `apps/api/src/modules/automations/approvals/automation-approvals.service.ts`
- Create: `apps/api/src/modules/automations/approvals/automation-approvals.service.spec.ts`
- Create: `apps/api/src/modules/automations/approvals/automation-approvals.controller.ts`
- Create: `apps/api/src/modules/automations/approvals/automation-approvals.controller.spec.ts`
- Create: `apps/api/src/modules/automations/approvals/approval-decision.dto.ts`
- Modify: `apps/api/src/modules/automations/automations.module.ts`
- Modify: `apps/api/src/modules/automations/automations.service.ts` (`signalExecution` delegates)

**Interfaces:**
- Consumes: Task 1's entities and shared DTOs; `TemporalService.getClient()`; `getExecutionStateQuery`, `approveNodeSignal` and `rejectNodeSignal` from `workflows/interfaces`; the users repository or `UsersService`, to resolve decider names.
- Produces: `AutomationApprovalsService` with:
  - `listPending(tenantId: string): Promise<AutomationApprovalDto[]>`, oldest `requestedAt` first, max 200
  - `countPending(tenantId: string): Promise<number>`
  - `findPendingForExecution(tenantId: string, executionId: string): Promise<AutomationApprovalDto[]>`
  - `decide(tenantId: string, approvalId: string, user: { id: string }, payload: ApprovalDecisionPayload): Promise<AutomationApprovalDto>`
  - `decideByNode(tenantId: string, executionId: string, nodeId: string, user: { id: string }, payload: ApprovalDecisionPayload): Promise<AutomationApprovalDto>`, which finds the node's `PENDING` row and calls `decide`
  - `triggerSummary(exec: AutomationExecution): string`:
    - event: `"<eventType>"`, plus `" — <name>"` when `triggerPayload.payload` has `name`, or `firstName`+`lastName`, or `title`
    - webhook: `"Webhook"`
    - schedule: `"Schedule, <HH:mm> <timezone>"` from `triggerPayload.scheduledAt`/`timezone`
    - test: `"Test run"`
    - null: `"—"`
- Routes, on controller prefix `automation-approvals` (not under `automations/`, so it can't collide with `@Get(':id')`):
  - `GET /automation-approvals` → `AutomationApprovalDto[]`
  - `GET /automation-approvals/count` → `{ count: number }`
  - `POST /automation-approvals/:approvalId/decision`, body `ApprovalDecisionPayload` (class-validator DTO: `action` IsIn, `comment` optional string max 1000) → `AutomationApprovalDto`
  - all require `PERMISSIONS.AUTOMATION_APPROVE`; declare `count` above `:approvalId`.

**`decide` algorithm:**
1. Load the row by id and tenant; if absent, 404.
2. If its status isn't `PENDING`, 409 with an `ApprovalAlreadyDecidedBody`. The message is "Already decided" or "No longer pending" (for EXPIRED/CANCELLED).
3. Query the live state (`getExecutionStateQuery`) of the execution's `temporalWorkflowId`. If `pendingApprovals[nodeId]` is absent, set the row `EXPIRED` if `expiresAt` has passed, else `CANCELLED`, then 409 "No longer pending". If Temporal is unreachable, 503 "Unable to deliver the approval decision to the workflow".
4. Claim it: `UPDATE … SET status = APPROVED|REJECTED, "decidedByUserId", "decidedAt" = now(), comment WHERE id = $1 AND status = 'PENDING' RETURNING *`. If 0 rows, reload and 409 with the body.
5. Signal `approveNodeSignal` with `{ nodeId, approvedBy: user.id, comment }`, or `rejectNodeSignal` with `{ nodeId, rejectedBy: user.id, reason: comment }`. On failure, revert the claim (`status = 'PENDING'`, decided fields null, where `id` matches and the status is the one just claimed) and 503 with the same message.
6. If the run has no other `PENDING` approvals, set the execution `status = 'RUNNING'` where it's `WAITING_APPROVAL`.
7. Return the DTO with `decidedBy` resolved to `{ id, name }`.

`AutomationsService.signalExecution` keeps its route and DTO but calls `approvals.decideByNode` and returns the execution afterwards. Pass the user from the controller; this adds `@CurrentUser()` to that route.

- [ ] **Step 1: Write the failing service tests:**
  - the first decision wins and a concurrent second gets 409 with `decidedBy`;
  - a failed signal restores `PENDING` and answers 503;
  - a live state without the node gives 409 and closes the row as EXPIRED or CANCELLED by `expiresAt`;
  - another tenant's id gives 404;
  - a decision sets the run back to RUNNING only when no other approval of it is pending;
  - `countPending` counts only `PENDING` rows of the tenant;
  - each `triggerSummary` case.
- [ ] **Step 2: Write the failing controller tests:** the permission metadata is `automation:approve` on all three routes; the DTO rejects `action: 'MAYBE'` and a 1001-char comment.
- [ ] **Step 3: Run** `pnpm --filter api test -- automation-approvals`. Expected: FAIL.
- [ ] **Step 4: Implement** the service, controller and DTO; register both in the module; change `signalExecution` to delegate. Update `automations.service.spec.ts` / `automations.controller.spec.ts` for the delegation.
- [ ] **Step 5: Run** `pnpm --filter api test -- automations`. Expected: PASS.
- [ ] **Step 6: Commit**: `feat(automations): approvals inbox API with first-decision-wins`.

### Task 5: Runs API — sources, paging, DB-only detail, data visibility

**Files:**
- Modify: `apps/api/src/modules/automations/automations.service.ts`
- Modify: `apps/api/src/modules/automations/automations.controller.ts`
- Modify: `apps/api/src/modules/automations/webhooks/automation-webhook.service.ts`
- Modify: `apps/api/src/modules/automations/workflows/scheduled-tick.activities.ts`
- Tests: `automations.service.spec.ts`, `automations.controller.spec.ts`, `automation-webhook.service.spec.ts`, `scheduled-tick.activities.spec.ts`

**Interfaces:**
- Consumes: Task 4's `AutomationApprovalsService.findPendingForExecution`; shared DTOs from Task 1.
- Produces:
  - `TriggerExecutionOptions.triggerSource?: ExecutionTriggerSource`. Resolved as `options.testRun ? 'test' : options.sourceEventId ? 'event' : options.triggerSource ?? 'event'` and written when the row is created, in all three create sites.
  - `findExecutionsPage(tenantId, workflowId, q: { limit?: number; cursor?: string; status?: AutomationExecutionStatus }): Promise<AutomationExecutionPageDto>`:
    - `limit` defaults to 25, capped at 100
    - the cursor is the base64url of `"<startedAt ISO>|<id>"`; order by `startedAt DESC, id DESC`
    - selects summary columns only (no `nodeResults`, no `triggerPayload`)
  - `findExecutionById(tenantId, executionId, canViewData: boolean): Promise<AutomationExecutionDto>`:
    - reads the DB only; no Temporal
    - adds `pendingApprovals`
    - when `!canViewData`: `triggerPayload: {}`, each step without `input`/`output`, approvals' `details: {}`, and `dataHidden: true`
- Routes:
  - `GET /automations/:id/executions?limit&cursor&status` returns `AutomationExecutionPageDto`. This changes the response shape; the web is updated in Task 6.
  - `GET /automations/executions/:executionId` passes `user.permissions.includes(PERMISSIONS.AUTOMATION_UPDATE)`.
- **Start failures:** in `triggerExecution`, the branch that today logs and returns when `!failOnStartError` sets `status = 'FAILED'`, `errorMessage = "Couldn't start the run"` and `finishedAt`, saves, and returns. Keep the placeholder `temporalWorkflowId`, so an idempotent retry still resumes it; the existing resume path resets FAILED → RUNNING.
- **Callers:** the webhook service passes `triggerSource: 'webhook'`, and the scheduled tick passes `triggerSource: 'schedule'`.

- [ ] **Step 1: Write the failing tests:**
  - a row created by a webhook trigger has `triggerSource 'webhook'`; by a tick, `'schedule'`; by a test run, `'test'`; by `sourceEventId`, `'event'`;
  - paging returns 25 then the rest with a working cursor, and the status filter works;
  - the list items have no `nodeResults` key;
  - detail never calls the Temporal client (assert the mock is not called);
  - detail with `canViewData=false` strips the data and sets `dataHidden`;
  - a start failure without `failOnStartError` leaves the row `FAILED` with "Couldn't start the run";
  - controller: `findExecutionById` passes `true` for a user holding `automation:update` and `false` otherwise.
- [ ] **Step 2: Run** `pnpm --filter api test -- automations automation-webhook scheduled-tick`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Remove `getLiveExecutionState`/`withLiveExecutionState` if nothing else uses them; Task 4 has its own live check.
- [ ] **Step 4: Run** `pnpm --filter api test`. Expected: the full API suite PASSES.
- [ ] **Step 5: Commit**: `feat(automations): paged run list, database-only run detail, run sources`.

### Task 6: Web — Runs panel in the editor

**Files:**
- Modify: `apps/web/src/lib/api/endpoints/automations.ts` (+ `queryKeys`)
- Modify: `apps/web/src/hooks/use-automations.ts`
- Create: `apps/web/src/components/automations/runs/runs-drawer.tsx`
- Create: `apps/web/src/components/automations/runs/run-detail.tsx`
- Create: `apps/web/src/components/automations/runs/approval-decision.tsx`
- Create: `apps/web/src/components/automations/runs/runs.spec.tsx`
- Delete: `apps/web/src/components/automations/drawers/execution-trace-drawer.tsx` (unused; replaced by `run-detail.tsx`)
- Modify: `apps/web/src/components/automations/canvas/canvas-header.tsx` (Runs button next to Test run, `onOpenRuns` prop)
- Modify: `apps/web/src/app/(app)/automations/[id]/page.tsx`
- Modify: `apps/web/src/components/automations/drawers/test-run-drawer.tsx` only if it breaks on the new detail shape

**Interfaces:**
- Consumes: the Task 1 DTOs; the Task 4 and Task 5 routes.
- Produces:
  - api: `listExecutions(id, q?: { cursor?: string; status?: string })` → `AutomationExecutionPageDto`; `listApprovals()`; `countApprovals()`; `decideApproval(id, payload: ApprovalDecisionPayload)`
  - `queryKeys.automationApprovals = ['automations','approvals']` and `queryKeys.automationApprovalCount = ['automations','approvals','count']`
  - hooks:
    - `useAutomationExecutionsPage(workflowId, status)`: `useInfiniteQuery`; `refetchInterval` 5000 while any loaded item is RUNNING or WAITING_APPROVAL, else false
    - `useAutomationApprovals()`
    - `useAutomationApprovalCount()`: `refetchInterval` 60000
    - `useDecideApproval()`: on settle, invalidates approvals, the count, the execution, and that workflow's executions
  - `<ApprovalDecision approval={AutomationApprovalDto} onDecided?={() => void} />`:
    - one optional comment textarea (label "Comment", or "Reason" while Reject is focused or hovered; either is fine)
    - Approve and Reject buttons
    - on 409, shows "Already approved by {name}, {relative}" (or "Already rejected…", or "No longer pending") and calls `onDecided`
    - shown only when `can(AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE)`
  - `<RunsDrawer workflowId onClose />`: list plus status filter (All, Failed, Waiting for approval, Completed) and Load more. Clicking a run shows `<RunDetail executionId onBack />`.

**RunDetail content** (spec Part 2):
- header: status chip, source, started/finished time, error
- "What started this run": a collapsible JSON block of the trigger payload
- steps sorted by `startedAt`: label (fallback: type), type, status, duration, error, each expandable to Input/Output JSON
- `dataHidden` → "You can't see the data in this run." in place of the payload and step data
- no steps and status UNKNOWN → "Details weren't recorded for this run."
- each of `pendingApprovals` renders `<ApprovalDecision>`
- while RUNNING or WAITING_APPROVAL, the detail polls every 5000 ms

- [ ] **Step 1: Write the failing tests** (Vitest + Testing Library, mocking `apiFetch` as other automation specs do):
  - the list renders status and source labels and Load more fetches the next cursor;
  - the Failed filter sends `status=FAILED`;
  - detail orders steps by `startedAt` and shows an error;
  - `dataHidden` shows the copy and no JSON;
  - UNKNOWN with no steps shows its copy;
  - ApprovalDecision: Approve posts `{ action: 'APPROVE', comment }`; a 409 shows "Already approved by Ana";
  - ApprovalDecision is hidden without `automation:approve`;
  - the polling interval is 5000 while a run is RUNNING and false when everything is finished.
- [ ] **Step 2: Run** `pnpm --filter web test -- runs`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire the Runs button and drawer into the studio page as the Test run drawer is wired. Opening Runs closes Test run and vice versa.
- [ ] **Step 4: Run** `pnpm --filter web test -- automations runs` and `pnpm --filter web exec tsc --noEmit`. Expected: PASS, apart from the known `drawers.spec.tsx > surfaces an AI tool preview…` failure (unrelated, in FLAGS).
- [ ] **Step 5: Commit**: `feat(web): runs panel with step-by-step run detail`.

### Task 7: Web — Approvals inbox and nav badge

**Files:**
- Create: `apps/web/src/app/(app)/automations/approvals/page.tsx`
- Create: `apps/web/src/components/automations/approvals/approvals-inbox.tsx`
- Create: `apps/web/src/components/automations/approvals/approvals-inbox.spec.tsx`
- Modify: `apps/web/src/lib/nav.ts` (new item; `NavItem.badge?: 'automationApprovals'`)
- Modify: `apps/web/src/components/layout/app-shell.tsx` (badge render; active-match fix)
- Modify: `apps/web/src/app/(app)/automations/page.tsx` (link to Approvals in the header actions, shown with `automation:approve`)
- Test: the existing app-shell/nav spec, if present; otherwise add the cases to `approvals-inbox.spec.tsx`

**Interfaces:**
- Consumes: Task 6's hooks and `<ApprovalDecision>`.
- Produces: the nav item `{ href: '/automations/approvals', label: 'Approvals', icon: ShieldCheck (or another lucide icon already imported), rule: { permission: PERMISSIONS.AUTOMATION_APPROVE }, badge: 'automationApprovals' }`, placed right after Automations.
- The page is wrapped in `<PageGuard permission={PERMISSIONS.AUTOMATION_APPROVE} title="You can't approve automations">`.

**Inbox item content** (spec Part 3):
- the automation name linking to `/automations/<workflowId>`
- the kind: "Approval step" or "AI action"
- the title
- `triggerSummary`
- requested time (relative)
- the timeout line:
  - step: "Times out <relative> — takes the timeout path"
  - agent: "Times out <relative> — the action is dropped"
  - `expiresAt` null: "No timeout shown"
- the details: `details.message` for steps; `details.tool` plus the preview rendered as JSON or text for agent actions
- `<ApprovalDecision>`

Empty state: "Nothing is waiting for approval."

**Active-match fix in app-shell:** an item is active when the pathname equals its href or starts with `href + '/'`, and no other visible item has a longer href that also matches. Apply it to both the core grid and the secondary lists.

**Badge:** when `badge === 'automationApprovals'`, render the count from `useAutomationApprovalCount()`. The hook is enabled only when the user can approve. Show nothing at 0 and "99+" above 99.

- [ ] **Step 1: Write the failing tests:**
  - the inbox lists items oldest first with all the fields above;
  - the empty state copy;
  - after Approve, the item leaves the list;
  - a 409 shows the decider and the item leaves;
  - nav: on `/automations/approvals` only Approvals has `aria-current="page"`; on `/automations/abc` only Automations does;
  - the badge is hidden at 0, shows 3, and shows 99+ at 150;
  - the item is hidden without `automation:approve`.
- [ ] **Step 2: Run** `pnpm --filter web test -- approvals app-shell`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test` and `pnpm --filter web exec tsc --noEmit`. Expected: PASS, apart from the known failure.
- [ ] **Step 5: Commit**: `feat(web): approvals inbox with nav count`.

### Task 8: Approval step message field, card cleanup, FLAGS

**Files:**
- Modify: `apps/web/src/components/automations/drawers/node-inspector-drawer.tsx`
- Modify: `apps/web/src/components/automations/nodes/approval-node.tsx`
- Modify: `apps/web/src/hooks/use-automation-canvas.ts` (default config `{ message: '' }`; drop `approverRole`; keep `timeoutDuration: '3 days'` where it is today)
- Modify: `docs/FLAGS.md`
- Test: `apps/web/src/components/automations/drawers/drawers.spec.tsx` and the nodes spec, if one exists

**Interfaces:**
- Consumes: the workflow reads `config.message` (Task 3).
- Produces: the inspector field "Message for the approver":
  - a textarea with `data-testid="approval-message-input"`, stored at `node.data.config.message`
  - helper text: "Shown in the Approvals inbox. You can use {{ }} expressions, e.g. {{ $trigger.payload.name }}."
  - plugged into the existing expression helper the way other text fields use it, if that's a one-line reuse
- Also: the inspector's blurb says "awaiting a decision from anyone who can approve automations" in place of "manager decision". The canvas card drops the Approver row and shows the message (truncated to 2 lines) when set.

**FLAGS.md:**
- Replace "Automation executions stay RUNNING with empty node results — open" with "Runs stopped from outside the workflow stay Running — open": a terminated run, a timed-out run, or one stuck on a workflow-task error never records its end; no cleanup job yet.
- Add "Run contents are visible only to automation editors — by design".
- Add "A scheduled run waiting on approval holds later ticks — by design": decide it in the Approvals inbox.
- Add "Approvals can be decided by anyone with Approve automations — by design".

- [ ] **Step 1: Write the failing tests:** the inspector shows the message textarea for an approval node and typing updates `config.message`; the card no longer renders "Approver:"; it renders the message when set.
- [ ] **Step 2: Run** `pnpm --filter web test -- drawers nodes`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement**, and edit FLAGS.md.
- [ ] **Step 4: Run** `pnpm --filter web test -- automations` and `pnpm --filter web exec tsc --noEmit`. Expected: PASS, apart from the known failure.
- [ ] **Step 5: Commit**: `feat(web): approver message on approval steps; flags for run history`.
