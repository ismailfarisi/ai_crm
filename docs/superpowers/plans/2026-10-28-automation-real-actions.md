# Automations: Real Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the automation studio's Send email, AI prompt and Update CRM record steps act for real, as the automation's owner, safely, with two working templates.

**Architecture:** A DI-backed activity factory `createAutomationActions(deps)` replaces the three stub activities (same activity names, so the DAG workflow keeps calling them) and is wired into the Temporal worker like `createAgentReactActivities`. Every action resolves the workflow owner's access per run, runs inside the tenant context with an "automation" marker that stops events it causes from triggering automations, and is idempotent per `(executionId, nodeId)`.

**Tech Stack:** NestJS 11, TypeORM (migrations own the schema), Temporal TS SDK, Jest (api), Next.js 16 + Vitest (web), `@saas/shared` (compiled: rebuild with `pnpm --filter @saas/shared build` after editing).

**Spec:** `docs/superpowers/specs/2026-10-28-automation-real-actions-design.md`

## Global Constraints

- Permissions only from `packages/shared/src/rbac/permissions.ts` constants: `CONTACT_CREATE`, `CONTACT_UPDATE`, `QUOTE_APPROVE`, `AUTOMATION_EXECUTE`, `AI_MANAGE`. Never a string literal.
- Contacts go through `ContactsService.create/update` (which use `scoped()`); no repository writes.
- Max **10** recipients per Send email step.
- An automation never waives a margin floor.
- Changes made inside an automation action never trigger automations.
- A CRM-event automation with no event never matches.
- AI-written email to a customer is allowed only when the org's `automationAiEmailToCustomers` is true (default **false**).
- Owner-failure message: `"<owner email> can no longer <action>; reactivate the automation as someone who can"`; missing-permission message names the permission.
- AI-email refusal copy (exact): `Your admin hasn't allowed automations to email AI-written text to customers. Send it to your team, or ask an admin to turn this on in Settings → AI.`
- Owner warning copy (exact): `Saving makes you the owner: steps will run with your permissions`.
- Schema change = new migration; DB columns are quoted camelCase on automation tables (`"activatedByUserId"`); `pnpm migration:generate` must report no drift afterwards.
- Activity results must be JSON-safe (Temporal payloads, `ChannelIdempotencyService` storage).

## Review Focus

1. **Owner deleted or deactivated after activation** → step fails with the owner message, run status FAILED, nothing sent or written. Test in Task 4.
2. **Recipient list with blanks/duplicates/mixed case** (`"a@x.com, ,A@x.com"`) → de-duplicated case-insensitively, blanks dropped, before the 10-cap and email validation. Test in Task 6.
3. **Temporal retry after a partial email send** → recipients already sent are not sent again. Test in Task 6.
4. **Contact `fields` containing an unknown key or `ownerId` of another user** → unknown key fails the step; `ownerId` goes through the service's own rules (a rep can't assign others). Test in Task 8.
5. **Existing automations saved before this change** (CRM-event trigger with event only on the node, no `activatedByUserId`) → event synced into `triggerConfig` on next save; action steps fail with "reactivate" until then. Test in Task 2.

---

### Task 1: Engine plumbing — owner, action context, AI-written flag, Delay fix

**Files:**
- Modify: `apps/api/src/modules/automations/workflows/interfaces.ts` (DynamicWorkflowInput, activity config/result types)
- Create: `packages/shared/src/automations/ai-output.ts` (exported from the shared index; the web studio uses it too in Task 9)
- Modify: `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.ts:276-307`
- Test: `packages/shared/src/automations/ai-output.test.ts`, `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.spec.ts`

