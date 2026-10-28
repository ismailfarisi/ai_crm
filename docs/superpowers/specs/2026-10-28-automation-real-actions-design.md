# Automations: real actions — design

Date: 2026-10-28
Status: builder check done; awaiting product owner approval

## Why

Testing the automation studio end to end showed the action steps are stubs.
`apps/api/src/modules/automations/workflows/automation.activities.ts`:

- **Send email** logs a line and returns `success: true`. Nothing is sent.
- **Update CRM record** logs a line and returns `success: true`. The record is
  unchanged (verified against a real contact).
- **AI prompt** returns the literal text `AI response for prompt: "…"`.

Every run is reported as SUCCESS, so a tenant who builds an automation is told
it worked when it did nothing. The studio's CRM step can't even be configured:
it offers an entity (including "Deal", which doesn't exist) and an action,
but no field for which record or what to change. The three templates on the
list page create a single trigger node and nothing else.

This round makes those three steps do what they say, through the same
services the rest of the app uses, and ships templates that work.

## Goals

1. **Send email** delivers mail through the app's existing `MailService`.
2. **AI prompt** calls the tenant's configured AI provider through `AiService`,
   inside the AI Cost Guard budget, and returns the model's text.
3. **Update CRM record** changes real records, through the domain services,
   with the same permission and ownership rules a person would face, and
   writes an audit row.
4. The studio exposes the fields each of these steps actually needs.
5. Two templates that build a complete, working graph.
6. An admin setting decides whether automations may email AI-written text
   to customers.
7. The Delay step waits for the duration it was configured with.

## Non-goals (later rounds, already agreed)

- Webhook triggers (currently 404 under RLS) and schedule triggers (never
  scheduled).
- Run history screen, and an approvals screen for the Human Approval step.
- Execution rows in `automation_executions` staying `RUNNING` with empty
  `nodeResults` (`recordNodeResultActivity` is also a stub). Tempting to fold
  in; deliberately left for the run-history round, which owns that table's
  shape.
- Fan-in (a node with two incoming edges runs twice) and `$json` after a
  Condition step losing the data. Engine semantics, separate change.
- SSRF hardening of the HTTP Request step.

## Anti-goals

- **A second action engine.** CLAUDE.md: the assistant reuses the agent
  workflow, not a second engine. Here the equivalent is: actions call the
  existing domain services (`ContactsService`, `QuotesService`, `MailService`,
  `AiService`); no raw repository writes, no copy of their rules.
- **An automation that can do more than the person behind it.** Permissions
  are resolved per run from the database (`RbacService.resolveAccess`), never
  cached on the workflow.
- **A step that reports success when it didn't act.** Missing config, missing
  permission, AI not configured, mail failure: the step fails with a message a
  tenant can act on.
- **Customer acceptance creating orders.** `quote-acceptance.service.ts`
  states acceptance is recorded, not acted on, so a customer's click can't walk
  a below-floor quote past the margin floors. No template may wire
  `quote.accepted` straight to an approval.

## Decisions

### Who an automation acts as (decided)

The **owner**: the user who last switched the automation to ACTIVE. Stored on
the workflow as `activatedByUserId` (new nullable column + migration), set by
`AutomationsService.updateWorkflow` whenever `status` transitions to `ACTIVE`;
the controller passes the current user. A **test run** acts as the user who
clicked Test Run (they are present, and `actorUserId` is already threaded
through `triggerExecution`).

At run time the activity resolves the owner's access with
`RbacService.resolveAccess(userId, tenantId)` and builds the
`AuthenticatedUser` that services expect. If the owner no longer exists, is
deactivated, or lacks the permission the step needs, the step fails with
"<owner email> can no longer <action>; reactivate the automation as someone
who can".

**Editing an active automation changes its owner** (my call). Today
`updateWorkflow` lets anyone with `automation:update` change `nodes`/`edges`
while the status stays ACTIVE, which would let them add steps that run with
someone else's authority. So any save that changes `nodes`, `edges` or
`triggerConfig` on an ACTIVE workflow sets `activatedByUserId` to the saver.
The studio says so next to Save on an active automation ("Saving makes you
the owner: steps will run with your permissions").

**The owner must still be allowed to run automations**: the activity fails
the step if the owner no longer holds `automation:execute`.

This replaces the current behaviour for these steps (today the AI agent step
uses `actorUserId ?? triggerPayload.event.actorUserId`, i.e. whoever
triggered it). The AI agent step's actor is **not** changed in this round:
it's outside the three stubbed steps. Builder may note it as a follow-up.

`DynamicWorkflowInput` gains `ownerUserId?: string`. `triggerExecution`
callers set it: test run → the clicking user; event bridge / webhook →
`workflow.activatedByUserId`. Existing workflows have no owner until
reactivated; their action steps fail with the message above (see Rollout).

### Send email (decided)

- Config: `to` (comma-separated, expressions allowed), `subject`, `body`.
- Sends via `MailService.sendMail` (`GenericMail`), once per recipient, with
  `text` = body and `html` = body escaped and newlines turned into `<br>`.
  Interpolated values are escaped in the HTML part.
- At most **10 recipients per step** (my call). More, or an address that
  doesn't parse as an email, fails the step before anything is sent.
- No permission check beyond the owner being active and holding
  `automation:execute`, except for AI-written email to customers (next
  section).
- Output: `{ sent: [...addresses], provider }`.
- On switeaz.com `MAIL_PROVIDER=console`, so mail is logged, not delivered,
  until SES is configured. Expected; not a bug in this work.

### AI prompt (decided)

- Config: `prompt` (expressions allowed). Drop the unused `model` and
  `mockResponse` knobs from the activity: the tenant's AI settings pick the
  model, as for every other AI feature.
- Calls `AiService.generateText('automation.prompt', { prompt … }, {
  organizationId, userId: owner })`, which already enforces the budget guard
  and logs usage. Feature key name is the builder's call if a convention
  exists.
- AI not configured (`AiService.isConfigured` false) or budget exhausted:
  the step fails with that reason.
- Output: `{ text, usage }` (keep `text`; templates reference
  `$json.text`).

### Update CRM record (decided)

The studio's entity/action pair becomes:

| Entity  | Action   | Fields                                   | Service call |
|---------|----------|------------------------------------------|--------------|
| Contact | Create   | `fields` (key → value, expressions)       | `ContactsService.create(actor, input)` |
| Contact | Update   | `recordId`, `fields`                      | `ContactsService.update(actor, id, input)` |
| Quote   | Approve  | `recordId`, optional `comment`            | `QuotesService.sendSignal(tenant, id, 'APPROVE', { comment }, owner)` |
| Quote   | Reject   | `recordId`, `reason`                      | `QuotesService.sendSignal(tenant, id, 'REJECT', { reason }, owner)` |

- "Deal" and "Add note" are removed: there is no Deals module and contacts
  have no notes.
- "Generate invoice from quote" is removed. Approving a quote already calls
  `InvoicesService.createFromQuote` and raises the order and invoice;
  a separate step would duplicate that path.
- Contact `fields` go through `createContactSchema` / `updateContactSchema`
  (they normalise; see CLAUDE.md "Zod schemas transform"). Unknown keys fail
  the step. The studio offers the contact fields as a key/value editor; the
  exact widget is the builder's call.
- `ContactsService` applies tenant and ownership scoping via `scoped()`
  (CLAUDE.md: every contacts query goes through it).
- **Permissions are checked by the activity.** The services don't check them;
  only the controllers do (`@RequirePermissions`). The activity holds a
  step → permission map that mirrors those controllers (contact create →
  `contact:create`, contact update → `contact:update`, quote approve/reject →
  the permission `POST /quotes/:id/signal` requires), using constants from
  `packages/shared/src/rbac/permissions.ts`, and checks it against the
  owner's resolved permissions before calling the service. The HTTP path is
  unchanged. The failure message names the missing permission.
- **An automation never waives a margin floor** (from
  `QuotesService.assertActorMayApprove`: "A bot must never be the thing that
  waives a margin floor"). The approve step runs the floor check as the bot
  path does, even when the owner holds `quote:approve_below_margin`. The owner
  is still recorded as the actor on the quote and in the audit row. This
  needs a way to tell `sendSignal` the call is automated; how is the
  builder's call.
- Output: the resulting record (contact DTO / quote summary with status).

### Audit (decided)

Changes made by a step arrive outside HTTP, so `AuditInterceptor` doesn't
see them. CLAUDE.md: such changes call `AuditService.record` themselves.
Each CRM step writes one row: `actorId` = owner, `origin: 'HUMAN'` (a person
configured and activated it), `channel: 'SYSTEM'`, `messageId:
automation:<executionId>:<nodeId>`, `summary` naming the automation, and
before/after snapshots. No new audit channel value (it would need a shared
constant change and possibly a migration; my call).

If a service already audits internally for that operation, don't
double-write: builder checks.

### AI-written email to customers (decided: admin setting)

`docs/FLAGS.md` records that every AI-written customer message needs a
person's Approve, and automations have no approval screen yet. The product
owner's decision: **an admin decides per organisation.**

- New organisation setting **"Allow automations to email AI-written text to
  customers"**, **off by default** (keeps today's rule). It lives with the AI
  settings (`/settings/ai`, AI Cost Guard) and is changed by whoever holds
  the permission that guards those settings today. Stored wherever the
  organisation's AI config lives (builder checks `ai-config.service.ts`).
  Changing it is audited (it arrives over HTTP, so `AuditInterceptor`
  covers it).
- **AI-written** means the step's `to`, `subject` or `body` uses the output
  of an AI step (`aiPromptNode` or `aiAgentNode`): either `$json` when the
  step's direct predecessor is an AI step, or `$node[...]` naming one. Decided
  statically from the graph at run time, before interpolation.
- **Customer** means any recipient address that is not the email of an
  active user in the organisation.
- With the setting **off**, an AI-written email to a customer address fails
  the step with: "Your admin hasn't allowed automations to email AI-written
  text to customers. Send it to your team, or ask an admin to turn this on in
  Settings → AI." Sending to the team still works. With the setting **on**,
  it sends.
- The studio shows a hint on a Send email step that uses AI output: whether
  the setting currently allows sending it to customers.

### No automation loops (decided, my call)

Contact and quote changes publish domain events, and the event bridge turns
events into new runs. An automation on `contact.updated` that updates a
contact would re-trigger itself forever, sending email and spending AI budget
each time; per-node idempotency doesn't help because each loop is a new
event.

- **Changes made by an automation step do not trigger automations.** Events
  published while an automation activity runs carry a marker (e.g. set in the
  tenant/request context the event bus already reads), and
  `AutomationEventBridgeService` skips marked events. No chaining of
  automations in this round; revisit with an explicit depth limit if tenants
  ask for it.
- **A CRM-event trigger must name an event.** `matchesEvent` currently
  treats a missing event as "match everything"; the bridge stops matching
  those, and saving an automation whose CRM-event trigger has no event is a
  validation error.

### Delay (decided)

The studio writes `config.durationMs`; the engine reads `config.duration ||
config.delay`. Engine accepts `durationMs` (number of ms, or a duration
string as today). Existing saved workflows keep working.

### Templates (decided)

Replace the three cards on the list page with two that build full graphs:

1. **"Customer accepted a quote → tell the team"**: CRM event trigger on
   `quote.accepted` → Send email to the tenant's owner/admin (address as a
   placeholder the tenant edits) with the quote number, customer and total,
   and a link to the quote. Person stays in the loop; nothing is approved
   automatically.
2. **"Invoice overdue → AI drafts a reminder → email the customer"**:
   CRM event trigger on `invoice.overdue` (payload already carries
   `customerEmail`) → AI prompt drafting a short, polite reminder from the
   invoice number, amount and days overdue → Send email with the AI text as
   body. Created as DRAFT like every new automation. The recipient depends on
   the AI-email setting when the template is used: **off** → a placeholder
   team address the tenant edits, with the customer's email and the draft in
   the body so the team can forward it; **on** → the customer's email from
   the trigger payload. The template card says which it will do.

Exact payload paths: builder reads `invoice-overdue.service.ts`,
`quote-acceptance.service.ts` and `automation-event-bridge.service.ts` (how
the event lands in `triggerPayload`).

The webhook and scheduled templates are dropped until those triggers work.

## How it fits

- New factory `createAutomationActivities(deps)` in the automations module,
  following `createAgentReactActivities`: deps are `MailService` (or the
  `MAIL_PROVIDER` token), `AiService`, `ContactsService`, `QuotesService`,
  `RbacService`, `UsersService` (to load the owner), `AuditService`,
  `TenantContextService`. `temporal-worker.ts` spreads it into the
  automations-queue activities in place of the stub functions. The pure
  activities (HTTP, code transform, record-node-result) stay as plain
  functions.
- Activities run inside `tenantContext` for the workflow's tenant (RLS: the
  worker role has `NOBYPASSRLS`).
- `dynamic-dag.workflow.ts` keeps calling activities by the same names; only
  the input grows the owner/execution/node ids the activity needs.
- Retries: activities are retried 3× by Temporal. Email and CRM mutations
  must not double-act on retry: make each activity idempotent per
  `(executionId, nodeId)`. The codebase has `ChannelIdempotencyService` for
  exactly this; reuse it if it fits.

## Rollout

Existing ACTIVE automations have no `activatedByUserId`. Their email/CRM/AI
steps will fail with "reactivate this automation" until someone toggles them
off and on. Production has zero automations today (checked 2026-10-28), so
the migration needs no backfill.

## Testing

- Unit tests per action: success, missing permission, ownership scoping
  (rep can't update another rep's contact), AI not configured, recipient cap,
  invalid email, idempotent retry.
- Security tests: an editor saving an active automation becomes its owner;
  an owner without `automation:execute` can't run steps; automated quote
  approval below the margin floor is refused even for an owner who could
  waive it; an event published by an automation step starts no run; a
  CRM-event trigger without an event never matches; AI-written email to a
  customer is refused with the setting off and sent with it on, and email to
  a team member is sent either way.
- Workflow test: owner id threads from `triggerExecution` to the activity.
- Web: CRM step editor shows the right fields per entity/action; Delay value
  round-trips.
- Template test: each template's graph passes `validateWorkflowGraph` and
  every expression it uses resolves against a sample trigger payload.
- Manual on switeaz.com after deploy: build the overdue template, test-run it
  with a sample payload, confirm the AI text and the logged email.

## Left to the builder

- Widget design for the contact key/value fields and recipient input.
- Feature key for AI usage logging.
- Whether idempotency uses `ChannelIdempotencyService` or a simpler key.
- Exact template copy.
