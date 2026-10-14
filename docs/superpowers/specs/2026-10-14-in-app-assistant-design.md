# In-App AI Assistant — Design

**Date:** 2026-10-14
**Status:** Draft — awaiting review

## Goal

Give CRM users a chat assistant inside the web app that can:

1. **Act on CRM data** using the same tools the channel agents already use (quotes, purchase orders, work orders, delivery, sales orders from documents, custom objects).
2. **Work with channel conversations** — read a contact's WhatsApp / Telegram / email thread, draft a reply, and send it (with approval).

Every change the assistant makes goes through an explicit Approve / Reject step, respects the user's own permissions, and is audited back to the chat message that caused it.

### Decisions already made

| Question | Decision |
|---|---|
| Scope | Both CRM tools and channel-thread tools |
| Placement | Slide-over panel available on every page, context-aware, plus a full-page `/assistant` view |
| Engine | Reuse the Temporal `agentReActWorkflow`; stream step-level progress over SSE (no token streaming in v1) |

### Out of scope (v1)

- The assistant autonomously replying to inbound WhatsApp/Telegram messages (that is the existing channel workflow).
- Attachments / file upload in chat.
- Token-by-token streaming of the final answer (possible later upgrade: a streaming call for the final answer on top of the same workflow).
- Sharing conversations between users.

## 1. Architecture & data flow

```
Panel ──POST /assistant/conversations/:id/messages──► AssistantController
  │                                                     │ persist user message + turn, start
  │                                                     ▼ agentReActWorkflow (workflowId = assistant-turn-<turnId>)
  │                                                  Temporal worker
  │                                                     │ each step → emitAssistantEventActivity
  │                                                     │   = INSERT assistant_messages / UPDATE assistant_turns
  │                                                     │     + Redis PUBLISH assistant:conv:<id>
  ◄──GET /assistant/conversations/:id/stream (SSE)──────┘ API subscribes to Redis; replays from DB on (re)connect
  │
  └─POST /assistant/turns/:turnId/approval {approved, note}──► signals approvalSignal on that workflow
```

### One turn = one workflow run

Each user message starts a fresh `agentReActWorkflow` run that ends at a final answer, rejection, timeout, failure or cancel. Conversation memory lives in Postgres and is passed into each run; no long-lived per-conversation workflow. Only one turn may be active (`RUNNING` or `AWAITING_APPROVAL`) per conversation; the composer is disabled meanwhile and offers **Stop** (cancels the workflow).

### Changes to `agentReActWorkflow` (all additive — automations unaffected)

`AgentReActWorkflowInput` gains optional fields:

- `history?: Array<{ role: 'user' | 'assistant'; content: string }>` — the last 20 conversation messages (user + final assistant answers only, not tool chatter), prepended to the planner's conversation history before the current prompt.
- `pageContext?: { entity: string; id: string; label?: string }` — rendered into the planner prompt as `The user is currently viewing <entity> <label> (id <id>).` It is a hint only; tools still resolve and permission-check ids.
- `eventSink?: { kind: 'assistant'; conversationId: string; turnId: string }` — when present, the workflow calls a new `emitAssistantEventActivity` after each plan, tool call, tool result, approval request and at the end. When absent, behaviour is byte-for-byte unchanged.
- `auditChannel?: AuditChannel` / `originMessageId?: string` — forwarded to `commitToolMutationActivity` so commits record `originChannel: 'ASSISTANT'` and link to the assistant message.

Approval reuses the existing `approvalSignal`. The `agentApprovalRequestedSignal` relay to an automation parent still only fires when `parentWorkflowId` is set, so assistant turns never trigger it. Chat turns pass `approvalTimeout: '24 hours'`.

Workflow code cannot do I/O, hence the event activity. The workflow passes a deterministic `eventKey` (e.g. `t3:tool_call:<toolCallId>`) and the activity upserts on `(turn_id, event_key)`, so Temporal retries do not duplicate events. `seq` is assigned by the database on insert.

### Authorization

- All assistant routes require the new `assistant:use` permission.
- The tool list comes from the existing `listAvailableTools`, which filters by the user's effective permissions; mutations re-resolve permissions before commit (existing behaviour).
- Conversations are private to their owner within a tenant. Only the owner may post messages, approve, reject or cancel.

### Audit

- The global `AuditInterceptor` covers the assistant's own POST/PATCH routes automatically (add the subject in `modules/audit/audit-subjects.ts`).
- AI-made mutations are already recorded by `commitToolMutationActivity` via `AuditService.record` with `origin: 'AI_ASSISTED'`, model and prompt version. For assistant turns they will carry `originChannel: 'ASSISTANT'` (new value in `AUDIT_CHANNELS`, `packages/shared/src/platform/audit.ts`; the column is `varchar(20)` with no CHECK constraint) and `originMessageId` = the assistant message id.

## 2. Data model & API

### Tables (one migration)