**Interfaces:**
- Produces:
  - `DynamicWorkflowInput` gains `ownerUserId?: string; workflowName?: string`.
  - `interface AutomationActionContext { tenantId: string; workflowId: string; workflowName: string; executionId: string; nodeId: string; ownerUserId?: string; aiWritten: boolean }`
  - `EmailActivityConfig = { to: string; subject: string; body: string }`; `EmailActivityResult = { sent: string[]; provider: string }`
  - `AiPromptActivityConfig = { prompt: string }`; `AiPromptActivityResult = { text: string; model: string; usage: { inputTokens: number; outputTokens: number } }`
  - `CrmMutationActivityConfig = { entity: 'contact' | 'quote'; action: 'create' | 'update' | 'approve' | 'reject'; recordId?: string; fields?: Record<string, unknown>; reason?: string }`; `CrmMutationActivityResult = { entity: string; action: string; recordId: string; record: Record<string, unknown> }`
  - `usesAiOutput(node: AutomationNode, nodes: AutomationNode[], edges: AutomationEdge[]): boolean` in `packages/shared/src/automations/ai-output.ts` (pure, no imports beyond types; runs in the workflow sandbox, so the Step 4 bundle check must pass).
  - Workflow calls `executeEmailActivity(config, ctx)`, `executeAiPromptActivity(config, ctx)`, `executeCrmMutationActivity(config, ctx)`.

