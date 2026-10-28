# Automations: Webhook and Schedule Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Webhook and schedule automations start real runs, as the owner, safely, for any HTTP sender and for hourly-or-coarser schedules.

**Architecture:** Webhooks: a public route resolves a long secret token under the system DB context, checks state/billing/signature/rate limit, then starts the run through `AutomationsService` with failures surfaced (503). Schedules: one Temporal Schedule per ACTIVE schedule automation, whose action starts a tiny tick workflow that calls an activity, which re-checks state/billing and starts the run through `AutomationsService` keyed by the tick time. A boot reconciler keeps Temporal in step with the database.

**Tech Stack:** NestJS 11, TypeORM, Temporal TS SDK 1.22 (`client.schedule`), ioredis, Jest; Next.js 16 + Vitest; `@saas/shared` (compiled: `corepack pnpm --filter @saas/shared build` after edits).

**Spec:** `docs/superpowers/specs/2026-10-29-automation-webhooks-schedules-design.md`

## Global Constraints

- Webhook token: 32 random bytes, base64url, 43 chars; shape `^[A-Za-z0-9_-]{43}$`; stored in `webhookSlug`.
- Every webhook refusal before the signature check (bad shape, unknown, not ACTIVE, not WEBHOOK, billing-restricted) returns the same `404 { "message": "Not found" }`.
- Signature header `X-Kerf-Signature: sha256=<hex HMAC-SHA256(secret, rawBody)>`, compared with `crypto.timingSafeEqual`; wrong/missing when required → 401.
- Webhook rate limit **60 per minute per token** → 429. Body limit **100 KB** → 413. Content types `application/json`, `application/x-www-form-urlencoded`; others → 415.
- `Idempotency-Key` ≤ 200 chars, remembered **24 hours** per automation.
- Responses: JSON → `202 { "accepted": true }`; form → `303` to `triggerConfig.redirectUrl` if set (https only, validated on save), else `202` text/plain `Thanks, received.`; run could not start → `503`.
- `$trigger` for webhooks: `{ payload, receivedAt, contentType: 'json' | 'form' }`; for schedules: `{ scheduledAt, timezone }`. No request headers exposed.
- Webhook route CORS: any origin, POST + OPTIONS, no credentials. All other routes unchanged.
- Schedule shape `{ frequency: 'hourly'|'daily'|'weekly'|'monthly'; minute?; time?: 'HH:MM'; daysOfWeek?: number[] (1=Mon…7=Sun, 1-7 entries); dayOfMonth?: 1-28; timezone: IANA, default 'Asia/Dubai' }`.
- Temporal schedule id `automation-schedule-<workflowId>`; overlap SKIP; catch-up window 1 hour; one tick → at most one run.
- Billing-restricted tenants: webhook 404 and no run; schedule tick starts no run; schedules not deleted.
- `webhookSlug` and `triggerConfig.signatureSecret` are returned only to users with `automation:update`, on `GET /automations` and `GET /automations/:id`.
- AI agent step uses `ownerUserId` when there is no `actorUserId`; it no longer reads `triggerPayload.event?.actorUserId` for webhook runs.
- Copy (exact): `Choose when this automation runs`; read-only URL placeholder `Hidden — ask someone who can edit this automation`; not-active hint `Switch the automation on to start receiving`.
- Permissions only via `packages/shared/src/rbac/permissions.ts` constants. Schema changes only via migrations (none expected here: everything lives in existing columns).

## Review Focus

1. **Webhook body that is a JSON array or scalar** (`[1,2]`, `"x"`) → accepted, stored as `payload` as-is; steps referencing `$trigger.payload.x` see undefined. Test in Task 3.
2. **Same Idempotency-Key reused on a different automation** → independent; keys are scoped per automation. Test in Task 3.
3. **Schedule saved while the automation is ACTIVE but Temporal is down** → save fails with a clear message and the stored schedule is unchanged. Test in Task 5.
4. **A tick arriving after the automation was deleted or its trigger changed** → no run, no error loop (activity returns quietly). Test in Task 5.
5. **Time zone with a DST transition** (e.g. `Europe/London`, daily 01:30 across the October change) → `nextScheduleRuns` neither skips nor duplicates a day. Test in Task 1.

---

### Task 1: Shared schedule model