All three tables carry `organization_id`, have `ENABLE` + `FORCE ROW LEVEL SECURITY` and the standard `tenant_isolation_policy` (same pattern as `1789400000000-ChannelIdempotency.ts`). Foreign keys live in the migration, per repo convention.

**`assistant_conversations`**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| organization_id | uuid | RLS |
| user_id | uuid | owner |
| title | varchar(200) | first ~60 chars of the first user message; renamable |
| context | jsonb null | last page context used |
| created_at / updated_at | timestamptz | |
| archived_at | timestamptz null | |

Index: `(organization_id, user_id, updated_at desc)`.

**`assistant_turns`**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| organization_id | uuid | RLS |
| conversation_id | uuid fk | |
| workflow_id | varchar(200) | `assistant-turn-<id>` |
| status | varchar(20) | `RUNNING`, `AWAITING_APPROVAL`, `COMPLETED`, `REJECTED`, `TIMED_OUT`, `FAILED`, `CANCELLED` |
| pending_action | jsonb null | `{ tool, preview }` while awaiting approval |
| steps | int | |
| model | varchar(100) null | |
| error | text null | |
| last_progress_at | timestamptz | used by the stale-turn sweep |
| created_at / finished_at | timestamptz | |

Partial unique index: one row per `conversation_id` where `status IN ('RUNNING','AWAITING_APPROVAL')` — enforces one active turn at the database level.

**`assistant_messages`** (also the event log)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| organization_id | uuid | RLS |
| conversation_id | uuid fk | |
| turn_id | uuid fk null | set for every row a turn produces; the user's message carries the turn it started |
| event_key | varchar(200) null | deterministic key from the workflow; null for the user message |
| seq | bigint | from a global sequence, so increasing within a conversation; used as SSE event id |
| role | varchar(16) | `user`, `assistant`, `step`, `tool_call`, `tool_result`, `approval` |
| content | text | display text |
| tool_name | varchar(120) null | |
| payload | jsonb null | args / result / preview |
| created_at | timestamptz | |

Unique: `(turn_id, event_key)`. Index: `(conversation_id, seq)`.

Every query goes through `AssistantService.scoped(user)`, which applies the tenant (RLS) **and** `user_id = :userId`. No raw repository finds elsewhere.

### API — `modules/assistant`, all behind `assistant:use`

| Route | Purpose |
|---|---|
| `GET /assistant/conversations` | recent conversations (paged, excludes archived) |
| `POST /assistant/conversations` | create `{ context? }` |
| `GET /assistant/conversations/:id` | conversation + messages + active turn |
| `PATCH /assistant/conversations/:id` | `{ title?, archived? }` |
| `POST /assistant/conversations/:id/messages` | `{ content, context? }` — persists message, creates turn, starts workflow. **409** if a turn is active |
| `GET /assistant/conversations/:id/stream` | SSE. Honors `Last-Event-ID` (= `seq`); replays from DB then tails Redis |
| `POST /assistant/turns/:id/approval` | `{ approved, note? }` — owner only, turn must be `AWAITING_APPROVAL` (else 409) |
| `POST /assistant/turns/:id/cancel` | cancels workflow, marks `CANCELLED` |

SSE event types: `step`, `tool_call`, `tool_result`, `approval_required`, `message` (final assistant answer), `turn_status`. Heartbeat comment every 15s.

SSE is consumed with `fetch` + `ReadableStream` on the web side so the normal `Authorization: Bearer` guard applies (no tokens in query strings, no `EventSource`).

### Shared contract — `packages/shared/src/assistant/`

- Zod schemas: `sendAssistantMessageSchema`, `createAssistantConversationSchema`, `updateAssistantConversationSchema`, `assistantApprovalSchema`, `assistantPageContextSchema`.
- `AssistantStreamEvent` discriminated union and `AssistantTurnStatus`.
- Permission: `ASSISTANT_USE: 'assistant:use'` added to `packages/shared/src/rbac/permissions/ai.ts`, granted to admin, manager and member (same as `ai:use`).

Remember to rebuild shared (`pnpm --filter @saas/shared build`) before the apps see it.

## 3. Tools

### New channel skills

Each is a `ChannelSkill` file in `apps/api/src/modules/channels/skills/` + one registry line + a name in `packages/shared/src/channels/skills.ts`. They call the same `ChannelsService` methods the HTTP controller uses.

| Tool | Permission | Policy tier | Behaviour |
|---|---|---|---|
| `channel_thread.read` | `CHANNEL_READ` | READ (autonomous) | `{ contact, provider?, limit ≤ 50 }`. Resolves the contact by name/email/phone through `ContactsService.scoped()` (so `contact:read` vs `contact:read_all` applies); ambiguous → asks. Returns recent messages: direction, provider, body, timestamp. |
| `draft_channel_message` | `CHANNEL_READ` | DRAFT_WRITE (autonomous) | `{ contact, provider?, intent }`. Returns a proposed body and the provider it would use. Sends nothing, writes nothing. |
| `channel_message.send` | `CHANNEL_SEND` | COMMIT_MUTATION — **always approve** | `{ contact, provider, body }`. Preview shows recipient, provider and the full message. Added to `ToolExecutionPolicyService`'s always-approve set. |

