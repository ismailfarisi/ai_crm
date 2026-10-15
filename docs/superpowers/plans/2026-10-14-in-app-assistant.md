# In-App AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A context-aware chat assistant in the web app that answers questions and acts on CRM data and channel conversations through the existing Temporal ReAct agent, with an Approve / Reject step before anything changes.

**Architecture:** Each user message starts one `agentReActWorkflow` run on a new `assistant-queue`. The workflow reports each step through a new `emitAssistantEventActivity`, which writes a row to `assistant_messages` (the event log) and publishes a Redis nudge. The API serves an SSE stream that replays rows from Postgres and tails them on each nudge (with a 5s poll fallback). Approvals reuse the workflow's existing `approvalSignal`.

**Tech Stack:** NestJS 11, TypeORM 1, Postgres 18 (RLS), Temporal TS SDK, ioredis, Zod (in `@saas/shared`), Next.js 16 App Router, react-query, Tailwind v4, lucide-react, vitest, jest.

**Spec:** `docs/superpowers/specs/2026-10-14-in-app-assistant-design.md`

## Spec deviations (decided while reading the code — call out in review)

1. **No `draft_channel_message` tool.** A draft tool would only do what the planner already does in its own answer: write text. The planner drafts in chat; `channel_message.send` carries the final body and its approval card shows the full text. Tools are `channel_thread.read` and `channel_message.send`.
2. **`SkillContext.provider` is unchanged.** `makeContext` in `agent-react.activities.impl.ts` already supplies a provider for non-channel callers; the only reader (`purchase-order-create.skill.ts:387`) writes PO origin metadata with its own type. No change is needed.
3. **Tenant column is `tenant_id`**, matching the newest tables (`channel_idempotency_records`, `crm_event_outbox`), not `organization_id`.
4. **One SSE event type (`message`).** Turn status changes are written as `status` rows whose payload carries the full turn, so the stream is "rows in `seq` order" and nothing else.
5. **Auth on the stream is the httpOnly cookie** (`credentials: 'include'`), because the web app has no bearer token in JS. Still `fetch` + `ReadableStream`, not `EventSource`, to reuse the silent-refresh path.
6. **Assistant routes are added to `AUDIT_BODYLESS_PREFIXES`**, not `AUDIT_SUBJECTS`. The actions are still audited; chat bodies are not copied into the audit trail.
7. **Audit `messageId`** on AI commits is the user message that started the turn (stored on the turn).
8. **Stale threshold is 7 minutes, not 2** (5 originally; raised to 7 in the final review to exceed the 5-minute commit timeout). One planning activity may legitimately take up to 135s (45s timeout × 3 retries) without emitting anything, so 2 minutes would fail healthy turns.

## Global Constraints