**Files:**
- Create: `packages/shared/src/automations/schedule.ts` (+ export from the shared index)
- Test: `packages/shared/src/automations/schedule.test.ts`

**Interfaces:**
- Produces:
  - `type AutomationSchedule` (shape in Global Constraints) and `automationScheduleSchema` (zod; `minute` 0-59 required for hourly; `time` `^([01]\d|2[0-3]):[0-5]\d$` required for daily/weekly/monthly; `daysOfWeek` required for weekly, unique, 1-7; `dayOfMonth` 1-28 required for monthly; `timezone` must be accepted by `Intl.DateTimeFormat`; default `'Asia/Dubai'`).
  - `describeSchedule(s: AutomationSchedule): string` — e.g. `Every hour at :15`, `Every day at 09:00`, `Weekdays at 09:00` (exactly Mon-Fri), `Every Mon, Wed at 09:00`, `Monthly on day 1 at 09:00`, followed by ` (Gulf time)` for `Asia/Dubai`, otherwise ` (<timezone>)`.
  - `nextScheduleRuns(s: AutomationSchedule, from: Date, count: number): Date[]` — pure, `Intl`-only: step candidate instants every 15 minutes from `from` (exclusive) for up to 32 days, convert each to wall-clock parts in `s.timezone` with `Intl.DateTimeFormat#formatToParts`, keep matches, stop at `count`.

- [ ] **Step 1: Failing tests:** schema accepts one valid example per frequency and rejects `minute: 60`, `dayOfMonth: 29`, `daysOfWeek: []`, `daysOfWeek: [8]`, `time: '24:00'`, `timezone: 'Mars/Base'`; `describeSchedule` returns the exact strings above for those examples; `nextScheduleRuns` for daily 09:00 Asia/Dubai from `2026-10-29T06:00:00Z` → `[2026-10-30T05:00Z, 2026-10-31T05:00Z, 2026-11-01T05:00Z]`; hourly `:15` from `2026-10-29T06:20Z` → `07:15Z, 08:15Z, 09:15Z`; weekdays 09:00 Dubai from Friday `2026-10-30T06:00Z` → Mon, Tue, Wed; monthly day 1 09:00 Dubai from `2026-10-29` → `2026-11-01T05:00Z, 2026-12-01T05:00Z` (count 2); Review Focus 5 (Europe/London daily 01:30 over 2026-10-25) → one run per day.
- [ ] **Step 2: Run** `corepack pnpm --filter @saas/shared test` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `corepack pnpm --filter @saas/shared build`.
- [ ] **Step 5: Commit** `feat(shared): schedule model for automation triggers`.

---

### Task 2: Trigger config on save, secrets hidden from read-only users

**Files:**
- Modify: `apps/api/src/modules/automations/automations.service.ts` (`createWorkflow`, `updateWorkflow`, `generateWebhookSlug`), `automations.controller.ts` (GET list/one, new regenerate route), `packages/shared/src/automations/types.ts` (trigger config types)
- Test: `automations.service.spec.ts`, `automations.controller.spec.ts`

**Interfaces:**
- Produces:
  - `generateWebhookToken(): string` (32 bytes base64url). Old-format slugs are replaced on the next save of a WEBHOOK workflow.
  - `regenerateWebhookToken(tenantId, id, actorUserId): Promise<AutomationWorkflow>` — `POST /automations/:id/webhook/regenerate`, `AUTOMATION_UPDATE`; 400 if not WEBHOOK.
  - Save validation: SCHEDULE trigger + status ACTIVE requires a valid `triggerConfig.schedule` (`automationScheduleSchema`) else `BadRequestException('Choose when this automation runs')`; a present schedule is always validated. WEBHOOK `triggerConfig.redirectUrl` must be `https://` URL. `triggerConfig.requireSignature: true` generates `signatureSecret` when absent; `regenerateSignature` flag on update rotates it; `requireSignature: false` deletes it.
  - Saving or regenerating counts as a graph change for ownership only when it changes `triggerConfig` (existing rule).
  - `redactForReader(wf, permissions)`: when the user lacks `AUTOMATION_UPDATE`, `webhookSlug = null` and `triggerConfig.signatureSecret` removed; applied in GET list and GET one.
  - Shared types: `WebhookTriggerConfig = { requireSignature?: boolean; signatureSecret?: string; redirectUrl?: string }`, `ScheduleTriggerConfig = { schedule?: AutomationSchedule }`.