- [ ] **Step 1: Write failing tests** in `ai-output.test.ts` (shared package's test runner, `pnpm --filter @saas/shared test`):
  - `usesAiOutput` true when `body` is `{{ $json.text }}` and the only incoming edge is from an `aiPromptNode`.
  - true when `subject` contains `$node["Draft reminder"].json.text` and a node labelled `Draft reminder` is an `aiAgentNode` (also with single quotes).
  - false when `$json` is used but the predecessor is a `transformNode`; false when `$node["X"]` names a non-AI node.
  
  In `dynamic-dag.workflow.spec.ts` (existing mocked-activity pattern):
  - `passes the action context to email, AI and CRM activities`: run with `ownerUserId: 'u-owner', workflowName: 'Overdue'` and expect `executeEmailActivity` called with `(expect.objectContaining({ to, subject, body }), expect.objectContaining({ ownerUserId: 'u-owner', nodeId: 'mail', executionId, workflowName: 'Overdue', aiWritten: true }))` for an email node downstream of an AI node.
  - `delay honours durationMs`: `delayNode` with `config: { durationMs: '2500' }` sleeps 2500 ms (time-skipping env: assert `nodeResults.delay.output.duration` equals `2500`).
- [ ] **Step 2: Run** `pnpm --filter @saas/shared test` and `cd apps/api && npx jest src/modules/automations/workflows` → new tests FAIL.
- [ ] **Step 3: Implement** the interfaces, `usesAiOutput`, and in the workflow build `ctx` per node (`aiWritten = usesAiOutput(node, input.nodes, input.edges)`, `workflowName = input.workflowName ?? ''`) and pass it as the second argument. Delay: `config.durationMs ?? config.duration ?? config.delay ?? '1s'`; a numeric string becomes a number of ms.
- [ ] **Step 4: Run** the same jest command → PASS. Also bundle check: `node -e` with `@temporalio/worker` `bundleWorkflowCode({ workflowsPath: 'src/modules/automations/workflows/dynamic-dag.workflow.ts' })` succeeds.
- [ ] **Step 5: Commit** `feat(automations): pass owner and step context to action activities`.

---

### Task 2: Ownership, trigger-event sync and save validation

**Files:**
- Modify: `apps/api/src/modules/automations/entities/automation-workflow.entity.ts`
- Create: `apps/api/src/database/migrations/1790600000000-AutomationWorkflowOwner.ts` (copy style of `1789700000000-AutomationExecutionSourceEvent.ts`; `ADD COLUMN IF NOT EXISTS "activatedByUserId" uuid NULL`, FK to `"users"("id") ON DELETE SET NULL`)
- Modify: `automations.service.ts` (`updateWorkflow`, `createWorkflow`, `triggerExecution`, `triggerForEvent`, `triggerWebhook`), `automations.controller.ts:115-127,143-160`
- Modify: `packages/shared/src/automations/types.ts` (`AutomationWorkflowDto.activatedByUserId?: string | null`)
- Test: `automations.service.spec.ts`, `automations.controller.spec.ts`

**Interfaces:**
- Consumes: `DynamicWorkflowInput.ownerUserId/workflowName` (Task 1).
- Produces:
  - `updateWorkflow(tenantId: string, id: string, payload: UpdateAutomationWorkflowPayload, actorUserId: string): Promise<AutomationWorkflow>`
  - `AutomationWorkflow.activatedByUserId: string | null`
  - `triggerExecution` puts `ownerUserId` = test-run user (controller) or `wf.activatedByUserId` (event/webhook paths), and `workflowName: wf.name`, into the workflow input.
  - `syncTriggerConfig(wf)`: for `triggerType === 'CRM_EVENT'`, `triggerConfig.event = <first crmEventTrigger node>.data.config.event` when present.

- [ ] **Step 1: Failing tests** (service spec):
  - `sets activatedByUserId when status changes to ACTIVE`.
  - `saving nodes on an ACTIVE workflow makes the saver the owner` (owner `u1`, save by `u2` with new `nodes` → `u2`).
  - `saving only name on an ACTIVE workflow keeps the owner`.
  - `copies the CRM trigger node's event into triggerConfig on save` (node config `{ event: 'invoice.overdue' }` → `triggerConfig.event === 'invoice.overdue'`; also on create).
  - `rejects activating a CRM_EVENT workflow without an event` → `BadRequestException` with message `Choose the CRM event that starts this automation`.
  - `test run passes the clicking user as owner`; `event-triggered run passes activatedByUserId as owner`.
  - Controller spec: PATCH passes `user.id` as the 4th argument.
- [ ] **Step 2: Run** `npx jest src/modules/automations/automations` → FAIL.
- [ ] **Step 3: Implement.** Graph-changing = payload has `nodes`, `edges` or `triggerConfig`. Validation runs when the resulting status is ACTIVE.
- [ ] **Step 4: Run** tests → PASS; `pnpm migration:run` then `pnpm migration:generate Check` reports no changes (delete any generated file); `pnpm check:drift` passes.
- [ ] **Step 5: Commit** `feat(automations): record the owner and sync the CRM trigger event`.

---

### Task 3: Loop guard and strict event matching

**Files:**
- Modify: `apps/api/src/common/context/tenant-context.service.ts` (+ ClsStore augmentation, lines 12-17)
- Modify: `apps/api/src/common/events/crm-event-bus.service.ts:196`
- Modify: `packages/shared/src/automations/types.ts` (`CrmDomainEvent.causedByAutomation?: boolean`)
- Modify: `apps/api/src/modules/automations/services/automation-event-bridge.service.ts` (`matchesEvent`, `handleDomainEvent`, `handleCrmEvent`)
- Test: `tenant-context.service.spec.ts` (create if absent), `crm-event-bus.service.spec.ts`, `automation-event-bridge.service.spec.ts`

**Interfaces:**
- Produces:
  - `TenantContextService.runAsAutomation<T>(tenantId: string, executionId: string, fn: () => Promise<T>): Promise<T>` (tenant set, `isSystem: false`, CLS key `automationExecutionId`)
  - `TenantContextService.getAutomationExecutionId(): string | null`
  - `CrmEventBusService.publish` stamps `causedByAutomation: true` on the event when `getAutomationExecutionId()` is set (inject `TenantContextService`).

- [ ] **Step 1: Failing tests:**
  - bus: `stamps causedByAutomation when published inside runAsAutomation`; not stamped outside.
  - bridge: `skips domain events caused by an automation` (no `triggerExecution` call); `handleCrmEvent inside runAsAutomation starts no runs`.
  - bridge: `a workflow with no configured event matches nothing` (both `handleDomainEvent` and `handleCrmEvent`; previously matched all); `'*' still matches everything` is **removed** behaviour → assert `'*'` matches nothing too.
  - existing tests that relied on empty-matches-all are updated to configure an event.
- [ ] **Step 2: Run** `npx jest src/common src/modules/automations/services` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix(automations): automation-caused events start no runs; empty triggers match nothing`.

---

### Task 4: Action runtime — owner resolution and worker wiring

**Files:**
- Create: `apps/api/src/modules/automations/workflows/automation-actions.ts`
- Modify: `apps/api/src/modules/automations/workflows/automation.activities.ts` (delete the three stubs and their spec cases)
- Modify: `apps/api/src/temporal-worker.ts:51-88`
- Test: `apps/api/src/modules/automations/workflows/automation-actions.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AutomationActionDeps {
    mail: Pick<MailService, 'sendMail' | 'name'>;   // add `name` getter to MailService if missing
    ai: Pick<AiService, 'generateText' | 'isConfigured' | 'getBudgetStatus'>;
    contacts: Pick<ContactsService, 'create' | 'update'>;
    quotes: Pick<QuotesService, 'sendSignal'>;
    users: Pick<UsersService, 'findMember' | 'findActiveEmails'>;
    rbac: Pick<RbacService, 'resolveAccess'>;
    audit: Pick<AuditService, 'record'>;
    tenantContext: Pick<TenantContextService, 'runAsAutomation'>;
    idempotency: Pick<ChannelIdempotencyService, 'runOnce'>;
  }
  export function createAutomationActions(deps: AutomationActionDeps): {
    executeEmailActivity(config: EmailActivityConfig, ctx: AutomationActionContext): Promise<EmailActivityResult>;
    executeAiPromptActivity(config: AiPromptActivityConfig, ctx: AutomationActionContext): Promise<AiPromptActivityResult>;
    executeCrmMutationActivity(config: CrmMutationActivityConfig, ctx: AutomationActionContext): Promise<CrmMutationActivityResult>;
  };
  // internal, exported for tests:
  export async function resolveOwner(deps, ctx, actionLabel: string): Promise<AuthenticatedUser>;
  ```
  - `UsersService.findActiveEmails(organizationId: string): Promise<string[]>` (new; lower-cased emails of `isActive` users in the org).
  - Every action body runs in `deps.tenantContext.runAsAutomation(ctx.tenantId, ctx.executionId, …)`.
  - `resolveOwner`: no `ownerUserId` → throw `ApplicationFailure.nonRetryable` with `This automation has no owner; reactivate it to run <actionLabel>`; owner missing or `!isActive` or lacking `AUTOMATION_EXECUTE` → non-retryable `"<email> can no longer <actionLabel>; reactivate the automation as someone who can"`. Builds `AuthenticatedUser` exactly as `jwt.strategy.ts:68-82`.
  - Worker: `activities: { ...automationActivities, ...createAutomationActions({...appContext.get(...)}), ...agentReactActivities }`.

- [ ] **Step 1: Failing tests** for `resolveOwner`: no owner; deactivated owner; owner without `automation:execute`; happy path returns `AuthenticatedUser` with resolved permissions. Errors are non-retryable `ApplicationFailure`.
- [ ] **Step 2: Run** `npx jest src/modules/automations/workflows/automation-actions.spec.ts` → FAIL.
- [ ] **Step 3: Implement** `resolveOwner`, the factory skeleton (actions may throw `not implemented` until Tasks 6-8), `findActiveEmails`, worker wiring; remove stubs.
- [ ] **Step 4: Run** tests → PASS; `npx nest build` succeeds.
- [ ] **Step 5: Commit** `feat(automations): DI action runtime that acts as the automation owner`.

---

### Task 5: Organisation setting — AI-written email to customers

**Files:**
- Modify: `apps/api/src/modules/ai/entities/ai-budget.entity.ts` (+ `automationAiEmailToCustomers: boolean`, default false)
- Create: `apps/api/src/database/migrations/1790600000001-AiBudgetAutomationEmail.ts`
- Modify: `ai.service.ts` (`upsertBudget`, `getBudgetStatus`), `ai/dto/*` (`UpsertAiBudgetDto.automationAiEmailToCustomers?: boolean`, status DTO field), shared AI budget types if the DTO lives in `packages/shared`
- Modify: `automations.controller.ts` (+ `GET /automations/settings` → `{ aiEmailToCustomers: boolean }`, `AUTOMATION_READ`)
- Modify: `apps/web/src/components/settings/ai-budget-view.tsx` (checkbox like lines 169-180), `apps/web/src/lib/api/endpoints/automations.ts`, `apps/web/src/hooks/use-automations.ts` (+ `useAutomationSettings()`)
- Test: `ai.service.spec.ts`, `automations.controller.spec.ts`, `ai-budget-view.spec.tsx` (create if absent)

**Interfaces:**
- Produces: `AiService.getBudgetStatus(orgId)` result includes `automationAiEmailToCustomers: boolean` (false when no budget row); `useAutomationSettings(): { data?: { aiEmailToCustomers: boolean } }`.

- [ ] **Step 1: Failing tests:** upsert persists the flag; status defaults to false with no row; `GET /automations/settings` returns it and requires `AUTOMATION_READ`; the AI budget view renders checkbox labelled `Allow automations to email AI-written text to customers` and saves it.
- [ ] **Step 2: Run** api jest for those specs and `cd apps/web && npx vitest run src/components/settings` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; migration drift check as in Task 2.
- [ ] **Step 5: Commit** `feat(ai): admin setting for AI-written automation email to customers`.

---

### Task 6: Send email action

**Files:**
- Modify: `apps/api/src/modules/automations/workflows/automation-actions.ts`
- Test: `automation-actions.spec.ts`

**Interfaces:**
- Consumes: `resolveOwner` (Task 4), `getBudgetStatus().automationAiEmailToCustomers` (Task 5), `findActiveEmails` (Task 4).

- [ ] **Step 1: Failing tests:**
  - `sends one mail per recipient with text body and escaped html` (`body: 'Hi <b>\nThere'` → `text` unchanged, `html` = `Hi &lt;b&gt;<br>There`).
  - `normalises recipients`: `"a@x.com, ,A@x.com"` → one send to `a@x.com`.
  - `fails before sending when more than 10 recipients` (message contains `10`); `fails before sending on an invalid address`.
  - `does not resend recipients already sent on retry`: `runOnce` keyed `automation:<executionId>:<nodeId>:mail:<address>`; second invocation with the same ctx sends nothing new.
  - `refuses AI-written email to a customer when the setting is off` (exact Global Constraints copy, non-retryable, nothing sent); `sends AI-written email to a team member with the setting off`; `sends AI-written email to a customer with the setting on`.
  - returns `{ sent: ['a@x.com'], provider: 'console' }`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (validation with `z.string().email()` from zod).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(automations): send email step delivers through MailService`.

---

### Task 7: AI prompt action

**Files:** `automation-actions.ts`, `automation-actions.spec.ts`

- [ ] **Step 1: Failing tests:**
  - `calls generateText as the owner`: `ai.generateText('automation.prompt', { messages: [{ role: 'user', content: prompt }] }, { organizationId, userId: owner.id })`, returns `{ text, model, usage: { inputTokens, outputTokens } }`.
  - `fails clearly when AI is not configured` (`isConfigured` false → non-retryable `AI isn't set up for this organisation. Add a provider in Settings → AI.`).
  - `surfaces budget exhaustion as a non-retryable failure` (whatever exception `generateText` throws for budget → message preserved).
  - `empty prompt fails` (`The AI prompt is empty`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(automations): AI prompt step uses the organisation's AI provider`.

---

### Task 8: Update CRM record action, automated quote approval, audit

**Files:**
- Modify: `automation-actions.ts`, `automation-actions.spec.ts`
- Modify: `apps/api/src/modules/quotes/quotes.service.ts:117-142,478-620` (+ `options?: { automated?: boolean }` on `sendSignal`, threaded to `assertActorMayApprove`)
- Test: `quotes.service.spec.ts`

**Interfaces:**
- Produces: `sendSignal(tenantId, quoteId, action, payload?, actorUserId?, options?: { automated?: boolean })`; with `automated: true`, `assertActorMayApprove` uses `[]` permissions (bot path) while `actorUserId` is still recorded.
- Step → permission map (constants): contact create → `CONTACT_CREATE`; contact update → `CONTACT_UPDATE`; quote approve/reject → `QUOTE_APPROVE`.

- [ ] **Step 1: Failing tests:**
  - quotes spec: `automated approval refuses a below-floor quote even when the actor may approve below margin`; existing non-automated behaviour unchanged.
  - actions spec:
    - `creates a contact via ContactsService.create(owner, parsed)`; `updates a contact via update(owner, recordId, parsed)`; input parsed with `createContactSchema` / `updateContactSchema` (`.strict()` applied in the action) — `unknown field "deal" fails the step`.
    - `rep cannot update another rep's contact` (service throws NotFound from `scoped()` → step fails with that message).
    - `missing permission fails with the permission name` (e.g. owner lacks `contact:update` → message contains `contact:update`), service not called.
    - `approves a quote as automated` → `sendSignal(tenant, id, 'APPROVE', undefined, owner.id, { automated: true })`; `rejects with reason` → payload `{ reason }`.
    - `missing recordId for update/approve/reject fails`; `unsupported entity/action pair fails`.
    - `writes one audit row`: `{ action: 'automation.contact.update', subjectType: 'contact', subjectId, actorId: owner.id, origin: 'HUMAN', channel: 'SYSTEM', messageId: 'automation:<executionId>:<nodeId>', summary: 'Automation "<workflowName>" updated contact …', before, after }` — skip the audit write if the service path already audits (verify `ContactsService`/`QuotesService` don't call `AuditService.record` themselves; if one does, assert no second row).
    - `runs once per (executionId, nodeId)` via `runOnce`.
- [ ] **Step 2: Run** `npx jest src/modules/automations/workflows/automation-actions.spec.ts src/modules/quotes/quotes.service.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(automations): CRM step updates contacts and approves quotes as the owner`.

---

### Task 9: Studio — real fields, event list, hints, owner warning

**Files:**
- Modify: `apps/web/src/components/automations/drawers/node-inspector-drawer.tsx` (CRM section 386-416, CRM trigger options ~450-460, email section 327-363)
- Modify: `apps/web/src/components/automations/canvas/canvas-header.tsx`
- Modify: `apps/web/src/app/(app)/automations/[id]/page.tsx` (pass `allNodes`/`edges` + settings to inspector; pass owner info to header)
- Test: `drawers.spec.tsx`, `canvas.spec.tsx`

**Interfaces:**
- Consumes: `useAutomationSettings()` (Task 5), `usesAiOutput` from `@saas/shared` (Task 1).

- [ ] **Step 1: Failing tests:**
  - CRM step: entity select has exactly `Contact`, `Quote`; actions are `Create`/`Update` for Contact and `Approve`/`Reject` for Quote; `Record ID` input shown for update/approve/reject; key/value field rows for contact create/update writing `config.fields`; `Reason` input for reject.
  - CRM trigger event select offers exactly the emitted events: `contact.created` (Contact created), `contact.updated`, `quote.created`, `quote.updated`, `quote.accepted` (Customer accepted a quote), `invoice.issued`, `invoice.overdue`, plus the orders event emitted at `apps/api/src/modules/orders/orders.service.ts:152` (read its `eventType`). No default value: unset shows `Choose an event`.
  - Email step downstream of an AI step shows `Uses AI-written text — only your team can receive it` when the setting is false, and `Uses AI-written text — can be sent to customers` when true.
  - Header shows the exact owner-warning copy when the workflow is ACTIVE and `isDirty`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/components/automations` → new tests FAIL (the pre-existing `surfaces an AI tool preview` failure is known and out of scope).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → new tests PASS; `npx tsc --noEmit -p .` clean for touched files.
- [ ] **Step 5: Commit** `feat(web): CRM, email and trigger fields that match what the engine runs`.

---

### Task 10: Templates

**Files:**
- Create: `apps/web/src/components/automations/templates.ts` (`AUTOMATION_TEMPLATES` and `buildTemplateGraph(id, { aiEmailToCustomers })`)
- Modify: `apps/web/src/app/(app)/automations/page.tsx:35-121` (cards from `AUTOMATION_TEMPLATES`; create with full `nodes`, `edges`, `triggerConfig`)
- Test: `apps/web/src/components/automations/templates.spec.ts`

**Interfaces:**
- Produces: `buildTemplateGraph(id: 'quote-accepted-notify' | 'invoice-overdue-reminder', opts: { aiEmailToCustomers: boolean }): CreateAutomationWorkflowPayload`.
- Templates (copy is the builder's; graph is fixed):
  1. `quote-accepted-notify`: `crmEventTrigger` (`event: 'quote.accepted'`) → `sendEmailNode` (`to: 'team@yourcompany.com'`, subject uses `{{ $trigger.payload.quoteNumber }}`, body uses `acceptedByName`, `customerEmail`, `totalAmount`).
  2. `invoice-overdue-reminder`: `crmEventTrigger` (`event: 'invoice.overdue'`) → `aiPromptNode` (prompt uses `invoiceNumber`, `amount`, `paidAmount`, `dueDate`) → `sendEmailNode` with `body: '{{ $json.text }}'`; `to` = `'{{ $trigger.payload.customerEmail }}'` when `aiEmailToCustomers`, else `'team@yourcompany.com'` with the body prefixed `Draft for {{ $trigger.payload.customerEmail }}:\n\n`.
  Card text says which recipient the overdue template will use.

- [ ] **Step 1: Failing tests:** each template passes `validateWorkflowGraph`; its `triggerConfig.event` equals its trigger node's event; every `$trigger.payload.<key>` referenced in any `{{ }}` (extract with `/\$trigger\.payload\.(\w+)/g`) is a key emitted by that event — quote.accepted: `quoteId, quoteNumber, customerId, customerEmail, acceptedByName, totalAmount`; invoice.overdue: `invoiceId, invoiceNumber, customerId, customerEmail, amount, paidAmount, dueDate`; the only other reference allowed is `$json.text`, and only in a step whose predecessor is the `aiPromptNode`; recipient switches with `aiEmailToCustomers`.
- [ ] **Step 2: Run** `npx vitest run src/components/automations/templates.spec.ts` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): two working automation templates`.

---

### Task 11: Full verification, merge and deploy

- [ ] **Step 1:** `pnpm --filter @saas/shared build`; `cd apps/api && npx jest --maxWorkers=2` → all pass; `cd apps/web && npx vitest run` → only the known `surfaces an AI tool preview` failure; `npx nest build`; `pnpm check:drift` passes.
- [ ] **Step 2:** Local end to end (API :4100, compiled worker, web :3200): create the overdue template, activate, test-run with the sample invoice payload → run COMPLETED, AI text present (or clean "AI isn't set up" failure if no provider locally), email logged by the console provider to the team address; a CRM step updating a contact changes it in the DB and writes one audit row; no second run is started by that update.
- [ ] **Step 3:** Merge `feat/automation-real-actions` into `master` (fast-forward), push, watch `CI` and `Deploy (EC2)` to success.
- [ ] **Step 4:** On switeaz.com as the seeded admin (password in the scratchpad file): repeat Step 2's overdue run; confirm the email appears in the worker/api logs (`MAIL_PROVIDER=console`). Delete test automations afterwards.
- [ ] **Step 5:** Update `docs/FLAGS.md` with: no automation chaining (by design, this round); automation AI agent step still acts as the triggering user (open); execution rows still stay RUNNING (open, run-history round).