- Permission constant `ASSISTANT_USE: 'assistant:use'` is defined in `packages/shared/src/rbac/permissions/ai.ts`, granted to admin, manager, member. No permission strings at call sites.
- After every edit under `packages/shared`, run `pnpm --filter @saas/shared build` before running app tests.
- `DB_SYNCHRONIZE=false`; schema changes only via a migration. Foreign keys and CHECK constraints live in the migration, not on entities.
- New tenant tables: `tenant_id uuid`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, `tenant_isolation_policy` (exact SQL in Task 4).
- Chat turns run on Temporal task queue `assistant-queue`, workflow id `assistant-turn-<turnId>`, `approvalTimeout: '24 hours'`, `maxTurns: 6`.
- History passed to a turn: last 20 rows with role `user` or `assistant`.
- Stale sweep: `RUNNING` turns with `last_progress_at` older than 7 minutes become `FAILED`; `AWAITING_APPROVAL` is exempt. Every emitted event bumps `last_progress_at`. (Raised from 5 in the final review: the commit activity's timeout is 5 minutes and it emits nothing while running, so a "Running <tool>" step is emitted just before it.)
- `channel_message.send` always requires approval.
- Message content limit 4000 chars; approval note 500; title 200.
- SSE heartbeat every 15s; poll fallback every 5s.
- Do not change automation behaviour: with no `eventSink`, `agentReActWorkflow` must behave exactly as today (existing spec file stays green unmodified apart from the added mock key).

## Review Focus

1. **Two browser tabs on the same conversation** — both streams show the same events once each, in order; a message sent from tab A appears in tab B.
2. **Double-clicking Approve (or approving from two tabs)** — exactly one commit; the second request gets 409, never a second signal.
3. **Reconnect after a network blip mid-turn** — no duplicated or missing steps (replay from `Last-Event-ID`).
4. **Temporal activity retry of an event emit** — the event appears once (`(turn_id, event_key)` upsert).
5. **A member without `channel:send` asks the assistant to message a customer** — the send tool is never offered; the assistant says it can't, nothing is sent.

Each is pinned by a test in the owning task (Tasks 2, 3, 5, 6).

---

## File Structure

**Shared (`packages/shared/src`)**
- Modify `rbac/permissions/ai.ts` — `ASSISTANT_USE`.
- Modify `platform/audit.ts` — `'ASSISTANT'` in `AUDIT_CHANNELS`.
- Modify `channels/skills.ts` — `CHANNEL_THREAD_READ`, `CHANNEL_MESSAGE_SEND`.
- Create `assistant/index.ts` — schemas, DTOs, statuses.
- Modify `index.ts` — `export * from './assistant'`.

**API — channels (`apps/api/src/modules/channels`)**
- Create `services/skill-actor.service.ts` — builds an `AuthenticatedUser` for skill code from `(organizationId, userId)`.
- Create `skills/channel-contact.resolver.ts` — contact lookup through `ContactsService` (owner-scoped).
- Create `skills/channel-thread-read.skill.ts`, `skills/channel-message-send.skill.ts` (+ specs).
- Modify `skills/skill.registry.ts`, `skills/tool-execution-policy.service.ts`, `channels.module.ts`.
- Modify `workflows/agent-react.workflow.ts`, `workflows/activities/agent-react.activities.ts`, `workflows/activities/agent-react.activities.impl.ts` (+ specs).

**API — assistant (`apps/api/src/modules/assistant`)** — new module
- `entities/assistant-conversation.entity.ts`, `entities/assistant-turn.entity.ts`, `entities/assistant-message.entity.ts`
- `assistant-redis.ts` — Redis client factory + tokens.
- `assistant-events.service.ts` — the only writer of messages/turn state from turns; publishes nudges.
- `assistant.activities.ts` — `createAssistantActivities()` for the worker.
- `assistant.service.ts` — scoped conversation access, send / approve / cancel.
- `assistant-stream.hub.ts` — one Redis subscriber per process, fan-out to SSE listeners.
- `assistant.controller.ts` — REST + SSE.
- `assistant-sweep.service.ts` — stale turn cron.
- `assistant.module.ts`
- `apps/api/src/database/migrations/<ts>-AssistantChat.ts`
- Modify `feature-modules.ts`, `temporal-worker.ts`, `modules/audit/audit-subjects.ts`.

**Web (`apps/web/src`)**
- `lib/api/endpoints/assistant.ts`, modify `lib/api/endpoints/index.ts`.
- `lib/api/stream.ts` — credentialed SSE reader.
- `hooks/use-assistant.ts`, `hooks/use-assistant-stream.ts`.
- `components/assistant/page-context.ts`, `assistant-provider.tsx`, `assistant-panel.tsx`, `assistant-thread.tsx`, `approval-card.tsx`, `assistant-composer.tsx`, `assistant-launcher.tsx`, `conversation-list.tsx`.
- `app/(app)/assistant/page.tsx`; modify `components/layout/app-shell.tsx`, `lib/nav.ts`.

---

### Task 1: Shared contract

**Files:**
- Modify: `packages/shared/src/rbac/permissions/ai.ts`
- Modify: `packages/shared/src/platform/audit.ts:14-20`
- Modify: `packages/shared/src/channels/skills.ts:39-48`
- Create: `packages/shared/src/assistant/index.ts`
- Create: `packages/shared/src/assistant/assistant.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces — Produces:**
- `PERMISSIONS.ASSISTANT_USE`
- `AuditChannel` includes `'ASSISTANT'`
- `CHANNEL_SKILLS.CHANNEL_THREAD_READ = 'channel_thread.read'`, `CHANNEL_SKILLS.CHANNEL_MESSAGE_SEND = 'channel_message.send'`
- From `assistant/index.ts`: `ASSISTANT_TURN_STATUSES`, `AssistantTurnStatus`, `ACTIVE_ASSISTANT_TURN_STATUSES`, `ASSISTANT_MESSAGE_ROLES`, `AssistantMessageRole`, `assistantPageContextSchema`, `AssistantPageContext`, `createAssistantConversationSchema`, `CreateAssistantConversationPayload`, `updateAssistantConversationSchema`, `UpdateAssistantConversationPayload`, `sendAssistantMessageSchema`, `SendAssistantMessagePayload`, `assistantApprovalSchema`, `AssistantApprovalPayload`, `AssistantPendingAction`, `AssistantMessageDto`, `AssistantTurnDto`, `AssistantConversationDto`, `AssistantConversationDetailDto`.

- [ ] **Step 1: Write the failing test**

Check how shared tests run first: `ls packages/shared/src/rbac/permissions/catalog.spec.ts` exists and `grep '"test"' packages/shared/package.json`. Use the same runner (the catalog spec's imports tell you whether it is jest or vitest; the code below works with both because it only uses `describe/it/expect`).

```ts
// packages/shared/src/assistant/assistant.spec.ts
import {
  ACTIVE_ASSISTANT_TURN_STATUSES,
  assistantApprovalSchema,
  sendAssistantMessageSchema,
  updateAssistantConversationSchema,
} from './index';
import { PERMISSIONS } from '../rbac/permissions';
import { AUDIT_CHANNELS } from '../platform/audit';
import { CHANNEL_SKILLS } from '../channels/skills';

describe('assistant contract', () => {
  it('trims content and accepts a page context', () => {
    const parsed = sendAssistantMessageSchema.parse({
      content: '  show me Acme  ',
      context: { entity: 'quote', id: 'q-1', label: 'Q-1042' },
    });
    expect(parsed.content).toBe('show me Acme');
    expect(parsed.context?.label).toBe('Q-1042');
  });

  it('rejects empty and oversized content', () => {
    expect(sendAssistantMessageSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(sendAssistantMessageSchema.safeParse({ content: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('accepts a null context (re-submitting a loaded conversation)', () => {
    expect(sendAssistantMessageSchema.safeParse({ content: 'hi', context: null }).success).toBe(true);
  });

  it('requires something to update', () => {
    expect(updateAssistantConversationSchema.safeParse({}).success).toBe(false);
    expect(updateAssistantConversationSchema.safeParse({ archived: true }).success).toBe(true);
  });

  it('caps the approval note', () => {
    expect(assistantApprovalSchema.safeParse({ approved: false, note: 'n'.repeat(501) }).success).toBe(false);
  });

  it('exposes the active statuses, permission, audit channel and skill names', () => {
    expect(ACTIVE_ASSISTANT_TURN_STATUSES).toEqual(['RUNNING', 'AWAITING_APPROVAL']);
    expect(PERMISSIONS.ASSISTANT_USE).toBe('assistant:use');
    expect(AUDIT_CHANNELS).toContain('ASSISTANT');
    expect(CHANNEL_SKILLS.CHANNEL_THREAD_READ).toBe('channel_thread.read');
    expect(CHANNEL_SKILLS.CHANNEL_MESSAGE_SEND).toBe('channel_message.send');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test -- assistant`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Implement**

`packages/shared/src/rbac/permissions/ai.ts` — add the key, description, group entry and grants:

```ts
export const AI_PERMISSIONS = {
  AI_USE: 'ai:use',
  AI_MANAGE: 'ai:manage',
  ASSISTANT_USE: 'assistant:use',
} as const;
```
```ts
    [AI_PERMISSIONS.ASSISTANT_USE]:
      'Chat with the in-app assistant, which can read and (with your approval) change records you already have access to',
```
```ts
  groupPermissions: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.AI_MANAGE, AI_PERMISSIONS.ASSISTANT_USE],
  grants: {
    admin: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.AI_MANAGE, AI_PERMISSIONS.ASSISTANT_USE],
    manager: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.ASSISTANT_USE],
    member: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.ASSISTANT_USE],
  },
```

`packages/shared/src/platform/audit.ts`:

```ts
export const AUDIT_CHANNELS = [
  'WEB',
  'TELEGRAM',
  'WHATSAPP',
  'EMAIL',
  'SYSTEM',
  'ASSISTANT',
] as const;
```

`packages/shared/src/channels/skills.ts` — append to `CHANNEL_SKILLS`:

```ts
  CHANNEL_THREAD_READ: 'channel_thread.read',
  CHANNEL_MESSAGE_SEND: 'channel_message.send',
```

`packages/shared/src/assistant/index.ts`:

```ts
import { z } from 'zod';

/**
 * The in-app assistant's contract. One turn = one agentReActWorkflow run;
 * `assistant_messages` rows are both the transcript and the stream's event log.
 */
export const ASSISTANT_TURN_STATUSES = [
  'RUNNING',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'REJECTED',
  'TIMED_OUT',
  'FAILED',
  'CANCELLED',
] as const;
export type AssistantTurnStatus = (typeof ASSISTANT_TURN_STATUSES)[number];

/** A conversation may have at most one turn in these states (enforced by a partial unique index). */
export const ACTIVE_ASSISTANT_TURN_STATUSES = ['RUNNING', 'AWAITING_APPROVAL'] as const satisfies readonly AssistantTurnStatus[];

export const ASSISTANT_MESSAGE_ROLES = [
  'user',
  'assistant',
  'step',
  'tool_call',
  'tool_result',
  'approval',
  'status',
] as const;
export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number];

export const assistantPageContextSchema = z.object({
  entity: z.string().trim().min(1).max(50),
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().max(120).optional(),
});
export type AssistantPageContext = z.output<typeof assistantPageContextSchema>;

export const createAssistantConversationSchema = z.object({
  context: assistantPageContextSchema.nullish(),
});
export type CreateAssistantConversationPayload = z.output<typeof createAssistantConversationSchema>;

export const updateAssistantConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.archived !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateAssistantConversationPayload = z.output<typeof updateAssistantConversationSchema>;

export const sendAssistantMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  context: assistantPageContextSchema.nullish(),
});
export type SendAssistantMessagePayload = z.output<typeof sendAssistantMessageSchema>;

export const assistantApprovalSchema = z.object({
  approved: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type AssistantApprovalPayload = z.output<typeof assistantApprovalSchema>;

export interface AssistantPendingAction {
  tool: { id: string; name: string; args: Record<string, unknown> };
  preview: Record<string, unknown>;
}

export interface AssistantTurnDto {
  id: string;
  conversationId: string;
  status: AssistantTurnStatus;
  pendingAction: AssistantPendingAction | null;
  steps: number;
  model: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AssistantMessageDto {
  id: string;
  conversationId: string;
  turnId: string | null;
  /** Monotonic within a conversation; the SSE event id. */
  seq: number;
  role: AssistantMessageRole;
  content: string;
  toolName: string | null;
  /** For `status` rows: `{ turn: AssistantTurnDto }`. For `approval`: `AssistantPendingAction`. */
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AssistantConversationDto {
  id: string;
  title: string;
  context: AssistantPageContext | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AssistantConversationDetailDto extends AssistantConversationDto {
  messages: AssistantMessageDto[];
  activeTurn: AssistantTurnDto | null;
}
```

`packages/shared/src/index.ts` — add `export * from './assistant';` next to the other feature exports.

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter @saas/shared test && pnpm --filter @saas/shared build`
Expected: PASS (including the existing `catalog.spec.ts`, which checks every permission has a description), build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add assistant contract, permission and audit channel"
```

---

### Task 2: Channel skills — `channel_thread.read` and `channel_message.send`

**Files:**
- Create: `apps/api/src/modules/channels/services/skill-actor.service.ts`
- Create: `apps/api/src/modules/channels/skills/channel-contact.resolver.ts`
- Create: `apps/api/src/modules/channels/skills/channel-thread-read.skill.ts`
- Create: `apps/api/src/modules/channels/skills/channel-thread-read.skill.spec.ts`
- Create: `apps/api/src/modules/channels/skills/channel-message-send.skill.ts`
- Create: `apps/api/src/modules/channels/skills/channel-message-send.skill.spec.ts`
- Modify: `apps/api/src/modules/channels/skills/skill.registry.ts`
- Modify: `apps/api/src/modules/channels/skills/skill.registry.spec.ts`
- Modify: `apps/api/src/modules/channels/skills/tool-execution-policy.service.ts:11-17`
- Modify: `apps/api/src/modules/channels/skills/tool-execution-policy.service.spec.ts`
- Modify: `apps/api/src/modules/channels/channels.module.ts`

**Interfaces:**
- Consumes: `CHANNEL_SKILLS.CHANNEL_THREAD_READ`, `CHANNEL_SKILLS.CHANNEL_MESSAGE_SEND`, `PERMISSIONS.CHANNEL_READ`, `PERMISSIONS.CHANNEL_SEND` (Task 1 / existing).
- Produces:
  - `SkillActorService.forContext(ctx: { organizationId: string; userId: string }): Promise<AuthenticatedUser>`
  - `resolveContact(contacts: ContactsService, actor: AuthenticatedUser, term: string): Promise<SkillResolution<ContactDto>>`
  - `ChannelThreadReadSkill(contacts, actors, messages: Repository<ChannelMessage>)`
  - `ChannelMessageSendSkill(contacts, actors, messages: Repository<ChannelMessage>, channels: () => ChannelsService)`

**Why these shapes:** `ChannelsService` → `ChannelCommandService` → `SkillRegistry` is already a DI chain, so the registry cannot inject `ChannelsService`. Reads use the `ChannelMessage` repository directly; the send skill gets `ChannelsService` lazily through `ModuleRef` at execute time. Contacts are always resolved through `ContactsService` (its private `scoped()`), so `contact:read` vs `contact:read_all` applies; message queries are then filtered by that contact id **and** `organizationId`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/channels/skills/channel-thread-read.skill.spec.ts
import type { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { ChannelThreadReadSkill } from './channel-thread-read.skill';
import type { ContactsService } from '../../contacts/contacts.service';
import type { SkillActorService } from '../services/skill-actor.service';
import type { ChannelMessage } from '../entities/channel-message.entity';
import type { SkillContext } from './skill.types';

const ctx = { organizationId: 'org-1', userId: 'user-1', permissions: [], message: '' } as unknown as SkillContext;
const actor = { id: 'user-1', organizationId: 'org-1' } as any;
const acme = { id: 'c-1', fullName: 'Ada Acme', email: 'ada@acme.test', phone: '+971500000001' };

function build(listItems: unknown[], rows: unknown[] = []) {
  const contacts = {
    list: jest.fn().mockResolvedValue({ items: listItems, meta: { total: listItems.length } }),
    findOne: jest.fn().mockRejectedValue(new NotFoundException()),
  } as unknown as ContactsService;
  const actors = { forContext: jest.fn().mockResolvedValue(actor) } as unknown as SkillActorService;
  const messages = { find: jest.fn().mockResolvedValue(rows) } as unknown as Repository<ChannelMessage>;
  return { skill: new ChannelThreadReadSkill(contacts, actors, messages), contacts, messages };
}

describe('ChannelThreadReadSkill', () => {
  it('is a read-only tool gated on channel:read', () => {
    const { skill } = build([]);
    expect(skill.isMutating).toBe(false);
    expect(skill.requiredPermissions).toEqual(['channel:read']);
  });

  it('resolves the contact through the owner-scoped contacts service', async () => {
    const { skill, contacts } = build([acme]);
    const res = await skill.resolve({ contact: 'Acme' }, ctx);
    expect(contacts.list).toHaveBeenCalledWith(actor, expect.objectContaining({ search: 'Acme' }));
    expect(res).toEqual({ kind: 'resolved', value: { contact: acme, provider: undefined, limit: 20 } });
  });

  it('asks when the name is ambiguous', async () => {
    const { skill } = build([acme, { ...acme, id: 'c-2', fullName: 'Ada Acme Jr' }]);
    const res = await skill.resolve({ contact: 'Ada' }, ctx);
    expect(res.kind).toBe('question');
  });

  it('refuses when nothing visible matches (never leaks other owners contacts)', async () => {
    const { skill } = build([]);
    const res = await skill.resolve({ contact: 'Nobody' }, ctx);
    expect(res).toEqual({ kind: 'refused', reason: expect.stringContaining('Nobody') });
  });

  it('clamps limit to 50', async () => {
    const { skill } = build([acme]);
    const res = await skill.resolve({ contact: 'Acme', limit: 500 }, ctx);
    expect(res.kind === 'resolved' && res.value.limit).toBe(50);
  });

  it('reads messages for that contact in this tenant, oldest first in the reply', async () => {
    const rows = [
      { direction: 'INBOUND', provider: 'WHATSAPP_META', body: 'second', createdAt: new Date('2026-10-02') },
      { direction: 'OUTBOUND', provider: 'WHATSAPP_META', body: 'first', createdAt: new Date('2026-10-01') },
    ];
    const { skill, messages } = build([acme], rows);
    const outcome = await skill.execute({ contact: acme as any, provider: undefined, limit: 20 }, ctx);
    expect(messages.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', contactId: 'c-1' },
        take: 20,
      }),
    );
    expect(outcome.reply.indexOf('first')).toBeLessThan(outcome.reply.indexOf('second'));
    expect(outcome.resultType).toBe('CONTACT');
    expect(outcome.resultId).toBe('c-1');
  });
});
```

Check the `ChannelResultType` union in `packages/shared/src/channels/skills.ts` (lines ~20-30) contains `'CONTACT'`; if it does not, add `| 'CONTACT'` there in this task and rebuild shared.

```ts
// apps/api/src/modules/channels/skills/channel-message-send.skill.spec.ts
import type { Repository } from 'typeorm';
import { ChannelMessageSendSkill } from './channel-message-send.skill';
import { ToolExecutionPolicyService } from './tool-execution-policy.service';
import type { ContactsService } from '../../contacts/contacts.service';
import type { SkillActorService } from '../services/skill-actor.service';
import type { ChannelsService } from '../channels.service';
import type { ChannelMessage } from '../entities/channel-message.entity';
import type { SkillContext } from './skill.types';

const ctx = { organizationId: 'org-1', userId: 'user-1', permissions: [], message: '' } as unknown as SkillContext;
const acme = { id: 'c-1', fullName: 'Ada Acme', email: 'ada@acme.test', phone: '+971500000001' };

function build(lastMessage: unknown = null) {
  const contacts = {
    list: jest.fn().mockResolvedValue({ items: [acme], meta: { total: 1 } }),
    findOne: jest.fn(),
  } as unknown as ContactsService;
  const actors = { forContext: jest.fn().mockResolvedValue({ id: 'user-1' }) } as unknown as SkillActorService;
  const messages = { findOne: jest.fn().mockResolvedValue(lastMessage) } as unknown as Repository<ChannelMessage>;
  const channels = { sendMessage: jest.fn().mockResolvedValue({ id: 'm-9' }) } as unknown as ChannelsService;
  return { skill: new ChannelMessageSendSkill(contacts, actors, messages, () => channels), channels, messages };
}

describe('ChannelMessageSendSkill', () => {
  it('is mutating, gated on channel:send, and always needs approval', () => {
    const { skill } = build();
    expect(skill.isMutating).toBe(true);
    expect(skill.requiredPermissions).toEqual(['channel:send']);
    expect(new ToolExecutionPolicyService().evaluatePolicy(skill.name, true).requiresApproval).toBe(true);
  });

  it('replies to the chat id of the last Telegram message from the contact', async () => {
    const { skill } = build({ direction: 'INBOUND', sender: 'tg-chat-42', recipient: 'bot' });
    const res = await skill.resolve({ contact: 'Acme', provider: 'TELEGRAM', body: 'Hi' }, ctx);
    expect(res).toEqual({
      kind: 'resolved',
      value: { contact: acme, provider: 'TELEGRAM', recipient: 'tg-chat-42', body: 'Hi' },
    });
  });

  it('falls back to the contact phone for WhatsApp and email address for email', async () => {
    const { skill } = build(null);
    const wa = await skill.resolve({ contact: 'Acme', provider: 'WHATSAPP_META', body: 'Hi' }, ctx);
    expect(wa.kind === 'resolved' && wa.value.recipient).toBe('+971500000001');
    const em = await skill.resolve({ contact: 'Acme', provider: 'EMAIL_SMTP', body: 'Hi' }, ctx);
    expect(em.kind === 'resolved' && em.value.recipient).toBe('ada@acme.test');
  });

  it('refuses Telegram with no prior conversation', async () => {
    const { skill } = build(null);
    const res = await skill.resolve({ contact: 'Acme', provider: 'TELEGRAM', body: 'Hi' }, ctx);
    expect(res.kind).toBe('refused');
  });

  it('defaults the provider to the one last used with the contact', async () => {
    const { skill } = build({ direction: 'OUTBOUND', provider: 'WHATSAPP_META', sender: 'u', recipient: '+971500000001' });
    const res = await skill.resolve({ contact: 'Acme', body: 'Hi' }, ctx);
    expect(res.kind === 'resolved' && res.value.provider).toBe('WHATSAPP_META');
  });

  it('asks for the body when missing', async () => {
    const { skill } = build(null);
    const res = await skill.resolve({ contact: 'Acme', provider: 'EMAIL_SMTP' }, ctx);
    expect(res.kind).toBe('question');
  });

  it('previews recipient, provider and the full text', async () => {
    const { skill } = build();
    const preview = await skill.preview(
      { contact: acme as any, provider: 'EMAIL_SMTP' as any, recipient: 'ada@acme.test', body: 'Hello there' },
      ctx,
    );
    expect(preview).toContain('Ada Acme');
    expect(preview).toContain('ada@acme.test');
    expect(preview).toContain('Hello there');
  });

  it('sends through ChannelsService as the acting user', async () => {
    const { skill, channels } = build();
    const outcome = await skill.execute(
      { contact: acme as any, provider: 'EMAIL_SMTP' as any, recipient: 'ada@acme.test', body: 'Hello' },
      ctx,
    );
    expect(channels.sendMessage).toHaveBeenCalledWith('org-1', 'user-1', {
      contactId: 'c-1',
      provider: 'EMAIL_SMTP',
      recipient: 'ada@acme.test',
      body: 'Hello',
    });
    expect(outcome.resultId).toBe('m-9');
  });
});
```

Add to `tool-execution-policy.service.spec.ts`:

```ts
  it('always requires approval for channel_message.send', () => {
    const evaluation = new ToolExecutionPolicyService().evaluatePolicy('channel_message.send', true);
    expect(evaluation).toEqual({ isAutonomous: false, requiresApproval: true, actionClass: 'COMMIT_MUTATION' });
  });
```

Add to `skill.registry.spec.ts` (follow how the existing spec constructs the registry; pass the three new constructor args as `{} as any` mocks except where a test needs them):

```ts
  it('offers the send tool only to users holding channel:send (Review Focus #5)', () => {
    const names = (perms: string[]) => registry.permittedFor(perms as any).map((s) => s.name);
    expect(names(['channel:read'])).toContain('channel_thread.read');
    expect(names(['channel:read'])).not.toContain('channel_message.send');
    expect(names(['channel:read', 'channel:send'])).toContain('channel_message.send');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- channel-thread-read channel-message-send tool-execution-policy skill.registry`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/channels/services/skill-actor.service.ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { UsersService } from '@/modules/users/users.service';
import { RbacService } from '@/modules/rbac/rbac.service';

/**
 * The acting user, shaped like `req.user`, for skill code that runs outside an
 * HTTP request (a Temporal activity). Mirrors `JwtStrategy.validate` so owner-
 * scoped services (ContactsService.scoped) see exactly what the web app would.
 */
@Injectable()
export class SkillActorService {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: RbacService,
  ) {}

  async forContext(ctx: { organizationId: string; userId: string }): Promise<AuthenticatedUser> {
    const user = await this.users.findByIdForAuth(ctx.userId);
    if (!user || !user.isActive || user.tenantId !== ctx.organizationId) {
      throw new ForbiddenException('The acting user is not active in this organization');
    }
    const access = await this.rbac.resolveAccess(user.id, user.tenantId);
    return {
      id: user.id,
      organizationId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: access.roles,
      level: access.level,
      permissions: access.permissions,
      isOwner: access.isOwner,
      teamId: user.teamId ?? null,
      managerId: user.managerId ?? null,
    };
  }
}
```

```ts
// apps/api/src/modules/channels/skills/channel-contact.resolver.ts
import { NotFoundException } from '@nestjs/common';
import type { ContactDto, SkillResolution } from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { ContactsService } from '../../contacts/contacts.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Name, email, phone or id → one contact the actor may see. Goes through
 * ContactsService so the tenant and ownership filters apply; an invisible
 * contact is indistinguishable from a missing one.
 */
export async function resolveContact(
  contacts: ContactsService,
  actor: AuthenticatedUser,
  term: string,
): Promise<SkillResolution<ContactDto>> {
  const needle = term.trim();
  if (!needle) {
    return { kind: 'question', question: 'Which contact do you mean?', slots: {} };
  }
  if (UUID.test(needle)) {
    try {
      return { kind: 'resolved', value: await contacts.findOne(actor, needle) };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { kind: 'refused', reason: `No contact you can see has id ${needle}.` };
      }
      throw error;
    }
  }
  const { items } = await contacts.list(actor, {
    search: needle,
    page: 1,
    limit: 5,
    sortBy: 'updatedAt',
    sortOrder: 'DESC',
  });
  if (items.length === 0) {
    return { kind: 'refused', reason: `No contact you can see matches "${needle}".` };
  }
  if (items.length > 1) {
    const options = items.map((c) => `${c.fullName}${c.company ? ` (${c.company})` : ''}`).join(', ');
    return { kind: 'question', question: `Which contact: ${options}?`, slots: {} };
  }
  return { kind: 'resolved', value: items[0] };
}
```

Note: `phone` is not in `ContactsService.list`'s search columns. That is acceptable for v1 (name/email/company/id cover the assistant's use); do not widen the contacts search in this task.

```ts
// apps/api/src/modules/channels/skills/channel-thread-read.skill.ts
import { z } from 'zod';
import type { Repository } from 'typeorm';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type ContactDto,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import type { ContactsService } from '../../contacts/contacts.service';
import { ChannelProviderType } from '../entities/channel-config.entity';
import type { ChannelMessage } from '../entities/channel-message.entity';
import type { SkillActorService } from '../services/skill-actor.service';
import { resolveContact } from './channel-contact.resolver';
import type { ChannelSkill, SkillContext } from './skill.types';

const PROVIDERS = Object.values(ChannelProviderType) as [string, ...string[]];

const slotSchema = z.object({
  contact: z.string().optional(),
  provider: z.enum(PROVIDERS).optional(),
  limit: z.number().int().optional(),
});

export interface ResolvedThreadRead {
  contact: ContactDto;
  provider: ChannelProviderType | undefined;
  limit: number;
}

export class ChannelThreadReadSkill implements ChannelSkill<ResolvedThreadRead> {
  readonly name = CHANNEL_SKILLS.CHANNEL_THREAD_READ;
  readonly isMutating = false;
  readonly description =
    "Read the recent WhatsApp, Telegram or email messages exchanged with one contact. Use before summarising a conversation or drafting a reply.";
  readonly examples = [
    "show me Acme's last WhatsApp messages",
    'what did Ada say in her last email?',
    'summarise my conversation with Bilal',
  ];
  readonly requiredPermissions = [PERMISSIONS.CHANNEL_READ];
  readonly jsonSchema = {
    type: 'object',
    properties: {
      contact: { type: 'string', description: 'Contact name, email, company or id' },
      provider: { type: 'string', enum: PROVIDERS, description: 'Only this channel (optional)' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many recent messages (default 20)' },
    },
    required: ['contact'],
    additionalProperties: false,
  };
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'channel-thread-read/1';

  constructor(
    private readonly contacts: ContactsService,
    private readonly actors: SkillActorService,
    private readonly messages: Repository<ChannelMessage>,
  ) {}

  async resolve(slots: Record<string, unknown>, ctx: SkillContext): Promise<SkillResolution<ResolvedThreadRead>> {
    const parsed = slotSchema.safeParse(slots);
    const value = parsed.success ? parsed.data : {};
    const actor = await this.actors.forContext(ctx);
    const contact = await resolveContact(this.contacts, actor, value.contact ?? '');
    if (contact.kind !== 'resolved') return contact;
    return {
      kind: 'resolved',
      value: {
        contact: contact.value,
        provider: value.provider as ChannelProviderType | undefined,
        limit: Math.min(Math.max(value.limit ?? 20, 1), 50),
      },
    };
  }

  async preview(value: ResolvedThreadRead): Promise<string> {
    return `Read the last ${value.limit} messages with ${value.contact.fullName}?`;
  }

  async execute(value: ResolvedThreadRead, ctx: SkillContext): Promise<SkillOutcome> {
    const rows = await this.messages.find({
      where: {
        organizationId: ctx.organizationId,
        contactId: value.contact.id,
        ...(value.provider ? { provider: value.provider } : {}),
      },
      order: { createdAt: 'DESC' },
      take: value.limit,
    });
    if (rows.length === 0) {
      return { reply: `No channel messages with ${value.contact.fullName} yet.`, resultType: 'CONTACT', resultId: value.contact.id };
    }
    const lines = [...rows]
      .reverse()
      .map((m) => `[${m.createdAt.toISOString()}] ${m.direction === 'INBOUND' ? value.contact.fullName : 'Us'} via ${m.provider}: ${m.body}`);
    return {
      reply: `Messages with ${value.contact.fullName} (oldest first):\n${lines.join('\n')}`,
      resultType: 'CONTACT',
      resultId: value.contact.id,
    };
  }
}
```

In the spec test the `where` assertion has no `provider` key because the test passes `provider: undefined` — matches the spread above.

```ts
// apps/api/src/modules/channels/skills/channel-message-send.skill.ts
import { z } from 'zod';
import type { Repository } from 'typeorm';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type ContactDto,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import type { ContactsService } from '../../contacts/contacts.service';
import type { ChannelsService } from '../channels.service';
import { ChannelProviderType } from '../entities/channel-config.entity';
import type { ChannelMessage } from '../entities/channel-message.entity';
import type { SkillActorService } from '../services/skill-actor.service';
import { resolveContact } from './channel-contact.resolver';
import type { ChannelSkill, SkillContext } from './skill.types';

const PROVIDERS = Object.values(ChannelProviderType) as [string, ...string[]];

const slotSchema = z.object({
  contact: z.string().optional(),
  provider: z.enum(PROVIDERS).optional(),
  body: z.string().optional(),
});

export interface ResolvedSend {
  contact: ContactDto;
  provider: ChannelProviderType;
  recipient: string;
  body: string;
}

export class ChannelMessageSendSkill implements ChannelSkill<ResolvedSend> {
  readonly name = CHANNEL_SKILLS.CHANNEL_MESSAGE_SEND;
  readonly isMutating = true;
  readonly description =
    'Send a WhatsApp, Telegram or email message to one contact. Write the complete final message text in `body`. The user always sees and approves it before it is sent.';
  readonly examples = ['send it', 'reply to Ada on WhatsApp saying the samples ship Monday', 'email Acme the follow-up'];
  readonly requiredPermissions = [PERMISSIONS.CHANNEL_SEND];
  readonly jsonSchema = {
    type: 'object',
    properties: {
      contact: { type: 'string', description: 'Contact name, email, company or id' },
      provider: { type: 'string', enum: PROVIDERS, description: 'Channel; defaults to the one last used with this contact' },
      body: { type: 'string', description: 'The complete message text to send' },
    },
    required: ['contact', 'body'],
    additionalProperties: false,
  };
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'channel-message-send/1';

  constructor(
    private readonly contacts: ContactsService,
    private readonly actors: SkillActorService,
    private readonly messages: Repository<ChannelMessage>,
    private readonly channels: () => ChannelsService,
  ) {}

  async resolve(slots: Record<string, unknown>, ctx: SkillContext): Promise<SkillResolution<ResolvedSend>> {
    const parsed = slotSchema.safeParse(slots);
    const value = parsed.success ? parsed.data : {};
    const actor = await this.actors.forContext(ctx);
    const contact = await resolveContact(this.contacts, actor, value.contact ?? '');
    if (contact.kind !== 'resolved') return contact;

    const body = value.body?.trim();
    if (!body) {
      return { kind: 'question', question: `What should the message to ${contact.value.fullName} say?`, slots };
    }

    const last = await this.messages.findOne({
      where: {
        organizationId: ctx.organizationId,
        contactId: contact.value.id,
        ...(value.provider ? { provider: value.provider as ChannelProviderType } : {}),
      },
      order: { createdAt: 'DESC' },
    });
    const provider = (value.provider as ChannelProviderType | undefined) ?? last?.provider;
    if (!provider) {
      return {
        kind: 'question',
        question: `Which channel should I use for ${contact.value.fullName}: WhatsApp, Telegram or email?`,
        slots,
      };
    }

    const fromHistory = last ? (last.direction === 'INBOUND' ? last.sender : last.recipient) : null;
    const recipient =
      fromHistory ??
      (provider === ChannelProviderType.WHATSAPP_META
        ? contact.value.phone
        : provider === ChannelProviderType.EMAIL_SMTP || provider === ChannelProviderType.EMAIL_RESEND
          ? contact.value.email
          : null);
    if (!recipient) {
      return {
        kind: 'refused',
        reason: `I don't have a ${provider} address for ${contact.value.fullName}. They need to message us there first.`,
      };
    }
    return { kind: 'resolved', value: { contact: contact.value, provider, recipient, body } };
  }

  async preview(value: ResolvedSend): Promise<string> {
    return `Send to ${value.contact.fullName} (${value.recipient}) via ${value.provider}:\n\n${value.body}`;
  }

  async execute(value: ResolvedSend, ctx: SkillContext): Promise<SkillOutcome> {
    const message = await this.channels().sendMessage(ctx.organizationId, ctx.userId, {
      contactId: value.contact.id,
      provider: value.provider,
      recipient: value.recipient,
      body: value.body,
    });
    return {
      reply: `Sent to ${value.contact.fullName} via ${value.provider}.`,
      resultType: 'CONTACT',
      resultId: message.id,
    };
  }
}
```

Note on the test "replies to the chat id of the last Telegram message": the mock `findOne` row has no `provider`, but `value.provider` is `TELEGRAM` so `provider` comes from the slot. Correct.

`tool-execution-policy.service.ts` — add `'channel_message.send'` to `ALWAYS_REQUIRE_APPROVAL`.

`skill.registry.ts` — constructor gains three dependencies and two skills:

```ts
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ChannelMessage } from '../entities/channel-message.entity';
import { ChannelsService } from '../channels.service';
import { SkillActorService } from '../services/skill-actor.service';
import { ChannelThreadReadSkill } from './channel-thread-read.skill';
import { ChannelMessageSendSkill } from './channel-message-send.skill';
// ...
  constructor(
    // existing params unchanged ...
    contacts: ContactsService,
    actors: SkillActorService,
    @InjectRepository(ChannelMessage) channelMessages: Repository<ChannelMessage>,
    moduleRef: ModuleRef,
  ) {
    // ChannelsService depends (via ChannelCommandService) on this registry, so
    // it is looked up when a send executes, never at construction.
    const channels = () => moduleRef.get(ChannelsService, { strict: false });
    this.skills = [
      // existing skills unchanged ...
      new ChannelThreadReadSkill(contacts, actors, channelMessages) as unknown as ChannelSkill<never>,
      new ChannelMessageSendSkill(contacts, actors, channelMessages, channels) as unknown as ChannelSkill<never>,
    ];
  }
```

`channels.module.ts` — import `UsersModule` (`@/modules/users/users.module`), add `SkillActorService` to `providers` and `exports`. Confirm `RbacService` is already injectable here (it is used by `ChannelCommandService`); if Nest reports it missing, import `RbacModule` as well.

Update the existing `skill.registry.spec.ts` construction to pass the three new args (`{} as any, {} as any, {} as any`).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test -- channels/skills`
Expected: PASS, including all pre-existing skill specs.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels packages/shared/src/channels
git commit -m "feat(channels): add channel thread read and send skills for the assistant"
```

---

### Task 3: Workflow — history, page context, event sink, audit provenance

**Files:**
- Modify: `apps/api/src/modules/channels/workflows/activities/agent-react.activities.ts`
- Modify: `apps/api/src/modules/channels/workflows/activities/agent-react.activities.impl.ts:22-27, 260-410`
- Modify: `apps/api/src/modules/channels/workflows/activities/agent-react.activities.impl.spec.ts`
- Modify: `apps/api/src/modules/channels/workflows/agent-react.workflow.ts`
- Modify: `apps/api/src/modules/channels/workflows/agent-react.workflow.spec.ts`

**Interfaces — Produces** (in `agent-react.activities.ts`):

```ts
import type { AssistantMessageRole, AssistantPendingAction, AssistantTurnStatus, AuditChannel } from '@saas/shared';

export interface ToolAuditProvenance {
  channel: AuditChannel;
  messageId?: string;
}

export interface AgentActivityCtx {
  organizationId: string;
  userId: string;
  message: string;
  audit?: ToolAuditProvenance;
}

export interface AssistantEventInput {
  organizationId: string;
  conversationId: string;
  turnId: string;
  /** Deterministic per workflow step; (turnId, eventKey) is unique so retries are no-ops. */
  eventKey: string;
  role: Exclude<AssistantMessageRole, 'user'>;
  content: string;
  toolName?: string;
  payload?: Record<string, unknown>;
  /** When set, the turn row is updated in the same transaction and a `status` row is also written. */
  turn?: {
    status?: AssistantTurnStatus;
    pendingAction?: AssistantPendingAction | null;
    steps?: number;
    model?: string;
    error?: string;
  };
}
```

`AgentReactActivities.executeToolActivity` / `commitToolMutationActivity` take `ctx: AgentActivityCtx`; new method `emitAssistantEventActivity(input: AssistantEventInput): Promise<void>`.

`AgentReActWorkflowInput` gains:

```ts
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pageContext?: { entity: string; id: string; label?: string };
  eventSink?: { conversationId: string; turnId: string };
  audit?: ToolAuditProvenance;
```

- [ ] **Step 1: Write the failing tests**

In `agent-react.workflow.spec.ts`: add `emitAssistantEventActivity: jest.fn()` to `mockActivities`, add it to the mocked `proxyActivities` return, and add `isCancellation: (e: unknown) => (e as any)?.name === 'CancelledFailure'` to the `@temporalio/workflow` mock. In `beforeEach`, `mockActivities.emitAssistantEventActivity.mockResolvedValue(undefined)`. Then add:

```ts
describe('assistant event sink', () => {
  const base = {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    prompt: 'send Ada the update',
    eventSink: { conversationId: 'conv-1', turnId: 'turn-1' },
    audit: { channel: 'ASSISTANT' as const, messageId: 'msg-user-1' },
  };

  it('passes history and page context to the planner', async () => {
    mockActivities.planReActTurn.mockResolvedValueOnce({ thought: '', finalAnswer: 'ok' });
    await agentReActWorkflow({
      ...base,
      history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }],
      pageContext: { entity: 'quote', id: 'q-1', label: 'Q-1042' },
    });
    const call = mockActivities.planReActTurn.mock.calls[0][0];
    expect(call.conversationHistory.slice(0, 2)).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(call.prompt).toContain('quote Q-1042 (id q-1)');
  });

  it('emits tool_call, tool_result and a final assistant message with COMPLETED', async () => {
    mockActivities.planReActTurn
      .mockResolvedValueOnce({ thought: 'look it up', toolCalls: [{ id: 'c1', name: 'channel_thread.read', args: { contact: 'Ada' } }] })
      .mockResolvedValueOnce({ thought: '', finalAnswer: 'Ada asked about samples.' });
    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'c1', toolName: 'channel_thread.read', isMutating: false, requiresApproval: false,
      output: { reply: 'Messages with Ada…' },
    });
    await agentReActWorkflow(base);
    const events = mockActivities.emitAssistantEventActivity.mock.calls.map((c) => c[0]);
    expect(events.map((e) => [e.eventKey, e.role])).toEqual([
      ['t1:thought', 'step'],
      ['t1:call:c1', 'tool_call'],
      ['t1:result:c1', 'tool_result'],
      ['final', 'assistant'],
    ]);
    expect(events.at(-1)).toMatchObject({ content: 'Ada asked about samples.', turn: { status: 'COMPLETED', steps: 2 } });
    expect(mockActivities.executeToolActivity.mock.calls[0][1]).toMatchObject({ audit: base.audit });
  });

  it('emits an approval event with the pending action, then commits with provenance after approval', async () => {
    mockActivities.planReActTurn
      .mockResolvedValueOnce({ thought: '', toolCalls: [{ id: 'c2', name: 'channel_message.send', args: { body: 'Hi' } }] })
      .mockResolvedValueOnce({ thought: '', finalAnswer: 'Sent.' });
    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'c2', toolName: 'channel_message.send', isMutating: true, requiresApproval: true,
      previewPayload: { summary: 'Send to Ada…' },
    });
    mockActivities.commitToolMutationActivity.mockResolvedValueOnce({ success: true, resultSummary: 'Sent to Ada.' });
    mockConditionImpl = async () => {
      mockHandlers.get(approvalSignal)!({ approved: true });
      return true;
    };
    await agentReActWorkflow(base);
    const events = mockActivities.emitAssistantEventActivity.mock.calls.map((c) => c[0]);
    const approval = events.find((e) => e.role === 'approval');
    expect(approval).toMatchObject({
      eventKey: 't1:approval:c2',
      turn: { status: 'AWAITING_APPROVAL', pendingAction: { tool: { id: 'c2', name: 'channel_message.send' }, preview: { summary: 'Send to Ada…' } } },
    });
    expect(events.find((e) => e.eventKey === 't1:approved:c2')).toMatchObject({ turn: { status: 'RUNNING', pendingAction: null } });
    expect(mockActivities.commitToolMutationActivity.mock.calls[0][1]).toMatchObject({ audit: base.audit });
  });

  it('ends REJECTED with a final event when the user rejects', async () => {
    mockActivities.planReActTurn.mockResolvedValueOnce({ thought: '', toolCalls: [{ id: 'c3', name: 'channel_message.send', args: {} }] });
    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'c3', toolName: 'channel_message.send', isMutating: true, requiresApproval: true, previewPayload: {},
    });
    mockConditionImpl = async () => {
      mockHandlers.get(approvalSignal)!({ approved: false, note: 'wrong tone' });
      return true;
    };
    const result = await agentReActWorkflow(base);
    expect(result.status).toBe('REJECTED');
    const last = mockActivities.emitAssistantEventActivity.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ eventKey: 'final', role: 'assistant', turn: { status: 'REJECTED', pendingAction: null } });
  });

  it('ends TIMED_OUT with a final event when nobody answers', async () => {
    mockActivities.planReActTurn.mockResolvedValueOnce({ thought: '', toolCalls: [{ id: 'c4', name: 'channel_message.send', args: {} }] });
    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'c4', toolName: 'channel_message.send', isMutating: true, requiresApproval: true, previewPayload: {},
    });
    mockConditionImpl = async () => false;
    const result = await agentReActWorkflow({ ...base, approvalTimeout: '24 hours' });
    expect(result.status).toBe('TIMED_OUT');
    expect(mockActivities.emitAssistantEventActivity.mock.calls.at(-1)![0]).toMatchObject({ turn: { status: 'TIMED_OUT' } });
  });

  it('records FAILED and returns (does not throw) when an activity fails', async () => {
    mockActivities.planReActTurn.mockRejectedValueOnce(new Error('AI budget exceeded'));
    const result = await agentReActWorkflow(base);
    expect(result.status).toBe('FAILED');
    expect(mockActivities.emitAssistantEventActivity.mock.calls.at(-1)![0]).toMatchObject({
      eventKey: 'final', turn: { status: 'FAILED', error: 'AI budget exceeded' },
    });
  });

  it('emits nothing and still throws on activity failure without a sink (automation path unchanged)', async () => {
    mockActivities.planReActTurn.mockRejectedValueOnce(new Error('boom'));
    await expect(
      agentReActWorkflow({ organizationId: 'o', userId: 'u', conversationId: 'c', prompt: 'p' }),
    ).rejects.toThrow('boom');
    expect(mockActivities.emitAssistantEventActivity).not.toHaveBeenCalled();
  });
});
```

In `agent-react.activities.impl.spec.ts`, add to the commit tests (reuse that spec's existing setup that builds deps with mocked `auditService.record`):

```ts
  it('records assistant provenance on committed mutations', async () => {
    // arrange a resolvable mutating skill exactly as the existing "commits mutation" test does, then:
    await activities.commitToolMutationActivity(tool, {
      organizationId: 'org-1', userId: 'user-1', message: 'm',
      audit: { channel: 'ASSISTANT', messageId: 'msg-1' },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'AI_ASSISTED', channel: 'ASSISTANT', messageId: 'msg-1' }),
    );
  });

  it('keeps SYSTEM provenance when no audit context is given', async () => {
    await activities.commitToolMutationActivity(tool, { organizationId: 'org-1', userId: 'user-1', message: 'm' });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ channel: 'SYSTEM', messageId: null }));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- agent-react`
Expected: new tests FAIL (no events emitted, `audit` not forwarded); existing tests PASS.

- [ ] **Step 3: Implement**

`agent-react.activities.ts`: add the types from **Interfaces** above, change both ctx parameter types to `AgentActivityCtx`, and add to `AgentReactActivities`:

```ts
  /** Registered only on assistant-queue; called only when the workflow has an eventSink. */
  emitAssistantEventActivity(input: AssistantEventInput): Promise<void>;