- [ ] **Step 1: Failing tests:** token shape; old slug replaced on save; regenerate changes token and requires WEBHOOK; ACTIVE SCHEDULE without schedule → exact copy; invalid schedule → 400 with zod message; http redirect → 400; requireSignature creates a 43-char secret, false removes it, regenerateSignature rotates; reader without `automation:update` sees `webhookSlug: null` and no `signatureSecret` on list and one; editor sees both.
- [ ] **Step 2: Run** `cd apps/api && npx jest src/modules/automations/automations` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(automations): webhook tokens, signature secrets and schedule validation on save`.

---

### Task 3: Public webhook endpoint

**Files:**
- Create: `apps/api/src/modules/automations/webhooks/automation-webhook.controller.ts`, `automation-webhook.service.ts` (+ specs)
- Modify: `automations.controller.ts` (remove the old `POST webhook/:slug` and `triggerWebhook` path), `automations.service.ts` (`triggerExecution` option `failOnStartError?: boolean` that rethrows a Temporal start failure and marks the row FAILED; `TriggerExecutionOptions.idempotencyKey?: string`), `automations.module.ts` (import `BillingModule`; Redis client), `apps/api/src/main.ts` only if needed for body limits/CORS on this route
- Test: `automation-webhook.service.spec.ts`, `automation-webhook.controller.spec.ts` (supertest against a Nest app with the controller is preferred)

**Interfaces:**
- Consumes: Task 2 config/token shapes; `BillingService.restrictionFor(tenantId)` → `{ restricted: boolean, … }`; `TenantContextService.runAsSystem`, `runWithTenant`.
- Produces: `AutomationWebhookService.receive(token: string, req: { contentType: string; rawBody: Buffer; body: unknown; signature?: string; idempotencyKey?: string }): Promise<{ kind: 'accepted' } | { kind: 'redirect'; url: string }>`; throws `NotFoundException('Not found')`, `UnauthorizedException`, `HttpException(429)`, `UnsupportedMediaTypeException`, `PayloadTooLargeException`, `ServiceUnavailableException`.
- Rate limiter: Redis `INCR` + `EXPIRE 60` on key `automation:webhook:rl:<token>` using the existing ioredis client (`REDIS_CLIENT_TOKEN` from `AiModule`; export it if not exported). If Redis is unavailable, allow the request and log a warning (fail open, matching the AI budget guard's behaviour — verify and match).
- Idempotency: execution looked up by `(workflowId, idempotencyKey)` within 24 h — store the key in `automation_executions.triggerPayload`-independent form: builder may add a nullable indexed column via migration `1790700000000-AutomationExecutionIdempotencyKey` or reuse `ChannelIdempotencyService.runOnce(tenantId, 'automation:webhook:<workflowId>:<key>', …)` with a 24 h lease; record the choice in the report.

- [ ] **Step 1: Failing tests** (one per Global Constraints line and Review Focus 1-2): bad shape → 404 with zero repository calls; unknown / DRAFT / PAUSED / non-WEBHOOK / billing-restricted → identical 404; ACTIVE JSON → 202 `{accepted:true}`, `triggerExecution` called with `$trigger = { payload, receivedAt, contentType:'json' }`, owner `activatedByUserId`, inside the workflow's tenant; form body → payload of strings, 303 to redirectUrl, or 202 `Thanks, received.`; array/scalar JSON accepted as payload; text/plain → 415; 100 KB + 1 byte → 413; signature required: missing → 401, wrong → 401, right → 202; 61st request in 60 s → 429; same Idempotency-Key twice → one `triggerExecution`; same key on two automations → two; Temporal start failure → 503 and the second request with the same key retries the same execution; CORS: OPTIONS preflight from `https://example.com` → allowed with `Access-Control-Allow-Origin: *`, no credentials header; a different API route still refuses that origin; a body `{"event":{"actorUserId":"x"}}` does not change the owner/actor.
- [ ] **Step 2: Run** `cd apps/api && npx jest src/modules/automations` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx nest build`.
- [ ] **Step 5: Commit** `feat(automations): public webhook endpoint that starts runs as the owner`.

---

### Task 4: AI agent step acts as the owner when nobody triggered the run

**Files:**
- Modify: `apps/api/src/modules/automations/workflows/dynamic-dag.workflow.ts:~467`
- Test: `dynamic-dag.workflow.spec.ts`

- [ ] **Step 1: Failing tests:** agent child workflow gets `userId: input.actorUserId` when set (CRM-event run unchanged); `userId: input.ownerUserId` when `actorUserId` is absent; a webhook-shaped `triggerPayload` containing `event.actorUserId` does not set `userId`.
- [ ] **Step 2: Run** `npx jest src/modules/automations/workflows/dynamic-dag.workflow.spec.ts` → FAIL. **Step 3: Implement** (`input.actorUserId ?? input.ownerUserId ?? ''`; drop the `triggerPayload.event?.actorUserId` fallback — the event bridge already passes `actorUserId` for CRM-event runs; verify and say so in the report). **Step 4: Run** → PASS; Temporal bundle check (command in env notes) still ~1.8 MB.
- [ ] **Step 5: Commit** `fix(automations): agent steps act as the owner when no one triggered the run`.

---

### Task 5: Temporal schedules — lifecycle, tick, reconciliation

**Files:**
- Create: `apps/api/src/modules/automations/schedules/automation-schedules.service.ts` (+ spec), `apps/api/src/modules/automations/workflows/scheduled-tick.workflow.ts`, `apps/api/src/modules/automations/workflows/scheduled-tick.activities.ts` (+ spec)
- Modify: `automations.service.ts` (call the schedules service from create/update/delete), `automations.module.ts`, `apps/api/src/temporal-worker.ts` (register the tick workflow on `automations-queue`: the worker's `workflowsPath` for that queue must export both workflows — add a `workflows/index.ts`-style entry that re-exports `dynamicDagWorkflow` and `scheduledTickWorkflow`, and keep the bundle check passing)

**Interfaces:**
- Consumes: Task 1 `AutomationSchedule`; `AutomationsService.triggerExecution(..., { failOnStartError: true, idempotencyKey })` (Task 3).
- Produces:
  - `AutomationSchedulesService.sync(wf: AutomationWorkflow): Promise<void>` — ACTIVE + SCHEDULE + valid schedule → create or update `automation-schedule-<id>`; otherwise delete if present (not-found ignored). Called by `AutomationsService` after a successful validation and before committing the save; a Temporal error aborts the save with `ServiceUnavailableException('Couldn't update the automation's schedule. Try again in a minute.')` and the stored row is unchanged.
  - `toScheduleSpec(s: AutomationSchedule): ScheduleSpec` — `calendars: [{ minute, hour, dayOfWeek | dayOfMonth }]` (Temporal `dayOfWeek` names/indices — check the SDK type; Sunday mapping must be correct), `timezone: s.timezone`.
  - Schedule options: `action: { type: 'startWorkflow', workflowType: scheduledTickWorkflow, taskQueue: 'automations-queue', args: [{ tenantId, workflowId }] }`, `policies: { overlap: ScheduleOverlapPolicy.SKIP, catchupWindow: '1 hour' }`.
  - `scheduledTickWorkflow({ tenantId, workflowId })` — reads the scheduled time from `workflowInfo()` search attribute `TemporalScheduledStartTime` (or `startTime` fallback), calls activity `startScheduledRunActivity({ tenantId, workflowId, scheduledAt })`.
  - `startScheduledRunActivity` (DI factory like `createAutomationActions`): system lookup of the workflow; missing / not ACTIVE / not SCHEDULE / billing-restricted → return `{ started: false, reason }` (no throw); else `triggerExecution(tenantId, id, { scheduledAt, timezone }, undefined, { failOnStartError: true, idempotencyKey: 'schedule:' + scheduledAt })` inside `runWithTenant`; Temporal start failure throws (retried).
  - `AutomationSchedulesService.reconcile()` on `onApplicationBootstrap` in the API process only: list ACTIVE SCHEDULE workflows (system context) → `sync` each (skip + warn when the schedule is invalid); list Temporal schedules with id prefix `automation-schedule-` → delete those whose automation is gone or not ACTIVE SCHEDULE. Failures log and never block boot.

- [ ] **Step 1: Failing tests:** `toScheduleSpec` for each frequency incl. Sunday and multiple weekdays; `sync` create/update/delete matrix (activate, edit schedule while active, pause, draft, trigger type change, delete) with a mocked `client.schedule`; Temporal error → save rejected, row unchanged (Review Focus 3); tick activity: inactive/deleted/type-changed/billing-restricted → `{ started:false }` and no `triggerExecution` (Review Focus 4); active → one `triggerExecution` with the tick key; same tick twice → one run; reconcile creates missing, updates existing, deletes orphans, survives a Temporal error.
- [ ] **Step 2: Run** `cd apps/api && npx jest src/modules/automations` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx nest build`; bundle check for the automations queue entry.
- [ ] **Step 5: Commit** `feat(automations): schedule triggers run on Temporal schedules`.