Existing tools are offered unchanged.

### Required fixes to existing code

1. **`SkillContext.provider`** is typed as `ChannelProviderType` and required. Add an in-app value (make it `ChannelProviderType | 'IN_APP'`) and audit each existing skill for reads of `provider` (expected: reply formatting only). The implementation plan enumerates each skill.
2. **Planner prompt** currently builds `Goal: <prompt>` + `conversationHistory`. Prior conversation (`history`) and page context are prepended; the current turn's tool results continue to append as today.

### Page context (web)

A small route → context map in `apps/web/src/components/assistant/page-context.ts` covers contacts, customers, quotes, orders, purchase orders, work orders, custom records and inbox threads. The panel sends `{ entity, id, label }` with each message; the user can dismiss the chip to omit it.

## 4. UI

Location: `apps/web/src/components/assistant/`, using the in-repo `components/ui` kit (Tailwind v4, lucide-react, sonner). Not shadcn.

- **`AssistantLauncher`** — sparkle button in the app-shell header plus ⌘J / Ctrl+J. Rendered only when the user has `assistant:use`.
- **`AssistantPanel`** — right slide-over (420px; full-screen on mobile), mounted once in `components/layout/app-shell.tsx` so it persists across navigation.
  - Header: conversation title, recent-conversations dropdown, New chat, expand to `/assistant`.
  - Context chip above the composer ("Viewing: Q-1042 ×").
  - Message list: user/assistant bubbles (markdown for assistant), collapsible step rows ("Looked up open quotes for Acme — 3 results"), error step rows in red, and **`ApprovalCard`** showing the tool preview with **Approve** and **Reject (with note)**. Expired cards show "Expired" + Retry (re-sends the original user message).
  - Composer: textarea, Enter to send / Shift+Enter newline; disabled with a **Stop** button while a turn is active.
- **`/assistant` page** — `app/(app)/assistant/page.tsx`: same components, full width, conversation list sidebar. Added to `lib/nav.ts`.
- **Data**: react-query for lists/history (`api.assistant.*` in `lib/api/endpoints.ts`); `useAssistantStream(conversationId)` hook for live events — reconnect with backoff, sends `Last-Event-ID`, merges events into the react-query cache.
- Empty state when the org has no AI provider configured: explains and links admins to Settings → AI.

## 5. Error handling

| Case | Behaviour |
|---|---|
| Turn already active | 409; UI shows the active turn |
| AI budget exhausted (Redis guard) | Turn → `FAILED`; chat shows "AI budget reached for this period" |
| No AI provider configured | Empty-state panel |
| Tool error / permission denied | Returned to the planner as a tool result so it can explain or adapt; shown as a red step row |
| Approval not answered in 24h | Turn → `TIMED_OUT`; card shows Expired + Retry |
| Max turns (6) reached | Turn → `FAILED` with the existing message |
| SSE connection drops | Client reconnects with `Last-Event-ID`; server replays from DB |
| Worker down / turn stuck | Stream shows "Waiting for worker…"; a sweep marks `RUNNING` turns with no progress for 2 minutes as `FAILED` (approval waits are exempt) |
| Workflow start fails | Turn → `FAILED` immediately; message stays so the user can retry |

## 6. Testing

- **API unit**
  - New skills: contact resolution (incl. ownership scoping and ambiguity), permission gates, `channel_message.send` always requires approval.
  - `AssistantService.scoped()`: user B cannot read, post to, approve or cancel user A's conversation; cross-tenant isolation.
  - Approval endpoint: owner only; 409 unless `AWAITING_APPROVAL`.
  - Stream: replay from `Last-Event-ID` returns events in `seq` order, no duplicates.
  - Partial unique index: second concurrent message → 409.
- **Workflow** (`@temporalio/testing`, time-skipping):
  - history + page context reach the planner; events emitted per step.
  - approve → commit with `originChannel: 'ASSISTANT'`; reject; 24h timeout.
  - Regression: automation path (`parentWorkflowId` set, no `eventSink`) behaves as before.
- **Schema**: `pnpm migration:generate` reports no drift after the migration; `pnpm check:drift` passes without baseline changes.
- **Web**: component tests for `ApprovalCard` and the stream hook's reconnect/replay.
- **Manual E2E** with seeded users: "show me Acme's last WhatsApp messages and draft a follow-up" → "send it" → approve → verify the outbound `channel_messages` row and an audit row with `origin = AI_ASSISTED`, `origin_channel = ASSISTANT`, `origin_message_id` set. Also verify a member without `channel:send` is never offered the send tool.