```

`agent-react.activities.impl.ts`:
- Replace the local `AgentActivityContext` type with `AgentActivityCtx` imported from `./agent-react.activities`.
- The factory's declared return type becomes `Omit<AgentReactActivities, 'emitAssistantEventActivity'>` (the assistant module provides that one; see Task 5).
- In both `auditService.record` calls inside `commitToolMutationActivity`, replace `channel: 'SYSTEM',` with:

```ts
            channel: ctx.audit?.channel ?? 'SYSTEM',
            messageId: ctx.audit?.messageId ?? null,
```

`agent-react.workflow.ts` — full replacement of `agentReActWorkflow` (keep imports, proxies, `approvalSignal`, `approvalTimeoutToMilliseconds` and `agentApprovalRequestedSignal` as they are; add `isCancellation` to the `@temporalio/workflow` import and `AssistantEventInput`, `ToolAuditProvenance` to the type import):

```ts
export interface AgentReActWorkflowInput {
  organizationId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  parentWorkflowId?: string;
  automationNodeId?: string;
  autoApprove?: boolean;
  allowedDomains?: string[];
  approvalTimeout?: string;
  maxTurns?: number;
  /** Earlier user/assistant messages of an in-app conversation, oldest first. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** What the user was looking at. A hint for the planner — tools still check access. */
  pageContext?: { entity: string; id: string; label?: string };
  /** Present for in-app assistant turns: every step is reported through emitAssistantEventActivity. */
  eventSink?: { conversationId: string; turnId: string };
  /** Provenance recorded on committed mutations. Defaults to SYSTEM. */
  audit?: ToolAuditProvenance;
}

function goalWithContext(input: AgentReActWorkflowInput): string {
  if (!input.pageContext) return input.prompt;
  const { entity, id, label } = input.pageContext;
  return `${input.prompt}\n\n(The user is currently viewing ${entity} ${label ?? id} (id ${id}).)`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
}

export async function agentReActWorkflow(
  input: AgentReActWorkflowInput,
): Promise<AgentReActWorkflowOutput> {
  const emit = async (event: Omit<AssistantEventInput, 'organizationId' | 'conversationId' | 'turnId'>) => {
    if (!input.eventSink) return;
    await activities.emitAssistantEventActivity({
      organizationId: input.organizationId,
      conversationId: input.eventSink.conversationId,
      turnId: input.eventSink.turnId,
      ...event,
    });
  };

  let result: AgentReActWorkflowOutput;
  try {
    result = await runAgentLoop(input, emit);
  } catch (error) {
    if (!input.eventSink || isCancellation(error)) throw error;
    result = { status: 'FAILED', finalResponse: 'Something went wrong while working on that.', stepsExecuted: 0 };
    await emit({
      eventKey: 'final',
      role: 'assistant',
      content: result.finalResponse,
      turn: { status: 'FAILED', pendingAction: null, error: errorMessage(error) },
    });
    return result;
  }
  await emit({
    eventKey: 'final',
    role: 'assistant',
    content: result.finalResponse,
    turn: { status: result.status, pendingAction: null, steps: result.stepsExecuted },
  });
  return result;
}

type Emit = (event: Omit<AssistantEventInput, 'organizationId' | 'conversationId' | 'turnId'>) => Promise<void>;