---

### Task 6: Studio — webhook and schedule trigger editors

**Files:**
- Modify: `apps/web/src/components/automations/drawers/node-inspector-drawer.tsx` (webhook ~419-430, schedule ~431-445 sections → new components), `apps/web/src/app/(app)/automations/[id]/page.tsx` (pass workflow + permissions), `apps/web/src/lib/api/endpoints/automations.ts` + `apps/web/src/hooks/use-automations.ts` (regenerate mutation)
- Create: `apps/web/src/components/automations/drawers/webhook-trigger-fields.tsx`, `schedule-trigger-fields.tsx`
- Test: `drawers.spec.tsx` (or new spec files next to the components)

**Interfaces:**
- Consumes: shared `AutomationSchedule`, `automationScheduleSchema`, `describeSchedule`, `nextScheduleRuns` (Task 1); `POST /automations/:id/webhook/regenerate` (Task 2); the API public URL (`NEXT_PUBLIC_API_URL`).
- Writes `triggerConfig` (not node config) through the page's save — the page's save payload must include `triggerConfig` for webhook/schedule workflows (today it sends only name/status/nodes/edges).

- [ ] **Step 1: Failing tests:** webhook editor shows `<API URL>/automations/webhook/<token>` with Copy; read-only user (`webhookSlug: null`) sees the exact hidden copy; not ACTIVE shows the exact hint; Regenerate asks for confirmation then calls the mutation; "Require a signature" toggle writes `requireSignature` and shows the secret with Copy; redirect URL input writes `redirectUrl`; curl and HTML form examples contain the URL. Schedule editor: frequency select (Every hour / Every day / Every week / Every month) shows the right fields; weekly allows several days; time zone select defaults to `Asia/Dubai`; summary line equals `describeSchedule(...)`; three next runs listed in the chosen time zone; invalid input shows the zod message and isn't written.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/components/automations "src/app/(app)/automations"` → FAIL (known unrelated failure `surfaces an AI tool preview…` stays). **Step 3: Implement.** **Step 4: Run** → new tests PASS; `npx tsc --noEmit -p .` clean for touched files.
- [ ] **Step 5: Commit** `feat(web): webhook and schedule trigger editors`.