async function runAgentLoop(
  input: AgentReActWorkflowInput,
  emit: Emit,
): Promise<AgentReActWorkflowOutput> {
  const maxTurns = input.maxTurns ?? 6;
  let turns = 0;
  let isDone = false;
  let finalResponse = '';
  const goal = goalWithContext(input);
  const toolCtx = {
    organizationId: input.organizationId,
    userId: input.userId,
    message: input.prompt,
    ...(input.audit ? { audit: input.audit } : {}),
  };

  const approvalQueue: Array<{ approved: boolean; note?: string }> = [];
  setHandler(approvalSignal, (signal) => {
    if (signal.approved && approvalQueue.length === 0) {
      approvalQueue.push(signal);
    } else if (!signal.approved) {
      approvalQueue.splice(0, approvalQueue.length, signal);
    }
  });

  const history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = [
    ...(input.history ?? []),
    { role: 'user', content: goal },
  ];

  while (!isDone && turns < maxTurns) {
    turns++;
    const availableTools = await activities.listAvailableTools({
      organizationId: input.organizationId,
      userId: input.userId,
      allowedDomains: input.allowedDomains,
    });

    const turn = await activities.planReActTurn({
      organizationId: input.organizationId,
      userId: input.userId,
      prompt: goal,
      conversationHistory: history,
      availableTools,
    });
    if (turn.thought) {
      await emit({ eventKey: `t${turns}:thought`, role: 'step', content: turn.thought, turn: { steps: turns, ...(turn.model ? { model: turn.model } : {}) } });
    }

    if (turn.finalAnswer && (!turn.toolCalls || turn.toolCalls.length === 0)) {
      finalResponse = turn.finalAnswer;
      isDone = true;
      break;
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const plannedTool of turn.toolCalls) {
        const tool = turn.model ? { ...plannedTool, model: turn.model } : plannedTool;
        await emit({
          eventKey: `t${turns}:call:${tool.id}`,
          role: 'tool_call',
          content: `Using ${tool.name}`,
          toolName: tool.name,
          payload: { args: tool.args },
        });
        const execution = await activities.executeToolActivity(tool, toolCtx);

        if (execution.requiresApproval && execution.isMutating) {
          if (!input.autoApprove) {
            if (input.parentWorkflowId && input.automationNodeId) {
              await getExternalWorkflowHandle(input.parentWorkflowId).signal(
                agentApprovalRequestedSignal,
                { nodeId: input.automationNodeId, tool, preview: execution.previewPayload ?? {} },
              );
            }
            const pendingAction = {
              tool: { id: tool.id, name: tool.name, args: tool.args },
              preview: execution.previewPayload ?? {},
            };
            await emit({
              eventKey: `t${turns}:approval:${tool.id}`,
              role: 'approval',
              content: typeof pendingAction.preview.summary === 'string' ? pendingAction.preview.summary : `Approve ${tool.name}?`,
              toolName: tool.name,
              payload: pendingAction,
              turn: { status: 'AWAITING_APPROVAL', pendingAction },
            });

            const approved = await condition(
              () => approvalQueue.length > 0,
              approvalTimeoutToMilliseconds(input.approvalTimeout),
            );
            const currentApproval = approvalQueue.shift();
            if (!approved) {
              return { status: 'TIMED_OUT', finalResponse: `Approval for ${tool.name} timed out.`, stepsExecuted: turns };
            }
            if (!currentApproval?.approved) {
              return {
                status: 'REJECTED',
                finalResponse: currentApproval?.note
                  ? `Action ${tool.name} was rejected: ${currentApproval.note}`
                  : `Action ${tool.name} was rejected or approval timed out.`,
                stepsExecuted: turns,
              };
            }
            await emit({
              eventKey: `t${turns}:approved:${tool.id}`,
              role: 'step',
              content: `Approved ${tool.name}`,
              toolName: tool.name,
              turn: { status: 'RUNNING', pendingAction: null },
            });
          }

          const commit = await commitActivities.commitToolMutationActivity(tool, toolCtx);
          await emit({
            eventKey: `t${turns}:result:${tool.id}`,
            role: 'tool_result',
            content: commit.resultSummary,
            toolName: tool.name,
            payload: commit,
          });
          history.push({ role: 'tool', content: JSON.stringify(commit) });
        } else {
          const output = execution.output ?? { error: execution.errorMessage };
          const reply = typeof output.reply === 'string' ? output.reply : typeof output.error === 'string' ? output.error : `${tool.name} finished`;
          await emit({
            eventKey: `t${turns}:result:${tool.id}`,
            role: 'tool_result',
            content: reply,
            toolName: tool.name,
            payload: output,
          });
          history.push({ role: 'tool', content: JSON.stringify(output) });
        }
      }
    }
  }

  return {
    status: isDone ? 'COMPLETED' : 'FAILED',
    finalResponse: finalResponse || `Agent stopped after reaching the ${maxTurns}-turn limit without a final answer.`,
    stepsExecuted: turns,
  };
}
```

Behaviour check for the automation path: `emit` is a no-op without `eventSink`; `goal === prompt` without `pageContext`; `history` starts with the same single user message; `toolCtx` equals the old ctx object; activity errors still propagate. The old test expecting `executeToolActivity` to be called with `{organizationId, userId, message}` still passes because `audit` is only spread in when present.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test -- agent-react`
Expected: PASS (old and new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels/workflows
git commit -m "feat(channels): report agent steps to an assistant event sink with audit provenance"
```

---

### Task 4: Assistant entities and migration

**Files:**
- Create: `apps/api/src/modules/assistant/entities/assistant-conversation.entity.ts`
- Create: `apps/api/src/modules/assistant/entities/assistant-turn.entity.ts`
- Create: `apps/api/src/modules/assistant/entities/assistant-message.entity.ts`
- Create: `apps/api/src/modules/assistant/assistant.module.ts` (skeleton, `TypeOrmModule.forFeature` only)
- Modify: `apps/api/src/feature-modules.ts` (add `AssistantModule` to both `FEATURE_MODULES` and `WORKER_FEATURE_MODULES` — the worker needs it for `AssistantEventsService`)
- Create: `apps/api/src/database/migrations/<generated-ts>-AssistantChat.ts`

**Interfaces — Produces:** entity classes `AssistantConversation`, `AssistantTurn`, `AssistantMessage` with the property names below (later tasks use them verbatim).

- [ ] **Step 1: Write the entities**

```ts
// assistant-conversation.entity.ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { AssistantPageContext } from '@saas/shared';

/** One user's private chat with the in-app assistant. */
@Entity('assistant_conversations')
@Index('idx_assistant_conversations_owner_recent', ['tenantId', 'userId', 'updatedAt'])
export class AssistantConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 200, default: 'New chat' })
  title: string;

  @Column({ type: 'jsonb', nullable: true })
  context: AssistantPageContext | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
}
```

```ts
// assistant-turn.entity.ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AssistantPendingAction, AssistantTurnStatus } from '@saas/shared';

/** One agentReActWorkflow run, started by one user message. */
@Entity('assistant_turns')
@Index('uq_assistant_turns_one_active_per_conversation', ['conversationId'], {
  unique: true,
  where: `"status" IN ('RUNNING', 'AWAITING_APPROVAL')`,
})
export class AssistantTurn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'user_message_id', type: 'uuid', nullable: true })
  userMessageId: string | null;

  @Column({ name: 'workflow_id', type: 'varchar', length: 200 })
  workflowId: string;

  @Column({ type: 'varchar', length: 20, default: 'RUNNING' })
  status: AssistantTurnStatus;

  @Column({ name: 'pending_action', type: 'jsonb', nullable: true })
  pendingAction: AssistantPendingAction | null;

  @Column({ type: 'int', default: 0 })
  steps: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'last_progress_at', type: 'timestamptz', default: () => 'now()' })
  lastProgressAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
```

```ts
// assistant-message.entity.ts
import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AssistantMessageRole } from '@saas/shared';

/** Transcript row and stream event. Ordered by `seq`, which is the SSE event id. */
@Entity('assistant_messages')
@Index('idx_assistant_messages_conversation_seq', ['conversationId', 'seq'])
@Index('uq_assistant_messages_turn_event', ['turnId', 'eventKey'], { unique: true })
export class AssistantMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'turn_id', type: 'uuid', nullable: true })
  turnId: string | null;

  @Column({ name: 'event_key', type: 'varchar', length: 200, nullable: true })
  eventKey: string | null;

  /** bigint arrives from pg as a string; convert with Number() at the DTO boundary. */
  @Column({ type: 'bigint' })
  @Generated('increment')
  seq: string;

  @Column({ type: 'varchar', length: 16 })
  role: AssistantMessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'tool_name', type: 'varchar', length: 120, nullable: true })
  toolName: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

```ts
// assistant.module.ts (skeleton; Task 6 fills it in)
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssistantConversation } from './entities/assistant-conversation.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantMessage } from './entities/assistant-message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AssistantConversation, AssistantTurn, AssistantMessage])],
})
export class AssistantModule {}
```

Register `AssistantModule` in `feature-modules.ts` (import + append to both arrays; in `WORKER_FEATURE_MODULES` add a comment `// assistant turns report their steps through AssistantEventsService`).

- [ ] **Step 2: Generate the migration**

Run (DB up and migrated): `pnpm migration:generate AssistantChat`
Expected: a new file under `apps/api/src/database/migrations/` creating the three tables, the indexes (including the partial unique one) and a sequence for `seq`.

- [ ] **Step 3: Add what the generator does not emit**

Append to `up()` (after the generated statements) — foreign keys, the role CHECK, and RLS for all three tables:

```ts
    await queryRunner.query(`ALTER TABLE "assistant_conversations" ADD CONSTRAINT "FK_assistant_conversations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "assistant_conversations" ADD CONSTRAINT "FK_assistant_conversations_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "assistant_turns" ADD CONSTRAINT "FK_assistant_turns_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "assistant_turns" ADD CONSTRAINT "FK_assistant_turns_conversation" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "assistant_turns" ADD CONSTRAINT "chk_assistant_turns_status" CHECK ("status" IN ('RUNNING','AWAITING_APPROVAL','COMPLETED','REJECTED','TIMED_OUT','FAILED','CANCELLED'))`);
    await queryRunner.query(`ALTER TABLE "assistant_messages" ADD CONSTRAINT "FK_assistant_messages_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "assistant_messages" ADD CONSTRAINT "FK_assistant_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "assistant_messages" ADD CONSTRAINT "FK_assistant_messages_turn" FOREIGN KEY ("turn_id") REFERENCES "assistant_turns"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "assistant_messages" ADD CONSTRAINT "chk_assistant_messages_role" CHECK ("role" IN ('user','assistant','step','tool_call','tool_result','approval','status'))`);

    for (const table of ['assistant_conversations', 'assistant_turns', 'assistant_messages']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}"`);
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
      );
    }
```

Check the name of the users table with `grep -n "@Entity(" apps/api/src/modules/users/entities/user.entity.ts` and use it in the FK. Ensure `down()` drops the three tables (messages, turns, conversations — in that order) and the sequence if the generator created one separately. Add a header comment to the migration in the style of `1789400000000-ChannelIdempotency.ts` explaining the three tables.

- [ ] **Step 4: Verify schema**

Run: `pnpm migration:run && pnpm migration:generate Probe`
Expected: "No changes in database schema were found" (no file created). If a file is created, fix the entity/migration mismatch and delete the probe file.

Run: `pnpm check:drift`
Expected: PASS with no baseline change.

Run: `pnpm --filter api build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/assistant apps/api/src/database/migrations apps/api/src/feature-modules.ts
git commit -m "feat(assistant): add conversation, turn and message tables with RLS"
```

---

### Task 5: Event writer, Redis nudge, worker activity and queue

**Files:**
- Create: `apps/api/src/modules/assistant/assistant-redis.ts`
- Create: `apps/api/src/modules/assistant/assistant-mappers.ts`
- Create: `apps/api/src/modules/assistant/assistant-events.service.ts`
- Create: `apps/api/src/modules/assistant/assistant-events.service.spec.ts`
- Create: `apps/api/src/modules/assistant/assistant.activities.ts`
- Modify: `apps/api/src/modules/assistant/assistant.module.ts`
- Modify: `apps/api/src/temporal-worker.ts`

**Interfaces:**
- Consumes: `AssistantEventInput` (Task 3), entities (Task 4).
- Produces:
  - `ASSISTANT_REDIS_PUBLISHER`, `ASSISTANT_REDIS_SUBSCRIBER` (DI tokens), `assistantChannel(conversationId: string): string` → `assistant:conv:<id>`
  - `toMessageDto(row: AssistantMessage): AssistantMessageDto`, `toTurnDto(row: AssistantTurn): AssistantTurnDto`, `toConversationDto(row: AssistantConversation): AssistantConversationDto`
  - `AssistantEventsService.emit(input: AssistantEventInput): Promise<void>`
  - `AssistantEventsService.writeStatus(turn: AssistantTurn, eventKey: string): Promise<void>` (used by the API for cancel / sweep)
  - `AssistantEventsService.publish(conversationId: string): void`
  - `createAssistantActivities(deps: { events: AssistantEventsService; tenantContext: TenantContextService }): { emitAssistantEventActivity(input: AssistantEventInput): Promise<void> }`

- [ ] **Step 1: Write the failing test**

Use a mocked `DataSource.transaction` that hands a fake `EntityManager`:

```ts
// assistant-events.service.spec.ts
import { AssistantEventsService } from './assistant-events.service';

function setup(turnRow: Record<string, unknown> = {}) {
  const inserted: any[] = [];
  const updates: any[] = [];
  const turn = {
    id: 'turn-1', tenantId: 'org-1', conversationId: 'conv-1', status: 'RUNNING', pendingAction: null,
    steps: 0, model: null, error: null, createdAt: new Date('2026-10-14'), finishedAt: null, ...turnRow,
  };
  const qb = {
    insert: () => qb, into: () => qb, values: (v: any) => { inserted.push(v); return qb; },
    orIgnore: () => qb, execute: async () => ({}),
  };
  const manager = {
    createQueryBuilder: () => qb,
    update: jest.fn(async (_e: unknown, where: unknown, patch: unknown) => { updates.push({ where, patch }); Object.assign(turn, patch); }),
    findOneByOrFail: jest.fn(async () => turn),
  };
  const dataSource = { transaction: (fn: any) => fn(manager) } as any;
  const redis = { publish: jest.fn().mockResolvedValue(1) } as any;
  return { service: new AssistantEventsService(dataSource, redis), inserted, updates, redis, turn };
}

describe('AssistantEventsService.emit', () => {
  const base = { organizationId: 'org-1', conversationId: 'conv-1', turnId: 'turn-1' };

  it('inserts an idempotent row keyed by (turn, eventKey) and nudges the conversation channel', async () => {
    const { service, inserted, redis } = setup();
    await service.emit({ ...base, eventKey: 't1:call:c1', role: 'tool_call', content: 'Using x', toolName: 'x', payload: { args: {} } });
    expect(inserted[0]).toMatchObject({
      tenantId: 'org-1', conversationId: 'conv-1', turnId: 'turn-1', eventKey: 't1:call:c1', role: 'tool_call', toolName: 'x',
    });
    expect(redis.publish).toHaveBeenCalledWith('assistant:conv:conv-1', expect.any(String));
  });

  it('bumps last_progress_at on every event, even without a state change', async () => {
    const { service, updates } = setup();
    await service.emit({ ...base, eventKey: 't1:call:c1', role: 'tool_call', content: 'Using x' });
    expect(updates[0].patch).toEqual({ lastProgressAt: expect.any(Date) });
  });

  it('updates the turn and writes a status row carrying the turn when turn state changes', async () => {
    const { service, inserted, updates } = setup();
    await service.emit({
      ...base, eventKey: 'final', role: 'assistant', content: 'Done', turn: { status: 'COMPLETED', pendingAction: null, steps: 2 },
    });
    expect(updates[0].patch).toMatchObject({ status: 'COMPLETED', pendingAction: null, steps: 2, finishedAt: expect.any(Date), lastProgressAt: expect.any(Date) });
    const status = inserted.find((row) => row.role === 'status');
    expect(status).toMatchObject({ eventKey: 'final:status', payload: { turn: expect.objectContaining({ id: 'turn-1', status: 'COMPLETED' }) } });
  });

  it('does not touch a turn that was already cancelled', async () => {
    const { service, updates, inserted } = setup({ status: 'CANCELLED' });
    await service.emit({ ...base, eventKey: 't2:thought', role: 'step', content: 'late', turn: { steps: 2 } });
    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('swallows Redis failures (the poll fallback delivers the event)', async () => {
    const { service, redis } = setup();
    redis.publish.mockRejectedValueOnce(new Error('down'));
    await expect(service.emit({ ...base, eventKey: 'k', role: 'step', content: 'x' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test -- assistant-events`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// assistant-redis.ts
import Redis from 'ioredis';

export const ASSISTANT_REDIS_PUBLISHER = 'ASSISTANT_REDIS_PUBLISHER';
export const ASSISTANT_REDIS_SUBSCRIBER = 'ASSISTANT_REDIS_SUBSCRIBER';

export const assistantChannel = (conversationId: string) => `assistant:conv:${conversationId}`;

/** Same connection settings as AiModule's budget guard. A subscriber needs its own connection. */
export function createAssistantRedis(): Redis {
  const host = process.env.REDIS_HOST ?? 'localhost';
  const port = process.env.REDIS_PORT ?? '6380';
  const redis = new Redis(process.env.REDIS_URL ?? `redis://${host}:${port}`, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  redis.on('error', () => undefined);
  return redis;
}
```

```ts
// assistant-mappers.ts
import type { AssistantConversationDto, AssistantMessageDto, AssistantTurnDto } from '@saas/shared';
import type { AssistantConversation } from './entities/assistant-conversation.entity';
import type { AssistantMessage } from './entities/assistant-message.entity';
import type { AssistantTurn } from './entities/assistant-turn.entity';

export const toMessageDto = (row: AssistantMessage): AssistantMessageDto => ({
  id: row.id,
  conversationId: row.conversationId,
  turnId: row.turnId,
  seq: Number(row.seq),
  role: row.role,
  content: row.content,
  toolName: row.toolName,
  payload: row.payload,
  createdAt: row.createdAt.toISOString(),
});

export const toTurnDto = (row: AssistantTurn): AssistantTurnDto => ({
  id: row.id,
  conversationId: row.conversationId,
  status: row.status,
  pendingAction: row.pendingAction,
  steps: row.steps,
  model: row.model,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
});

export const toConversationDto = (row: AssistantConversation): AssistantConversationDto => ({
  id: row.id,
  title: row.title,
  context: row.context,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
});
```

```ts
// assistant-events.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { DataSource, type EntityManager } from 'typeorm';
import type { AssistantTurnStatus } from '@saas/shared';
import type { AssistantEventInput } from '../channels/workflows/activities/agent-react.activities';
import { AssistantMessage } from './entities/assistant-message.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { ASSISTANT_REDIS_PUBLISHER, assistantChannel } from './assistant-redis';
import { toTurnDto } from './assistant-mappers';

const TERMINAL: AssistantTurnStatus[] = ['COMPLETED', 'REJECTED', 'TIMED_OUT', 'FAILED', 'CANCELLED'];

/**
 * The only writer of a turn's transcript and state. Rows are the stream:
 * Postgres is the source of truth, Redis only says "look again".
 */
@Injectable()
export class AssistantEventsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ASSISTANT_REDIS_PUBLISHER) private readonly redis: Redis,
  ) {}

  async emit(input: AssistantEventInput): Promise<void> {
    const wrote = await this.dataSource.transaction(async (manager) => {
      const turn = await manager.findOneByOrFail(AssistantTurn, { id: input.turnId });
      // A cancelled (or swept) turn's workflow may still be finishing an activity.
      if (TERMINAL.includes(turn.status)) return false;

      await this.insert(manager, {
        tenantId: input.organizationId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        eventKey: input.eventKey,
        role: input.role,
        content: input.content,
        toolName: input.toolName ?? null,
        payload: input.payload ?? null,
      });

      // Every event is progress, so the stale sweep never fails a turn that is still emitting.
      const patch: Partial<AssistantTurn> = { lastProgressAt: new Date() };
      if (input.turn) {
        if (input.turn.status !== undefined) patch.status = input.turn.status;
        if (input.turn.pendingAction !== undefined) patch.pendingAction = input.turn.pendingAction;
        if (input.turn.steps !== undefined) patch.steps = input.turn.steps;
        if (input.turn.model !== undefined) patch.model = input.turn.model;
        if (input.turn.error !== undefined) patch.error = input.turn.error;
        if (input.turn.status && TERMINAL.includes(input.turn.status)) patch.finishedAt = new Date();
      }
      await manager.update(AssistantTurn, { id: input.turnId }, patch);
      if (input.turn?.status !== undefined) {
        await this.writeStatusRow(manager, turn, `${input.eventKey}:status`);
      }
      return true;
    });
    if (wrote) this.publish(input.conversationId);
  }

  /** For state changes made by the API itself (cancel, stale sweep). */
  async writeStatus(turn: AssistantTurn, eventKey: string): Promise<void> {
    await this.dataSource.transaction((manager) => this.writeStatusRow(manager, turn, eventKey));
    this.publish(turn.conversationId);
  }

  publish(conversationId: string): void {
    this.redis.publish(assistantChannel(conversationId), '1').catch(() => undefined);
  }

  private async writeStatusRow(manager: EntityManager, turn: AssistantTurn, eventKey: string) {
    const fresh = await manager.findOneByOrFail(AssistantTurn, { id: turn.id });
    await this.insert(manager, {
      tenantId: fresh.tenantId,
      conversationId: fresh.conversationId,
      turnId: fresh.id,
      eventKey,
      role: 'status',
      content: fresh.status,
      toolName: null,
      payload: { turn: toTurnDto(fresh) },
    });
  }

  private async insert(manager: EntityManager, values: Partial<AssistantMessage>) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(AssistantMessage)
      .values(values)
      .orIgnore() // (turn_id, event_key) unique — a retried activity is a no-op
      .execute();
  }
}
```

Note: the "already cancelled" test expects no insert; the `TERMINAL` early return covers it. The `final` emit after a terminal status set by the same emit is fine because the check happens before the update.

```ts
// assistant.activities.ts
import type { TenantContextService } from '@/common/context/tenant-context.service';
import type { AssistantEventInput } from '../channels/workflows/activities/agent-react.activities';
import type { AssistantEventsService } from './assistant-events.service';

export function createAssistantActivities(deps: {
  events: AssistantEventsService;
  tenantContext: TenantContextService;
}) {
  return {
    async emitAssistantEventActivity(input: AssistantEventInput): Promise<void> {
      await deps.tenantContext.runWithTenant(input.organizationId, () => deps.events.emit(input));
    },
  };
}
```

`assistant.module.ts` — add providers `AssistantEventsService`, `{ provide: ASSISTANT_REDIS_PUBLISHER, useFactory: createAssistantRedis }`; export `AssistantEventsService`.

`temporal-worker.ts` — import `AssistantEventsService` and `createAssistantActivities`, build them after `agentReactActivities`:

```ts
    const assistantActivities = createAssistantActivities({
      events: appContext.get(AssistantEventsService),
      tenantContext: appContext.get(TenantContextService),
    });
```

Add a fifth worker and update the startup log line:

```ts
      Worker.create({
        connection,
        taskQueue: 'assistant-queue',
        workflowsPath: require.resolve('./modules/channels/workflows/agent-react.workflow'),
        activities: { ...agentReactActivities, ...assistantActivities },
      }),
```

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter api test -- assistant-events && pnpm --filter api build`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/assistant apps/api/src/temporal-worker.ts
git commit -m "feat(assistant): write turn events to postgres with redis nudges on assistant-queue"
```

---

### Task 6: Assistant service, controller, SSE stream and sweep

**Files:**
- Create: `apps/api/src/modules/assistant/assistant.service.ts`
- Create: `apps/api/src/modules/assistant/assistant.service.spec.ts`
- Create: `apps/api/src/modules/assistant/assistant-stream.hub.ts`
- Create: `apps/api/src/modules/assistant/assistant-stream.hub.spec.ts`
- Create: `apps/api/src/modules/assistant/assistant.controller.ts`
- Create: `apps/api/src/modules/assistant/assistant-sweep.service.ts`
- Create: `apps/api/src/modules/assistant/assistant-sweep.service.spec.ts`
- Modify: `apps/api/src/modules/assistant/assistant.module.ts`
- Modify: `apps/api/src/modules/audit/audit-subjects.ts` (`AUDIT_BODYLESS_PREFIXES`)

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5. `TemporalService.getClient()`, `agentReActWorkflow`, `approvalSignal` from `../channels/workflows/agent-react.workflow`.
- Produces (`AssistantService`):
  - `list(actor): Promise<AssistantConversationDto[]>`
  - `create(actor, body: CreateAssistantConversationPayload): Promise<AssistantConversationDto>`
  - `get(actor, id): Promise<AssistantConversationDetailDto>`
  - `update(actor, id, body: UpdateAssistantConversationPayload): Promise<AssistantConversationDto>`
  - `sendMessage(actor, conversationId, body: SendAssistantMessagePayload): Promise<{ message: AssistantMessageDto; turn: AssistantTurnDto }>`
  - `decide(actor, turnId, body: AssistantApprovalPayload): Promise<AssistantTurnDto>`
  - `cancel(actor, turnId): Promise<AssistantTurnDto>`
  - `messagesAfter(actor, conversationId, afterSeq: number): Promise<AssistantMessageDto[]>`
- `AssistantStreamHub.listen(conversationId: string, onNudge: () => void): () => void` (returns unsubscribe)
- `AssistantSweepService.sweep(now?: Date): Promise<number>`

- [ ] **Step 1: Write the failing tests**

`assistant.service.spec.ts` — build the service with in-memory fakes for the three repositories, `TemporalService`, and `AssistantEventsService`. Use a tiny fake repo helper so tests read clearly:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AssistantService } from './assistant.service';

const alice = { id: 'alice', organizationId: 'org-1', permissions: ['assistant:use'] } as any;
const bob = { id: 'bob', organizationId: 'org-1', permissions: ['assistant:use'] } as any;

function harness() {
  const conversations = new Map<string, any>();
  const turns = new Map<string, any>();
  const messages: any[] = [];
  let seq = 0;
  const convRepo = {
    create: (v: any) => ({ id: `conv-${conversations.size + 1}`, title: 'New chat', context: null, createdAt: new Date(), updatedAt: new Date(), archivedAt: null, ...v }),
    save: async (v: any) => (conversations.set(v.id, v), v),
    findOne: async ({ where }: any) => [...conversations.values()].find((c) => c.id === where.id && c.tenantId === where.tenantId && c.userId === where.userId) ?? null,
    find: async () => [...conversations.values()],
    update: async (where: any, patch: any) => Object.assign(conversations.get(where.id), patch),
  };
  const turnRepo = {
    create: (v: any) => ({ id: `turn-${turns.size + 1}`, steps: 0, pendingAction: null, model: null, error: null, createdAt: new Date(), finishedAt: null, ...v }),
    save: async (v: any) => {
      const active = [...turns.values()].find((t) => t.conversationId === v.conversationId && ['RUNNING', 'AWAITING_APPROVAL'].includes(t.status) && t.id !== v.id);
      if (active) throw new QueryFailedError('insert', [], Object.assign(new Error('dup'), { code: '23505' }) as any);
      turns.set(v.id, v);
      return v;
    },
    findOne: async ({ where }: any) => [...turns.values()].find((t) => Object.entries(where).every(([k, val]) => (k === 'status' && typeof val === 'object' ? true : t[k] === val))) ?? null,
    update: async (where: any, patch: any) => {
      const t = turns.get(where.id);
      const allowed: string[] | null =
        where.status === undefined ? null : Array.isArray(where.status?.value) ? where.status.value : [where.status];
      if (!t || (allowed && !allowed.includes(t.status))) return { affected: 0 };
      Object.assign(t, patch);
      return { affected: 1 };
    },
  };
  const msgRepo = {
    create: (v: any) => ({ id: `msg-${messages.length + 1}`, createdAt: new Date(), toolName: null, payload: null, turnId: null, ...v }),
    save: async (v: any) => { v.seq = String(++seq); messages.push(v); return v; },
    find: async ({ where, order, take }: any) => {
      let rows = messages.filter((m) => m.conversationId === where.conversationId);
      const roles: string[] | undefined = where.role?.value;
      if (roles) rows = rows.filter((m) => roles.includes(m.role));
      rows = [...rows].sort((a, b) => Number(a.seq) - Number(b.seq));
      if (order?.seq === 'DESC') rows.reverse();
      return take ? rows.slice(0, take) : rows;
    },
    update: async (where: any, patch: any) => Object.assign(messages.find((m) => m.id === where.id), patch),
  };
  const workflow = { start: jest.fn().mockResolvedValue({ workflowId: 'wf' }), getHandle: jest.fn() };
  const handle = { signal: jest.fn().mockResolvedValue(undefined), cancel: jest.fn().mockResolvedValue(undefined) };
  workflow.getHandle.mockReturnValue(handle);
  const temporal = { getClient: () => ({ workflow }) } as any;
  const events = { writeStatus: jest.fn().mockResolvedValue(undefined), publish: jest.fn() } as any;
  const service = new AssistantService(convRepo as any, turnRepo as any, msgRepo as any, temporal, events);
  return { service, conversations, turns, messages, workflow, handle, events };
}
```

> If you implement the service with `QueryBuilder` calls instead of these repository methods, adapt the fakes rather than the assertions. The assertions are the contract.

```ts
describe('AssistantService', () => {
  it('only the owner can read a conversation', async () => {
    const h = harness();
    const conv = await h.service.create(alice, {});
    await expect(h.service.get(bob, conv.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sendMessage saves the message, titles the conversation, and starts a turn workflow with history and provenance', async () => {
    const h = harness();
    const conv = await h.service.create(alice, {});
    const { message, turn } = await h.service.sendMessage(alice, conv.id, {
      content: 'Show me Acme’s last WhatsApp messages and draft a follow-up',
      context: { entity: 'contact', id: 'c-1', label: 'Ada Acme' },
    });
    expect(turn.status).toBe('RUNNING');
    expect(h.conversations.get(conv.id).title).toBe('Show me Acme’s last WhatsApp messages and draft a follow-up'.slice(0, 60));
    const [, options] = h.workflow.start.mock.calls[0];
    expect(options).toMatchObject({
      taskQueue: 'assistant-queue',
      workflowId: `assistant-turn-${turn.id}`,
      args: [expect.objectContaining({
        organizationId: 'org-1',
        userId: 'alice',
        prompt: message.content,
        pageContext: { entity: 'contact', id: 'c-1', label: 'Ada Acme' },
        eventSink: { conversationId: conv.id, turnId: turn.id },
        audit: { channel: 'ASSISTANT', messageId: message.id },
        approvalTimeout: '24 hours',
        maxTurns: 6,
        history: [],
      })],
    });
  });

  it('second message while a turn is active is a 409 (Review Focus #2 for sends)', async () => {
    const h = harness();
    const conv = await h.service.create(alice, {});
    await h.service.sendMessage(alice, conv.id, { content: 'one' });
    await expect(h.service.sendMessage(alice, conv.id, { content: 'two' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks the turn FAILED when the workflow cannot start', async () => {
    const h = harness();
    h.workflow.start.mockRejectedValueOnce(new Error('Temporal client is not initialized'));
    const conv = await h.service.create(alice, {});
    const { turn } = await h.service.sendMessage(alice, conv.id, { content: 'hi' });
    expect(turn.status).toBe('FAILED');
    expect(h.events.writeStatus).toHaveBeenCalled();
  });

  it('approval is owner-only, only while awaiting, and signals exactly once (Review Focus #2)', async () => {
    const h = harness();
    const conv = await h.service.create(alice, {});
    const { turn } = await h.service.sendMessage(alice, conv.id, { content: 'send it' });
    h.turns.get(turn.id).status = 'AWAITING_APPROVAL';

    await expect(h.service.decide(bob, turn.id, { approved: true })).rejects.toBeInstanceOf(NotFoundException);
    await h.service.decide(alice, turn.id, { approved: true });
    await expect(h.service.decide(alice, turn.id, { approved: true })).rejects.toBeInstanceOf(ConflictException);
    expect(h.handle.signal).toHaveBeenCalledTimes(1);
    expect(h.handle.signal).toHaveBeenCalledWith(expect.objectContaining({ name: 'agentApprovalSignal' }), { approved: true });
  });

  it('cancel marks CANCELLED, writes a status row and cancels the workflow', async () => {
    const h = harness();
    const conv = await h.service.create(alice, {});
    const { turn } = await h.service.sendMessage(alice, conv.id, { content: 'x' });
    const cancelled = await h.service.cancel(alice, turn.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(h.handle.cancel).toHaveBeenCalled();
    expect(h.events.writeStatus).toHaveBeenCalledWith(expect.objectContaining({ id: turn.id }), 'cancelled:status');
  });

  it('passes the last 20 user/assistant messages as history, oldest first', async () => {
    const h = harness();
    const conv = await h.service.create(alice, {});
    for (let i = 0; i < 25; i++) {
      h.messages.push({ id: `old-${i}`, conversationId: conv.id, tenantId: 'org-1', role: i % 2 ? 'assistant' : 'user', content: `m${i}`, seq: String(i), createdAt: new Date() });
      h.messages.push({ id: `step-${i}`, conversationId: conv.id, tenantId: 'org-1', role: 'step', content: 'noise', seq: String(i), createdAt: new Date() });
    }
    await h.service.sendMessage(alice, conv.id, { content: 'latest' });
    const history = h.workflow.start.mock.calls[0][1].args[0].history;
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe('m5');
    expect(history.at(-1).content).toBe('m24');
  });
});
```

`assistant-stream.hub.spec.ts`:

```ts
import { AssistantStreamHub } from './assistant-stream.hub';

describe('AssistantStreamHub', () => {
  it('subscribes once per conversation, fans out, and unsubscribes when the last listener leaves', async () => {
    const handlers: Record<string, (channel: string) => void> = {};
    const redis = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      on: (event: string, fn: any) => { handlers[event] = fn; },
    } as any;
    const hub = new AssistantStreamHub(redis);
    hub.onModuleInit();
    const a = jest.fn();
    const b = jest.fn();
    const offA = hub.listen('conv-1', a);
    const offB = hub.listen('conv-1', b);
    expect(redis.subscribe).toHaveBeenCalledTimes(1);
    handlers.message('assistant:conv:conv-1');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    expect(redis.unsubscribe).not.toHaveBeenCalled();
    offB();
    expect(redis.unsubscribe).toHaveBeenCalledWith('assistant:conv:conv-1');
  });
});
```

`assistant-sweep.service.spec.ts`:

```ts
import { AssistantSweepService } from './assistant-sweep.service';

it('fails RUNNING turns with no progress for 5 minutes and terminates their workflows; leaves approvals alone', async () => {
  const stale = { id: 't1', conversationId: 'c1', workflowId: 'assistant-turn-t1', status: 'RUNNING', tenantId: 'org-1' };
  const turns = {
    find: jest.fn().mockResolvedValue([stale]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  } as any;
  const handle = { terminate: jest.fn().mockResolvedValue(undefined) };
  const temporal = { getClient: () => ({ workflow: { getHandle: () => handle } }) } as any;
  const events = { writeStatus: jest.fn().mockResolvedValue(undefined) } as any;
  const tenantContext = { runAsSystem: (fn: any) => fn(), runWithTenant: (_t: string, fn: any) => fn() } as any;
  const sweep = new AssistantSweepService(turns, temporal, events, tenantContext);
  const now = new Date('2026-10-14T10:00:00Z');
  expect(await sweep.sweep(now)).toBe(1);
  const where = turns.find.mock.calls[0][0].where;
  expect(where.status).toBe('RUNNING');
  expect(turns.update).toHaveBeenCalledWith({ id: 't1', status: 'RUNNING' }, expect.objectContaining({ status: 'FAILED' }));
  expect(handle.terminate).toHaveBeenCalled();
  expect(events.writeStatus).toHaveBeenCalledWith(stale, 'swept:status');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test -- modules/assistant`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// assistant.service.ts
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, QueryFailedError, Repository, IsNull } from 'typeorm';
import {
  ACTIVE_ASSISTANT_TURN_STATUSES,
  type AssistantApprovalPayload,
  type AssistantConversationDetailDto,
  type AssistantConversationDto,
  type AssistantMessageDto,
  type AssistantTurnDto,
  type CreateAssistantConversationPayload,
  type SendAssistantMessagePayload,
  type UpdateAssistantConversationPayload,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TemporalService } from '../temporal/temporal.service';
import { agentReActWorkflow, approvalSignal } from '../channels/workflows/agent-react.workflow';
import { AssistantConversation } from './entities/assistant-conversation.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantMessage } from './entities/assistant-message.entity';
import { AssistantEventsService } from './assistant-events.service';
import { toConversationDto, toMessageDto, toTurnDto } from './assistant-mappers';

export const ASSISTANT_TASK_QUEUE = 'assistant-queue';
const HISTORY_LIMIT = 20;

const isUniqueViolation = (error: unknown) =>
  error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505';

/**
 * Conversations are private to their owner within a tenant. RLS supplies the
 * tenant; `ownWhere` supplies the owner. Every lookup goes through it.
 */
@Injectable()
export class AssistantService {
  constructor(
    @InjectRepository(AssistantConversation) private readonly conversations: Repository<AssistantConversation>,
    @InjectRepository(AssistantTurn) private readonly turns: Repository<AssistantTurn>,
    @InjectRepository(AssistantMessage) private readonly messages: Repository<AssistantMessage>,
    private readonly temporal: TemporalService,
    private readonly events: AssistantEventsService,
  ) {}

  private ownWhere(actor: AuthenticatedUser) {
    return { tenantId: actor.organizationId, userId: actor.id };
  }

  private async ownConversation(actor: AuthenticatedUser, id: string): Promise<AssistantConversation> {
    const conversation = await this.conversations.findOne({ where: { id, ...this.ownWhere(actor) } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  private async ownTurn(actor: AuthenticatedUser, turnId: string): Promise<AssistantTurn> {
    const turn = await this.turns.findOne({ where: { id: turnId, tenantId: actor.organizationId } });
    if (!turn) throw new NotFoundException('Turn not found');
    await this.ownConversation(actor, turn.conversationId);
    return turn;
  }

  async list(actor: AuthenticatedUser): Promise<AssistantConversationDto[]> {
    const rows = await this.conversations.find({
      where: { ...this.ownWhere(actor), archivedAt: IsNull() },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return rows.map(toConversationDto);
  }

  async create(actor: AuthenticatedUser, body: CreateAssistantConversationPayload): Promise<AssistantConversationDto> {
    const row = this.conversations.create({ ...this.ownWhere(actor), context: body.context ?? null });
    return toConversationDto(await this.conversations.save(row));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<AssistantConversationDetailDto> {
    const conversation = await this.ownConversation(actor, id);
    const [rows, activeTurn] = await Promise.all([
      this.messages.find({ where: { conversationId: id }, order: { seq: 'ASC' } }),
      this.turns.findOne({ where: { conversationId: id, status: In([...ACTIVE_ASSISTANT_TURN_STATUSES]) } }),
    ]);
    return {
      ...toConversationDto(conversation),
      messages: rows.map(toMessageDto),
      activeTurn: activeTurn ? toTurnDto(activeTurn) : null,
    };
  }

  async update(actor: AuthenticatedUser, id: string, body: UpdateAssistantConversationPayload): Promise<AssistantConversationDto> {
    const conversation = await this.ownConversation(actor, id);
    if (body.title !== undefined) conversation.title = body.title;
    if (body.archived !== undefined) conversation.archivedAt = body.archived ? new Date() : null;
    return toConversationDto(await this.conversations.save(conversation));
  }

  async messagesAfter(actor: AuthenticatedUser, conversationId: string, afterSeq: number): Promise<AssistantMessageDto[]> {
    await this.ownConversation(actor, conversationId);
    const rows = await this.messages.find({
      where: { conversationId, seq: MoreThan(String(afterSeq)) },
      order: { seq: 'ASC' },
      take: 500,
    });
    return rows.map(toMessageDto);
  }

  async sendMessage(
    actor: AuthenticatedUser,
    conversationId: string,
    body: SendAssistantMessagePayload,
  ): Promise<{ message: AssistantMessageDto; turn: AssistantTurnDto }> {
    const conversation = await this.ownConversation(actor, conversationId);

    const prior = await this.messages.find({
      where: { conversationId, role: In(['user', 'assistant']) },
      order: { seq: 'DESC' },
      take: HISTORY_LIMIT,
    });
    const history = prior.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let turn = this.turns.create({
      tenantId: actor.organizationId,
      conversationId,
      status: 'RUNNING',
      workflowId: '',
      lastProgressAt: new Date(),
    });
    try {
      turn = await this.turns.save(turn);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('The assistant is still working on your last message');
      throw error;
    }

    const message = await this.messages.save(
      this.messages.create({
        tenantId: actor.organizationId,
        conversationId,
        turnId: turn.id,
        role: 'user',
        content: body.content,
        payload: body.context ? { context: body.context } : null,
      }),
    );
    turn.userMessageId = message.id;
    turn.workflowId = `assistant-turn-${turn.id}`;
    turn = await this.turns.save(turn);

    if (conversation.title === 'New chat') conversation.title = body.content.slice(0, 60);
    if (body.context !== undefined) conversation.context = body.context ?? null;
    await this.conversations.save(conversation);

    try {
      await this.temporal.getClient().workflow.start(agentReActWorkflow, {
        taskQueue: ASSISTANT_TASK_QUEUE,
        workflowId: turn.workflowId,
        args: [
          {
            organizationId: actor.organizationId,
            userId: actor.id,
            conversationId,
            prompt: body.content,
            history,
            ...(body.context ? { pageContext: body.context } : {}),
            eventSink: { conversationId, turnId: turn.id },
            audit: { channel: 'ASSISTANT', messageId: message.id },
            approvalTimeout: '24 hours',
            maxTurns: 6,
          },
        ],
      });
    } catch (error) {
      turn.status = 'FAILED';
      turn.error = error instanceof Error ? error.message : String(error);
      turn.finishedAt = new Date();
      turn = await this.turns.save(turn);
      await this.events.writeStatus(turn, 'start-failed:status');
    }
    this.events.publish(conversationId);
    return { message: toMessageDto(message), turn: toTurnDto(turn) };
  }

  async decide(actor: AuthenticatedUser, turnId: string, body: AssistantApprovalPayload): Promise<AssistantTurnDto> {
    const turn = await this.ownTurn(actor, turnId);
    // Conditional update is the lock: only one request wins the AWAITING_APPROVAL → RUNNING transition.
    const { affected } = await this.turns.update(
      { id: turn.id, status: 'AWAITING_APPROVAL' },
      { status: 'RUNNING', lastProgressAt: new Date() },
    );
    if (!affected) throw new ConflictException('This action is no longer waiting for approval');
    try {
      await this.temporal
        .getClient()
        .workflow.getHandle(turn.workflowId)
        .signal(approvalSignal, body.note ? { approved: body.approved, note: body.note } : { approved: body.approved });
    } catch (error) {
      await this.turns.update({ id: turn.id }, { status: 'AWAITING_APPROVAL' });
      throw new ServiceUnavailableException('Could not reach the assistant worker; try again');
    }
    return toTurnDto({ ...turn, status: 'RUNNING' });
  }

  async cancel(actor: AuthenticatedUser, turnId: string): Promise<AssistantTurnDto> {
    const turn = await this.ownTurn(actor, turnId);
    const { affected } = await this.turns.update(
      { id: turn.id, status: In([...ACTIVE_ASSISTANT_TURN_STATUSES]) },
      { status: 'CANCELLED', pendingAction: null, finishedAt: new Date() },
    );
    if (!affected) throw new ConflictException('This turn has already finished');
    const cancelled = { ...turn, status: 'CANCELLED' as const, pendingAction: null, finishedAt: new Date() };
    await this.events.writeStatus(cancelled, 'cancelled:status');
    await this.temporal.getClient().workflow.getHandle(turn.workflowId).cancel().catch(() => undefined);
    return toTurnDto(cancelled);
  }
}
```

Note: the fakes read `In([...])` through `FindOperator.value`. If the TypeORM version in use exposes it differently, adjust the fakes, not the assertions.

```ts
// assistant-stream.hub.ts
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { ASSISTANT_REDIS_SUBSCRIBER, assistantChannel } from './assistant-redis';

/** One Redis subscription per conversation per API process, fanned out to every open stream. */
@Injectable()
export class AssistantStreamHub implements OnModuleInit, OnModuleDestroy {
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(@Inject(ASSISTANT_REDIS_SUBSCRIBER) private readonly redis: Redis) {}

  onModuleInit() {
    this.redis.on('message', (channel: string) => {
      for (const listener of this.listeners.get(channel) ?? []) listener();
    });
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  listen(conversationId: string, onNudge: () => void): () => void {
    const channel = assistantChannel(conversationId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      this.redis.subscribe(channel).catch(() => undefined);
    }
    set.add(onNudge);
    return () => {
      set!.delete(onNudge);
      if (set!.size === 0) {
        this.listeners.delete(channel);
        this.redis.unsubscribe(channel).catch(() => undefined);
      }
    };
  }
}
```

(The spec test's fake has no `quit`; `onModuleDestroy` is not called there.)

```ts
// assistant-sweep.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { TemporalService } from '../temporal/temporal.service';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantEventsService } from './assistant-events.service';

const STALE_AFTER_MS = 5 * 60_000;

/** A RUNNING turn with no event for 5 minutes has lost its worker. Approval waits are exempt. */
@Injectable()
export class AssistantSweepService {
  private readonly logger = new Logger(AssistantSweepService.name);

  constructor(
    @InjectRepository(AssistantTurn) private readonly turns: Repository<AssistantTurn>,
    private readonly temporal: TemporalService,
    private readonly events: AssistantEventsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    const swept = await this.sweep();
    if (swept) this.logger.warn(`Marked ${swept} stale assistant turn(s) FAILED`);
  }

  async sweep(now = new Date()): Promise<number> {
    return this.tenantContext.runAsSystem(async () => {
      const stale = await this.turns.find({
        where: { status: 'RUNNING', lastProgressAt: LessThan(new Date(now.getTime() - STALE_AFTER_MS)) },
        take: 100,
      });
      let count = 0;
      for (const turn of stale) {
        const { affected } = await this.turns.update(
          { id: turn.id, status: 'RUNNING' },
          { status: 'FAILED', error: 'The assistant stopped responding', finishedAt: now },
        );
        if (!affected) continue;
        count++;
        await this.temporal.getClient().workflow.getHandle(turn.workflowId).terminate('stale assistant turn').catch(() => undefined);
        await this.tenantContext.runWithTenant(turn.tenantId, () => this.events.writeStatus(turn, 'swept:status'));
      }
      return count;
    });
  }
}
```

Before relying on `runAsSystem`, read `apps/api/src/common/context/tenant-context.service.ts:42` and confirm it makes queries run with `app.bypass_rls = 'on'` (search for where `CLS_IS_SYSTEM_KEY` is read). If it does not, use the mechanism other cross-tenant crons use (grep `@Cron` in `modules/quotes` for the invoice-overdue job and copy its approach).

```ts
// assistant.controller.ts
import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  PERMISSIONS,
  assistantApprovalSchema,
  createAssistantConversationSchema,
  sendAssistantMessageSchema,
  updateAssistantConversationSchema,
  type AssistantApprovalPayload,
  type CreateAssistantConversationPayload,
  type SendAssistantMessagePayload,
  type UpdateAssistantConversationPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { AssistantService } from './assistant.service';
import { AssistantStreamHub } from './assistant-stream.hub';

const HEARTBEAT_MS = 15_000;
const POLL_MS = 5_000;

@ApiTags('assistant')
@Controller('assistant')
@RequirePermissions(PERMISSIONS.ASSISTANT_USE)
export class AssistantController {
  constructor(
    private readonly service: AssistantService,
    private readonly hub: AssistantStreamHub,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: "List the current user's assistant conversations" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Post('conversations')
  create(@CurrentUser() user: AuthenticatedUser, @Body(zodBody(createAssistantConversationSchema)) body: CreateAssistantConversationPayload) {
    return this.service.create(user, body);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Patch('conversations/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateAssistantConversationSchema)) body: UpdateAssistantConversationPayload,
  ) {
    return this.service.update(user, id, body);
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(sendAssistantMessageSchema)) body: SendAssistantMessagePayload,
  ) {
    return this.service.sendMessage(user, id, body);
  }

  @Post('turns/:id/approval')
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(assistantApprovalSchema)) body: AssistantApprovalPayload,
  ) {
    return this.service.decide(user, id, body);
  }

  @Post('turns/:id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(user, id);
  }

  @Get('conversations/:id/stream')
  @ApiOperation({ summary: 'Server-sent events: every new transcript row, in seq order' })
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Ownership check up front so a foreign id 404s before the stream opens.
    let lastSeq = Number(lastEventId ?? 0) || 0;
    const initial = await this.service.messagesAfter(user, id, lastSeq);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    let draining = Promise.resolve();
    const write = (rows: typeof initial) => {
      for (const row of rows) {
        if (row.seq <= lastSeq) continue; // two nudges can race; never send a row twice
        lastSeq = row.seq;
        res.write(`id: ${row.seq}\nevent: message\ndata: ${JSON.stringify(row)}\n\n`);
      }
    };
    // Serialise fetches so rows go out in seq order (Review Focus #1, #3).
    const pull = () => {
      draining = draining.then(async () => {
        if (closed) return;
        const rows = await this.tenantContext.runWithTenant(user.organizationId, () =>
          this.service.messagesAfter(user, id, lastSeq),
        );
        if (!closed) write(rows);
      }).catch(() => undefined);
    };

    write(initial);
    const off = this.hub.listen(id, pull);
    const poll = setInterval(pull, POLL_MS);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      closed = true;
      off();
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  }
}
```

Add a controller-level test for the stream's de-duplication in `assistant-stream.hub.spec.ts` or a new `assistant.controller.spec.ts`:

```ts
it('never writes a row twice and writes in seq order when nudges race (Review Focus #1/#3)', async () => {
  const writes: string[] = [];
  let nudge: () => void = () => undefined;
  const rowsAfter = (after: number) => [1, 2, 3].filter((s) => s > after).map((s) => ({ seq: s }));
  const service = { messagesAfter: jest.fn(async (_u, _id, after) => rowsAfter(after)) } as any;
  const hub = { listen: (_id: string, fn: () => void) => ((nudge = fn), () => undefined) } as any;
  const tenantContext = { runWithTenant: (_t: string, fn: any) => fn() } as any;
  const controller = new AssistantController(service, hub, tenantContext);
  const res = { status: jest.fn(), setHeader: jest.fn(), flushHeaders: jest.fn(), write: (s: string) => writes.push(s) } as any;
  const req = { on: jest.fn() } as any;
  await controller.stream({ organizationId: 'org-1' } as any, 'conv-1', '1', req, res);
  nudge(); nudge();
  await new Promise((r) => setTimeout(r, 0));
  const ids = writes.filter((w) => w.startsWith('id:')).map((w) => Number(w.split('\n')[0].slice(4)));
  expect(ids).toEqual([2, 3]);
  req.on.mock.calls.find(([e]: any) => e === 'close')[1]();
});
```

`assistant.module.ts` (final):

```ts
@Module({
  imports: [TypeOrmModule.forFeature([AssistantConversation, AssistantTurn, AssistantMessage]), TemporalModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantEventsService,
    AssistantStreamHub,
    AssistantSweepService,
    { provide: ASSISTANT_REDIS_PUBLISHER, useFactory: createAssistantRedis },
    { provide: ASSISTANT_REDIS_SUBSCRIBER, useFactory: createAssistantRedis },
  ],
  exports: [AssistantEventsService],
})
export class AssistantModule {}
```

Because `AssistantModule` is also in `WORKER_FEATURE_MODULES`, the worker would instantiate the controller-side providers too. That is harmless (the sweep's `@Cron` never fires without `ScheduleModule.forRoot()`, per `worker.module.ts`'s comment; the hub only subscribes on `listen`). Leave it.

`audit-subjects.ts`: `export const AUDIT_BODYLESS_PREFIXES = ['auth', 'ai', 'channels', 'assistant'];`

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter api test -- modules/assistant && pnpm --filter api build`
Expected: PASS; build succeeds.

- [ ] **Step 5: Smoke test against a running stack**

Run `pnpm db:up && pnpm migration:run && pnpm dev` plus the worker (check root `package.json` for the worker script name, e.g. `pnpm --filter api worker`). Log in as a seeded user in the browser, then from the browser devtools console:

```js
const c = await (await fetch('http://localhost:4000/assistant/conversations', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
await fetch(`http://localhost:4000/assistant/conversations/${c.id}/messages`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'what jobs are running on the floor?' }) });
(await (await fetch(`http://localhost:4000/assistant/conversations/${c.id}`, { credentials: 'include' })).json()).messages.map(m => [m.seq, m.role, m.content]);
```

Expected: within a few seconds the list contains `user`, `step`, `tool_call`, `tool_result`, `assistant`, `status` rows. Adjust the API base URL to `API_PUBLIC_URL`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/assistant apps/api/src/modules/audit/audit-subjects.ts
git commit -m "feat(assistant): add conversation API, approval/cancel, SSE stream and stale-turn sweep"
```

---

### Task 7: Web data layer — endpoints, stream reader, hooks

**Files:**
- Create: `apps/web/src/lib/api/endpoints/assistant.ts`
- Modify: `apps/web/src/lib/api/endpoints/index.ts`
- Modify: `apps/web/src/lib/api/client.ts` (export `silentRefresh`)
- Create: `apps/web/src/lib/api/stream.ts`
- Create: `apps/web/src/lib/api/stream.test.ts`
- Create: `apps/web/src/hooks/use-assistant.ts`
- Create: `apps/web/src/hooks/use-assistant-stream.ts`
- Create: `apps/web/src/hooks/use-assistant-stream.test.tsx`

**Interfaces:**
- Produces:
  - `api.assistant.{ list(), create(body), get(id), update(id, body), send(id, body), decide(turnId, body), cancel(turnId) }`
  - `queryKeys.assistantConversations`, `queryKeys.assistantConversation(id)`
  - `parseSseChunk(buffer: string): { events: Array<{ id?: string; event: string; data: string }>; rest: string }`
  - `openEventStream(path: string, opts: { lastEventId?: string; signal: AbortSignal; onEvent(e): void }): Promise<void>` — resolves when the stream ends; rejects on HTTP error.
  - `useAssistantConversations()`, `useAssistantConversation(id)`, `useCreateAssistantConversation()`, `useSendAssistantMessage(id)`, `useDecideAssistantTurn(id)`, `useCancelAssistantTurn(id)`, `useUpdateAssistantConversation()`
  - `useAssistantStream(conversationId: string | null): { connected: boolean }` — merges rows into the `assistantConversation(id)` cache.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/api/stream.test.ts
import { describe, expect, it } from 'vitest';
import { parseSseChunk } from './stream';

describe('parseSseChunk', () => {
  it('parses complete events and keeps the partial tail', () => {
    const { events, rest } = parseSseChunk('id: 3\nevent: message\ndata: {"a":1}\n\n: ping\n\nid: 4\nevent: mess');
    expect(events).toEqual([{ id: '3', event: 'message', data: '{"a":1}' }]);
    expect(rest).toBe('id: 4\nevent: mess');
  });

  it('handles CRLF line endings', () => {
    const { events } = parseSseChunk('id: 1\r\nevent: message\r\ndata: x\r\n\r\n');
    expect(events[0]).toEqual({ id: '1', event: 'message', data: 'x' });
  });
});
```

```tsx
// apps/web/src/hooks/use-assistant-stream.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { mergeMessages } from './use-assistant-stream';

describe('mergeMessages', () => {
  const m = (seq: number, role = 'step') => ({ id: `m${seq}`, seq, role, content: '', conversationId: 'c', turnId: 't', toolName: null, payload: null, createdAt: '' }) as any;

  it('appends new rows in seq order and ignores duplicates (Review Focus #1/#3)', () => {
    const detail = { messages: [m(1), m(2)], activeTurn: null } as any;
    const next = mergeMessages(detail, [m(2), m(4), m(3)]);
    expect(next.messages.map((x: any) => x.seq)).toEqual([1, 2, 3, 4]);
  });

  it('applies the turn carried by a status row; terminal status clears activeTurn', () => {
    const turn = { id: 't', status: 'AWAITING_APPROVAL' };
    const detail = { messages: [], activeTurn: null } as any;
    const awaiting = mergeMessages(detail, [{ ...m(1, 'status'), payload: { turn } }]);
    expect(awaiting.activeTurn).toEqual(turn);
    const done = mergeMessages(awaiting, [{ ...m(2, 'status'), payload: { turn: { ...turn, status: 'COMPLETED' } } }]);
    expect(done.activeTurn).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- stream use-assistant-stream`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`client.ts`: change `function silentRefresh()` to `export function silentRefresh()`.

```ts
// apps/web/src/lib/api/endpoints/assistant.ts
/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  AssistantApprovalPayload,
  AssistantConversationDetailDto,
  AssistantConversationDto,
  AssistantMessageDto,
  AssistantTurnDto,
  CreateAssistantConversationPayload,
  SendAssistantMessagePayload,
  UpdateAssistantConversationPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export const assistantEndpoints = {
  assistant: {
    list: () => apiFetch<AssistantConversationDto[]>('/assistant/conversations'),
    create: (body: CreateAssistantConversationPayload) =>
      apiFetch<AssistantConversationDto>('/assistant/conversations', { method: 'POST', body }),
    get: (id: string) => apiFetch<AssistantConversationDetailDto>(`/assistant/conversations/${id}`),
    update: (id: string, body: UpdateAssistantConversationPayload) =>
      apiFetch<AssistantConversationDto>(`/assistant/conversations/${id}`, { method: 'PATCH', body }),
    send: (id: string, body: SendAssistantMessagePayload) =>
      apiFetch<{ message: AssistantMessageDto; turn: AssistantTurnDto }>(`/assistant/conversations/${id}/messages`, {
        method: 'POST',
        body,
      }),
    decide: (turnId: string, body: AssistantApprovalPayload) =>
      apiFetch<AssistantTurnDto>(`/assistant/turns/${turnId}/approval`, { method: 'POST', body }),
    cancel: (turnId: string) => apiFetch<AssistantTurnDto>(`/assistant/turns/${turnId}/cancel`, { method: 'POST' }),
  },
};

export const assistantKeys = {
  assistantConversations: ['assistant', 'conversations'] as const,
  assistantConversation: (id: string) => ['assistant', 'conversations', id] as const,
};
```

Register in `endpoints/index.ts`: import, `export * from './assistant'`, spread into `api` and `queryKeys`.

```ts
// apps/web/src/lib/api/stream.ts
import { API_PUBLIC_URL, toApiError } from './config';
import { silentRefresh } from './client';

export interface SseEvent {
  id?: string;
  event: string;
  data: string;
}

/** Split a buffer into complete SSE events; return the incomplete tail. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, '\n');
  const blocks = normalised.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let id: string | undefined;
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') id = value;
      else if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ ...(id !== undefined ? { id } : {}), event, data: data.join('\n') });
  }
  return { events, rest };
}

/**
 * Credentialed SSE over fetch (cookies, not EventSource) so it shares the
 * API client's silent-refresh behaviour. Resolves when the server closes.
 */
export async function openEventStream(
  path: string,
  opts: { lastEventId?: string; signal: AbortSignal; onEvent: (event: SseEvent) => void },
  retried = false,
): Promise<void> {
  const response = await fetch(`${API_PUBLIC_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/event-stream', ...(opts.lastEventId ? { 'Last-Event-ID': opts.lastEventId } : {}) },
    signal: opts.signal,
  });
  if (response.status === 401 && !retried && (await silentRefresh())) {
    return openEventStream(path, opts, true);
  }
  if (!response.ok || !response.body) throw await toApiError(response);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    events.forEach(opts.onEvent);
  }
}
```

`Last-Event-ID` is a non-simple header, so the browser sends a CORS preflight. Confirm the API's CORS config (`grep -rn "enableCors" apps/api/src/main.ts`) allows request headers generally or add `'Last-Event-ID'` to `allowedHeaders` there; include that change in this task's commit.

```ts
// apps/web/src/hooks/use-assistant-stream.ts
'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantConversationDetailDto, AssistantMessageDto, AssistantTurnDto } from '@saas/shared';
import { ACTIVE_ASSISTANT_TURN_STATUSES } from '@saas/shared';
import { queryKeys } from '@/lib/api/endpoints';
import { openEventStream } from '@/lib/api/stream';

export function mergeMessages(
  detail: AssistantConversationDetailDto,
  incoming: AssistantMessageDto[],
): AssistantConversationDetailDto {
  const seen = new Set(detail.messages.map((m) => m.seq));
  const fresh = incoming.filter((m) => !seen.has(m.seq));
  if (fresh.length === 0) return detail;
  const messages = [...detail.messages, ...fresh].sort((a, b) => a.seq - b.seq);
  let activeTurn = detail.activeTurn;
  for (const row of fresh.sort((a, b) => a.seq - b.seq)) {
    const turn = row.role === 'status' ? (row.payload?.turn as AssistantTurnDto | undefined) : undefined;
    if (turn) {
      activeTurn = (ACTIVE_ASSISTANT_TURN_STATUSES as readonly string[]).includes(turn.status) ? turn : null;
    }
  }
  return { ...detail, messages, activeTurn };
}

/** Live transcript for one conversation. Reconnects with backoff and resumes from the last seq. */
export function useAssistantStream(conversationId: string | null): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    const key = queryKeys.assistantConversation(conversationId);
    const controller = new AbortController();
    let attempt = 0;

    const lastSeq = () => {
      const detail = queryClient.getQueryData<AssistantConversationDetailDto>(key);
      return detail?.messages.at(-1)?.seq;
    };

    const loop = async () => {
      while (!controller.signal.aborted) {
        try {
          const last = lastSeq();
          setConnected(true);
          await openEventStream(`/assistant/conversations/${conversationId}/stream`, {
            signal: controller.signal,
            ...(last !== undefined ? { lastEventId: String(last) } : {}),
            onEvent: (event) => {
              attempt = 0;
              if (event.event !== 'message') return;
              const row = JSON.parse(event.data) as AssistantMessageDto;
              queryClient.setQueryData<AssistantConversationDetailDto>(key, (detail) =>
                detail ? mergeMessages(detail, [row]) : detail,
              );
            },
          });
        } catch {
          if (controller.signal.aborted) return;
        }
        setConnected(false);
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 500 * 2 ** attempt)));
      }
    };
    void loop();
    return () => controller.abort();
  }, [conversationId, queryClient]);

  return { connected };
}
```

```ts
// apps/web/src/hooks/use-assistant.ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AssistantApprovalPayload,
  AssistantConversationDetailDto,
  CreateAssistantConversationPayload,
  SendAssistantMessagePayload,
  UpdateAssistantConversationPayload,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { mergeMessages } from './use-assistant-stream';

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.isForbidden ? "You don't have permission to do that" : error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useAssistantConversations(enabled = true) {
  return useQuery({ queryKey: queryKeys.assistantConversations, queryFn: () => api.assistant.list(), enabled });
}

export function useAssistantConversation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.assistantConversation(id ?? 'none'),
    queryFn: () => api.assistant.get(id!),
    enabled: Boolean(id),
  });
}

export function useCreateAssistantConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAssistantConversationPayload) => api.assistant.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations }),
    onError: (error) => toast.error(describe(error, 'Could not start a chat')),
  });
}

export function useUpdateAssistantConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAssistantConversationPayload }) => api.assistant.update(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations }),
    onError: (error) => toast.error(describe(error, 'Could not update the chat')),
  });
}

export function useSendAssistantMessage(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendAssistantMessagePayload) => api.assistant.send(conversationId!, body),
    onSuccess: ({ message, turn }) => {
      queryClient.setQueryData<AssistantConversationDetailDto>(
        queryKeys.assistantConversation(conversationId!),
        (detail) => (detail ? { ...mergeMessages(detail, [message]), activeTurn: turn.status === 'FAILED' ? null : turn } : detail),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations });
    },
    onError: (error) => toast.error(describe(error, 'Could not send the message')),
  });
}

export function useDecideAssistantTurn(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ turnId, body }: { turnId: string; body: AssistantApprovalPayload }) => api.assistant.decide(turnId, body),
    onSuccess: (turn) =>
      queryClient.setQueryData<AssistantConversationDetailDto>(queryKeys.assistantConversation(conversationId!), (d) =>
        d ? { ...d, activeTurn: turn } : d,
      ),
    onError: (error) => toast.error(describe(error, 'Could not record your decision')),
  });
}

export function useCancelAssistantTurn(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (turnId: string) => api.assistant.cancel(turnId),
    onSuccess: () =>
      queryClient.setQueryData<AssistantConversationDetailDto>(queryKeys.assistantConversation(conversationId!), (d) =>
        d ? { ...d, activeTurn: null } : d,
      ),
    onError: (error) => toast.error(describe(error, 'Could not stop the assistant')),
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web test -- stream use-assistant-stream composition`
Expected: PASS (including the existing `endpoints/composition.spec.ts`, which checks the endpoint composition).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib apps/web/src/hooks apps/api/src/main.ts
git commit -m "feat(web): add assistant endpoints, credentialed SSE reader and hooks"
```

---

### Task 8: Web UI — panel, approval card, launcher, page context, `/assistant`

**Files:**
- Create: `apps/web/src/components/assistant/page-context.ts` (+ `page-context.test.ts`)
- Create: `apps/web/src/components/assistant/assistant-provider.tsx`
- Create: `apps/web/src/components/assistant/approval-card.tsx` (+ `approval-card.test.tsx`)
- Create: `apps/web/src/components/assistant/assistant-thread.tsx`
- Create: `apps/web/src/components/assistant/assistant-composer.tsx`
- Create: `apps/web/src/components/assistant/conversation-list.tsx`
- Create: `apps/web/src/components/assistant/assistant-panel.tsx`
- Create: `apps/web/src/components/assistant/assistant-launcher.tsx`
- Create: `apps/web/src/app/(app)/assistant/page.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/src/lib/nav.ts`
- Modify: `apps/web/package.json` (add `react-markdown`)

**Interfaces:**
- Consumes: Task 7 hooks; `useSession().check`, `PERMISSIONS.ASSISTANT_USE`; `Button` from `@/components/ui/button`.
- Produces:
  - `pageContextFor(pathname: string, labels?: { title?: string }): AssistantPageContext | null`
  - `AssistantProvider` + `useAssistant(): { open: boolean; setOpen(v: boolean): void; conversationId: string | null; setConversationId(id: string | null): void; pageContext: AssistantPageContext | null }`
  - `<ApprovalCard turn={AssistantTurnDto} pendingAction={AssistantPendingAction} onDecide={(approved: boolean, note?: string) => void} disabled?: boolean expired?: boolean onRetry?: () => void />`
  - `<AssistantThread conversationId={string} variant="panel" | "page" />` — messages + composer for one conversation.

- [ ] **Step 1: Write the failing tests**

```ts
// page-context.test.ts
import { describe, expect, it } from 'vitest';
import { pageContextFor } from './page-context';

describe('pageContextFor', () => {
  it.each([
    ['/quotes/9b1c', { entity: 'quote', id: '9b1c' }],
    ['/contacts/c-1', { entity: 'contact', id: 'c-1' }],
    ['/customers/x', { entity: 'customer', id: 'x' }],
    ['/orders/o-1', { entity: 'sales_order', id: 'o-1' }],
    ['/purchasing/orders/p-1', { entity: 'purchase_order', id: 'p-1' }],
    ['/production/w-1', { entity: 'work_order', id: 'w-1' }],
    ['/objects/projects/r-1', { entity: 'custom_record:projects', id: 'r-1' }],
  ])('%s', (path, expected) => {
    expect(pageContextFor(path)).toEqual(expected);
  });

  it('returns null for list pages and unknown routes', () => {
    expect(pageContextFor('/quotes')).toBeNull();
    expect(pageContextFor('/settings/ai')).toBeNull();
  });

  it('uses the page title as the label when given', () => {
    expect(pageContextFor('/quotes/q-1', { title: 'Q-1042' })).toEqual({ entity: 'quote', id: 'q-1', label: 'Q-1042' });
  });
});
```

```tsx
// approval-card.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovalCard } from './approval-card';

const pendingAction = {
  tool: { id: 'c2', name: 'channel_message.send', args: {} },
  preview: { summary: 'Send to Ada Acme (+9715…) via WHATSAPP_META:\n\nSamples ship Monday.' },
};

describe('ApprovalCard', () => {
  it('shows the full preview text', () => {
    render(<ApprovalCard pendingAction={pendingAction} onDecide={vi.fn()} />);
    expect(screen.getByText(/Samples ship Monday\./)).toBeInTheDocument();
  });

  it('approves once and disables both buttons while pending', () => {
    const onDecide = vi.fn();
    const { rerender } = render(<ApprovalCard pendingAction={pendingAction} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onDecide).toHaveBeenCalledWith(true, undefined);
    rerender(<ApprovalCard pendingAction={pendingAction} onDecide={onDecide} disabled />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  });

  it('rejects with a note', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard pendingAction={pendingAction} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    fireEvent.change(screen.getByPlaceholderText(/why/i), { target: { value: 'wrong tone' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm reject/i }));
    expect(onDecide).toHaveBeenCalledWith(false, 'wrong tone');
  });

  it('shows Expired with a retry action', () => {
    const onRetry = vi.fn();
    render(<ApprovalCard pendingAction={pendingAction} onDecide={vi.fn()} expired onRetry={onRetry} />);
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- assistant`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Install markdown rendering: `pnpm --filter web add react-markdown@10.1.0` (pin exact).

```ts
// page-context.ts
import type { AssistantPageContext } from '@saas/shared';

/** Detail routes the assistant understands as "this …". List pages give no context. */
const ROUTES: Array<[RegExp, (m: RegExpMatchArray) => { entity: string; id: string }]> = [
  [/^\/purchasing\/orders\/([^/]+)$/, (m) => ({ entity: 'purchase_order', id: m[1] })],
  [/^\/purchasing\/bills\/([^/]+)$/, (m) => ({ entity: 'supplier_bill', id: m[1] })],
  [/^\/quotes\/([^/]+)$/, (m) => ({ entity: 'quote', id: m[1] })],
  [/^\/contacts\/([^/]+)$/, (m) => ({ entity: 'contact', id: m[1] })],
  [/^\/customers\/([^/]+)$/, (m) => ({ entity: 'customer', id: m[1] })],
  [/^\/orders\/([^/]+)$/, (m) => ({ entity: 'sales_order', id: m[1] })],
  [/^\/production\/([^/]+)$/, (m) => ({ entity: 'work_order', id: m[1] })],
  [/^\/objects\/([^/]+)\/([^/]+)$/, (m) => ({ entity: `custom_record:${m[1]}`, id: m[2] })],
];

export function pageContextFor(pathname: string, labels?: { title?: string }): AssistantPageContext | null {
  for (const [pattern, build] of ROUTES) {
    const match = pathname.match(pattern);
    if (match) return { ...build(match), ...(labels?.title ? { label: labels.title } : {}) };
  }
  return null;
}
```

Check inbox thread routes: `ls apps/web/src/app/(app)/inbox` — if a thread is addressed by query string (e.g. `?contactId=`), extend `pageContextFor` to accept `searchParams` and map `/inbox?contactId=X` → `{ entity: 'contact', id: X }`, with a test case. If the inbox has no per-thread URL, leave it.

```tsx
// assistant-provider.tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { AssistantPageContext } from '@saas/shared';
import { pageContextFor } from './page-context';

interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  pageContext: AssistantPageContext | null;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const pageContext = useMemo(() => pageContextFor(pathname), [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, conversationId, setConversationId, pageContext }),
    [open, conversationId, pageContext],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return value;
}
```

```tsx
// approval-card.tsx
'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AssistantPendingAction } from '@saas/shared';
import { Button } from '@/components/ui/button';

interface ApprovalCardProps {
  pendingAction: AssistantPendingAction;
  onDecide: (approved: boolean, note?: string) => void;
  disabled?: boolean;
  expired?: boolean;
  onRetry?: () => void;
}

export function ApprovalCard({ pendingAction, onDecide, disabled, expired, onRetry }: ApprovalCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const summary =
    typeof pendingAction.preview.summary === 'string'
      ? pendingAction.preview.summary
      : JSON.stringify(pendingAction.preview, null, 2);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-semibold text-ink">
        <ShieldCheck className="size-4 text-amber-600" />
        Needs your approval · <span className="font-mono text-xs text-ink-muted">{pendingAction.tool.name}</span>
      </div>
      <p className="whitespace-pre-wrap text-ink">{summary}</p>

      {expired ? (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-ink-muted">Expired</span>
          {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
        </div>
      ) : rejecting ? (
        <div className="mt-3 space-y-2">
          <textarea
            className="w-full rounded-lg border border-border bg-surface p-2 text-sm"
            placeholder="Why? (optional — the assistant will see this)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={disabled} onClick={() => onDecide(false, note.trim() || undefined)}>
              Confirm reject
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setRejecting(false)}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={disabled} onClick={() => onDecide(true, undefined)}>Approve</Button>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setRejecting(true)}>Reject</Button>
        </div>
      )}
    </div>
  );
}
```

Check `components/ui/button.tsx` for the exact `variant` and `size` names it supports and use those (replace `danger`/`secondary`/`ghost`/`sm` with the kit's names if they differ). Do the same in the components below.

```tsx
// assistant-composer.tsx
'use client';

import { useState } from 'react';
import { Send, Square, X } from 'lucide-react';
import type { AssistantPageContext } from '@saas/shared';
import { Button } from '@/components/ui/button';

interface ComposerProps {
  busy: boolean;
  pageContext: AssistantPageContext | null;
  onSend: (content: string, context: AssistantPageContext | null) => void;
  onStop: () => void;
}

export function AssistantComposer({ busy, pageContext, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState('');
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const context = pageContext && dismissedFor !== `${pageContext.entity}:${pageContext.id}` ? pageContext : null;

  const submit = () => {
    const content = value.trim();
    if (!content || busy) return;
    onSend(content, context);
    setValue('');
  };

  return (
    <div className="border-t border-border p-3">
      {context && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
          Viewing: {context.label ?? `${context.entity} ${context.id.slice(0, 8)}`}
          <button aria-label="Don't include page context" onClick={() => setDismissedFor(`${context.entity}:${context.id}`)}>
            <X className="size-3" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message the assistant"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border bg-surface p-2 text-sm"
          placeholder={busy ? 'The assistant is working…' : 'Ask about a customer, a quote, a thread…'}
          value={value}
          maxLength={4000}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <Button size="sm" variant="secondary" onClick={onStop} aria-label="Stop">
            <Square className="size-4" />
          </Button>
        ) : (
          <Button size="sm" onClick={submit} aria-label="Send" disabled={!value.trim()}>
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
```

```tsx
// assistant-thread.tsx
'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, ChevronRight, Loader2, Wrench } from 'lucide-react';
import type { AssistantMessageDto, AssistantPendingAction } from '@saas/shared';
import { cn } from '@/lib/utils';
import {
  useAssistantConversation,
  useCancelAssistantTurn,
  useDecideAssistantTurn,
  useSendAssistantMessage,
} from '@/hooks/use-assistant';
import { useAssistantStream } from '@/hooks/use-assistant-stream';
import { ApprovalCard } from './approval-card';
import { AssistantComposer } from './assistant-composer';
import { useAssistant } from './assistant-provider';

function StepRow({ message }: { message: AssistantMessageDto }) {
  const isError = message.role === 'tool_result' && typeof message.payload?.error === 'string';
  return (
    <details className={cn('rounded-lg px-2 py-1 text-xs', isError ? 'text-red-600' : 'text-ink-muted')}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        {isError ? <AlertTriangle className="size-3" /> : message.role === 'tool_call' ? <Wrench className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="truncate">{message.content.split('\n')[0]}</span>
      </summary>
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{message.content}</pre>
    </details>
  );
}

export function AssistantThread({ conversationId, variant }: { conversationId: string; variant: 'panel' | 'page' }) {
  const { pageContext } = useAssistant();
  const { data, isLoading } = useAssistantConversation(conversationId);
  const { connected } = useAssistantStream(conversationId);
  const send = useSendAssistantMessage(conversationId);
  const decide = useDecideAssistantTurn(conversationId);
  const cancel = useCancelAssistantTurn(conversationId);
  const bottom = useRef<HTMLDivElement>(null);

  const messages = data?.messages ?? [];
  const activeTurn = data?.activeTurn ?? null;
  const busy = Boolean(activeTurn) || send.isPending;

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages.length]);

  if (isLoading) return <div className="grid flex-1 place-items-center"><Loader2 className="size-5 animate-spin text-ink-subtle" /></div>;

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex-1 space-y-2 overflow-y-auto p-3', variant === 'page' && 'px-6')}>
        {messages.length === 0 && (
          <p className="pt-8 text-center text-sm text-ink-muted">
            Ask about your customers, quotes, orders or channel threads. Nothing changes without your approval.
          </p>
        )}
        {messages.map((message) => {
          if (message.role === 'status') {
            const status = (message.payload?.turn as { status?: string } | undefined)?.status;
            if (status === 'FAILED' || status === 'CANCELLED') {
              const error = (message.payload?.turn as { error?: string } | undefined)?.error;
              return (
                <p key={message.seq} className="text-center text-xs text-ink-subtle">
                  {status === 'CANCELLED' ? 'Stopped.' : `Couldn't finish: ${error ?? 'unknown error'}`}
                </p>
              );
            }
            return null;
          }
          if (message.role === 'user') {
            return (
              <div key={message.seq} className="ml-8 rounded-2xl rounded-br-sm bg-brand/10 px-3 py-2 text-sm whitespace-pre-wrap">
                {message.content}
              </div>
            );
          }
          if (message.role === 'assistant') {
            return (
              <div key={message.seq} className="prose prose-sm mr-8 max-w-none rounded-2xl rounded-bl-sm bg-surface-muted px-3 py-2 text-sm">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            );
          }
          if (message.role === 'approval') {
            const isLive = activeTurn?.status === 'AWAITING_APPROVAL' && activeTurn.id === message.turnId;
            const finishedTurn = messages.find(
              (m) => m.role === 'status' && m.turnId === message.turnId && (m.payload?.turn as { status?: string })?.status === 'TIMED_OUT',
            );
            return (
              <ApprovalCard
                key={message.seq}
                pendingAction={message.payload as unknown as AssistantPendingAction}
                disabled={!isLive || decide.isPending}
                expired={Boolean(finishedTurn)}
                onRetry={lastUserMessage ? () => send.mutate({ content: lastUserMessage.content }) : undefined}
                onDecide={(approved, note) =>
                  activeTurn && decide.mutate({ turnId: activeTurn.id, body: note ? { approved, note } : { approved } })
                }
              />
            );
          }
          return <StepRow key={message.seq} message={message} />;
        })}
        {activeTurn?.status === 'RUNNING' && (
          <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
            <Loader2 className="size-3 animate-spin" /> {connected ? 'Working…' : 'Reconnecting…'}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <AssistantComposer
        busy={busy}
        pageContext={pageContext}
        onSend={(content, context) => send.mutate(context ? { content, context } : { content })}
        onStop={() => activeTurn && cancel.mutate(activeTurn.id)}
      />
    </div>
  );
}
```

```tsx
// conversation-list.tsx
'use client';

import { MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAssistantConversations } from '@/hooks/use-assistant';

export function ConversationList({
  activeId,
  onSelect,
  onNew,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { data = [] } = useAssistantConversations();
  return (
    <div className="flex flex-col gap-1 p-2">
      <button onClick={onNew} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-surface-muted">
        <MessageSquarePlus className="size-4" /> New chat
      </button>
      {data.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={cn('truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted', c.id === activeId && 'bg-surface-muted font-semibold')}
        >
          {c.title}
        </button>
      ))}
    </div>
  );
}
```

```tsx
// assistant-panel.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History, Maximize2, MessageSquarePlus, Sparkles, X } from 'lucide-react';
import { useAiConfigs } from '@/hooks/use-ai';
import { useCreateAssistantConversation } from '@/hooks/use-assistant';
import { useAssistant } from './assistant-provider';
import { AssistantThread } from './assistant-thread';
import { ConversationList } from './conversation-list';

export function AssistantPanel() {
  const { open, setOpen, conversationId, setConversationId, pageContext } = useAssistant();
  const [showHistory, setShowHistory] = useState(false);
  const create = useCreateAssistantConversation();

  if (!open) return null;

  const startNew = async () => {
    const conversation = await create.mutateAsync(pageContext ? { context: pageContext } : {});
    setConversationId(conversation.id);
    setShowHistory(false);
  };

  return (
    <aside
      role="dialog"
      aria-label="Assistant"
      className="fixed inset-0 z-50 flex flex-col border-l border-border bg-surface shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[420px] print:hidden"
    >
      <header className="flex h-14 items-center gap-1 border-b border-border px-3">
        <Sparkles className="size-4 text-brand" />
        <span className="flex-1 truncate text-sm font-semibold">Assistant</span>
        <button aria-label="Conversation history" onClick={() => setShowHistory((v) => !v)} className="rounded-md p-1.5 hover:bg-surface-muted"><History className="size-4" /></button>
        <button aria-label="New chat" onClick={startNew} className="rounded-md p-1.5 hover:bg-surface-muted"><MessageSquarePlus className="size-4" /></button>
        <Link aria-label="Open full page" href={conversationId ? `/assistant?c=${conversationId}` : '/assistant'} onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-surface-muted"><Maximize2 className="size-4" /></Link>
        <button aria-label="Close assistant" onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-surface-muted"><X className="size-4" /></button>
      </header>
      {showHistory ? (
        <ConversationList activeId={conversationId} onSelect={(id) => { setConversationId(id); setShowHistory(false); }} onNew={startNew} />
      ) : conversationId ? (
        <AssistantThread conversationId={conversationId} variant="panel" />
      ) : (
        <EmptyState onStart={startNew} />
      )}
    </aside>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  const { data: configs } = useAiConfigs();
  const configured = configs?.some((c) => c.isEnabled && c.status === 'configured') ?? true;
  if (!configured) {
    return (
      <div className="p-6 text-sm text-ink-muted">
        The assistant needs an AI provider. An admin can set one up in{' '}
        <Link href="/settings/ai" className="text-brand underline">Settings → AI</Link>.
      </div>
    );
  }
  return (
    <div className="grid flex-1 place-items-center p-6">
      <button onClick={onStart} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">Start a chat</button>
    </div>
  );
}
```

Check `hooks/use-ai.ts` (or `use-ai-agents.ts`) for the hook that lists AI configs and its exact name; if listing configs requires `ai:manage`, a member gets 403 — in that case treat an error as "configured" (the hook's `data` is undefined → `?? true`) so members are not shown a false empty state.

```tsx
// assistant-launcher.tsx
'use client';

import { Sparkles } from 'lucide-react';
import { useAssistant } from './assistant-provider';

export function AssistantLauncher() {
  const { open, setOpen } = useAssistant();
  return (
    <button
      onClick={() => setOpen(!open)}
      aria-label="Open assistant (Ctrl+J)"
      title="Assistant (Ctrl/⌘ J)"
      className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted"
    >
      <Sparkles className="size-5" />
    </button>
  );
}
```

```tsx
// apps/web/src/app/(app)/assistant/page.tsx
'use client';

import { use, useEffect } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { Can } from '@/components/auth/can';
import { useCreateAssistantConversation } from '@/hooks/use-assistant';
import { useAssistant } from '@/components/assistant/assistant-provider';
import { AssistantThread } from '@/components/assistant/assistant-thread';
import { ConversationList } from '@/components/assistant/conversation-list';

export default function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = use(searchParams);
  const { conversationId, setConversationId } = useAssistant();
  const create = useCreateAssistantConversation();

  useEffect(() => {
    if (c) setConversationId(c);
  }, [c, setConversationId]);

  return (
    <Can permission={PERMISSIONS.ASSISTANT_USE} fallback={<p className="text-sm text-ink-muted">You don&apos;t have access to the assistant.</p>}>
      <div className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border">
          <ConversationList
            activeId={conversationId}
            onSelect={setConversationId}
            onNew={async () => setConversationId((await create.mutateAsync({})).id)}
          />
        </div>
        {conversationId ? (
          <AssistantThread conversationId={conversationId} variant="page" />
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-ink-muted">Pick a chat or start a new one.</div>
        )}
      </div>
    </Can>
  );
}
```

`app-shell.tsx`:
- Wrap the returned tree in `<AssistantProvider>` (import from `@/components/assistant/assistant-provider`).
- In the header, before `<NotificationBell />`: `{check({ permission: PERMISSIONS.ASSISTANT_USE }) && <AssistantLauncher />}`.
- After the main content `div`, render `{check({ permission: PERMISSIONS.ASSISTANT_USE }) && <AssistantPanel />}`.
- The Ctrl/⌘J listener lives in the provider; for users without the permission, render the provider but not the launcher or panel, so the shortcut does nothing visible.

`lib/nav.ts` — add to `CORE_ACTION_ITEMS` after Inbox:

```ts
  {
    href: '/assistant',
    label: 'Assistant',
    icon: Sparkles,
    rule: { permission: PERMISSIONS.ASSISTANT_USE },
  },
```

(import `Sparkles` from `lucide-react` alongside the existing icons).

- [ ] **Step 4: Run tests, typecheck, lint the new files**

Run: `pnpm --filter web test && pnpm --filter web build`
Expected: all tests PASS; build succeeds. Then `pnpm --filter web exec eslint src/components/assistant src/hooks/use-assistant*.ts src/lib/api/stream.ts` — fix anything in the new files (pre-existing lint errors elsewhere are not this task's).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): add assistant slide-over panel, approval card and /assistant page"
```

---

### Task 9: End-to-end verification and docs

**Files:**
- Modify: `docs/FLAGS.md` (deferred work: token streaming, attachments, phone search in contact resolution)
- Modify: `CLAUDE.md` (one short paragraph under "Rules that matter")

- [ ] **Step 1: Full test and schema run**

Run: `pnpm --filter @saas/shared build && pnpm --filter api test && pnpm --filter web test && pnpm check:drift`
Expected: all PASS.

- [ ] **Step 2: Manual end-to-end (seeded data)**

`pnpm db:reset && pnpm migration:run && pnpm seed`, start `pnpm dev` and the Temporal worker, configure an AI provider in Settings → AI, and enable a channel (WhatsApp or email) in Settings → Channels with at least one message for a contact (use the inbox to send one).

As the admin seed user:
1. Open a contact detail page, press Ctrl/⌘J. The context chip shows the contact.
2. Ask: "show me this contact's last messages and draft a follow-up". Expect step rows (thread read) and a drafted message in the answer.
3. Say "send it". Expect an approval card with recipient, provider and full text. Open the same conversation in a second tab (`/assistant?c=<id>`); the card shows there too (Review Focus #1).
4. Click Approve in both tabs quickly. One succeeds; the other shows a toast "no longer waiting for approval" (Review Focus #2). One outbound row appears in the inbox.
5. In psql: `SELECT action, origin, origin_channel, origin_message_id FROM audit_logs ORDER BY created_at DESC LIMIT 3;` (check the table name with `\dt audit*`). Expect `channel_message.send.executed`, `AI_ASSISTED`, `ASSISTANT`, a non-null message id.
6. Mid-turn, toggle the browser offline for 5s and back. The transcript catches up with no duplicates (Review Focus #3).
7. Stop the worker, send a message, wait 5+ minutes: the turn shows "Couldn't finish: The assistant stopped responding".

As the member seed user (no `channel:send` unless the seed grants it — check `packages/shared/src/rbac/permissions/comms.ts` grants; if members have `channel:send`, remove it from a test role in Settings → Roles):
8. Ask the assistant to message a contact. It must say it can't send; no approval card appears (Review Focus #5).

- [ ] **Step 3: Docs**

`CLAUDE.md`, under "Rules that matter":

```markdown
**The in-app assistant reuses the agent workflow, not a second engine.** Each chat message starts `agentReActWorkflow` on `assistant-queue` with an `eventSink`; every step is a row in `assistant_messages` (the SSE stream replays rows by `seq`, Redis only nudges). New tools are `ChannelSkill`s registered in `skill.registry.ts`; anything mutating needs approval unless its name starts with `draft_`.
```

`docs/FLAGS.md` — add an "In-app assistant" section listing: no token streaming (final answer arrives whole); no attachments; contact resolution doesn't search by phone; the assistant module is loaded in the worker too (sweep cron inert there by design).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/FLAGS.md
git commit -m "docs: document the in-app assistant architecture and deferred work"
```