---

### Task 7: Verification, docs, merge and deploy

- [ ] **Step 1:** shared build + tests; `cd apps/api && npx jest --maxWorkers=2`; `cd apps/web && npx vitest run` (only the known failure); `npx nest build`; `corepack pnpm check:drift`.
- [ ] **Step 2:** Local, API + compiled worker only: create a webhook automation (manual email step to the admin), activate, `curl -X POST` JSON and a form-encoded POST → two runs COMPLETED; wrong token → 404; signature required → 401 then 202 with a correct header. Create and activate an hourly schedule automation (manual email step to the admin), then fire it once without waiting for the hour with `client.schedule.getHandle('automation-schedule-<id>').trigger()` → one run COMPLETED with `$trigger.scheduledAt`; pause the automation → the schedule is gone from `client.schedule.list()`.
- [ ] **Step 3:** `docs/FLAGS.md`: schedules are hourly at the finest; webhook URL is persistent (rotate on leak); rate limit fails open if Redis is down (if that is what Task 3 does).
- [ ] **Step 4 (controller, after final review):** merge to master, push, watch CI + Deploy (EC2); on switeaz.com as the seeded admin: webhook curl + form POST → runs; schedule created → `client.schedule` shows it via SSM `docker exec` into the worker; trigger it once → run. Clean up.
