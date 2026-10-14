import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AssistantService } from './assistant.service';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantMessage } from './entities/assistant-message.entity';

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
  // The conditional AWAITING_APPROVAL → RUNNING update in decide(): applies the same
  // predicate the SQL does (status and pending_action->'tool'->>'id').
  (turnRepo as any).createQueryBuilder = () => {
    const params: Record<string, unknown> = {};
    let patch: any = {};
    const qb: any = {
      update: () => qb,
      set: (v: any) => ((patch = v), qb),
      where: (_sql: string, p: any) => (Object.assign(params, p), qb),
      andWhere: (_sql: string, p: any) => (Object.assign(params, p), qb),
      execute: async () => {
        const t = turns.get(params.id as string);
        if (!t || t.status !== params.awaiting || t.pendingAction?.tool?.id !== params.toolCallId) return { affected: 0 };
        Object.assign(t, patch);
        return { affected: 1 };
      },
    };
    return qb;
  };
  (turnRepo as any).manager = {
    transaction: async (fn: any) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === AssistantTurn ? turnRepo : entity === AssistantMessage ? msgRepo : convRepo,
      }),
  };
  const workflow = { start: jest.fn().mockResolvedValue({ workflowId: 'wf' }), getHandle: jest.fn() };
  const handle = { signal: jest.fn().mockResolvedValue(undefined), cancel: jest.fn().mockResolvedValue(undefined) };
  workflow.getHandle.mockReturnValue(handle);
  const temporal = { getClient: () => ({ workflow }) } as any;
  const events = { writeStatus: jest.fn().mockResolvedValue(undefined), publish: jest.fn() } as any;
  const service = new AssistantService(convRepo as any, turnRepo as any, msgRepo as any, temporal, events);
  return { service, conversations, turns, messages, workflow, handle, events };
}
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

  it('creates the turn and the user message in one transaction', async () => {
    const h = harness();
    const transaction = jest.spyOn((h.service as any).turns.manager, 'transaction');
    const conv = await h.service.create(alice, {});
    const { message, turn } = await h.service.sendMessage(alice, conv.id, { content: 'hi' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(h.turns.get(turn.id)).toMatchObject({ userMessageId: message.id, workflowId: `assistant-turn-${turn.id}` });
  });

  it('marks the turn FAILED when the workflow cannot start', async () => {
    const h = harness();
    h.workflow.start.mockRejectedValueOnce(new Error('Temporal client is not initialized'));
    const conv = await h.service.create(alice, {});
    const { turn } = await h.service.sendMessage(alice, conv.id, { content: 'hi' });
    expect(turn.status).toBe('FAILED');
    expect(h.events.writeStatus).toHaveBeenCalled();
  });

  async function awaiting(h: ReturnType<typeof harness>, toolId = 'call-B') {
    const conv = await h.service.create(alice, {});
    const { turn } = await h.service.sendMessage(alice, conv.id, { content: 'send it' });
    Object.assign(h.turns.get(turn.id), {
      status: 'AWAITING_APPROVAL',
      pendingAction: { tool: { id: toolId, name: 'channel_message.send', args: {} }, preview: { summary: 'Send' } },
    });
    return turn;
  }

  it('approval is owner-only, only while awaiting, and signals exactly once (Review Focus #2)', async () => {
    const h = harness();
    const turn = await awaiting(h);

    await expect(h.service.decide(bob, turn.id, { approved: true, toolCallId: 'call-B' })).rejects.toBeInstanceOf(NotFoundException);
    await h.service.decide(alice, turn.id, { approved: true, toolCallId: 'call-B' });
    await expect(h.service.decide(alice, turn.id, { approved: true, toolCallId: 'call-B' })).rejects.toBeInstanceOf(ConflictException);
    expect(h.handle.signal).toHaveBeenCalledTimes(1);
    expect(h.handle.signal).toHaveBeenCalledWith(expect.objectContaining({ name: 'agentApprovalSignal' }), {
      approved: true,
      toolId: 'call-B',
    });
  });

  it('a decision for a different tool call than the pending one is a 409 and sends no signal', async () => {
    const h = harness();
    const turn = await awaiting(h, 'call-B');
    await expect(h.service.decide(alice, turn.id, { approved: true, toolCallId: 'call-A' })).rejects.toBeInstanceOf(ConflictException);
    expect(h.handle.signal).not.toHaveBeenCalled();
    expect(h.turns.get(turn.id).status).toBe('AWAITING_APPROVAL');
  });

  it('passes the note through with the tool id', async () => {
    const h = harness();
    const turn = await awaiting(h);
    await h.service.decide(alice, turn.id, { approved: false, toolCallId: 'call-B', note: 'wrong tone' });
    expect(h.handle.signal).toHaveBeenCalledWith(expect.anything(), { approved: false, toolId: 'call-B', note: 'wrong tone' });
  });

  it('rolls the turn back to AWAITING_APPROVAL when the signal cannot be delivered', async () => {
    const h = harness();
    const turn = await awaiting(h);
    h.handle.signal.mockRejectedValueOnce(new Error('worker unreachable'));
    await expect(h.service.decide(alice, turn.id, { approved: true, toolCallId: 'call-B' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(h.turns.get(turn.id).status).toBe('AWAITING_APPROVAL');
    // And the user can try again.
    await h.service.decide(alice, turn.id, { approved: true, toolCallId: 'call-B' });
    expect(h.handle.signal).toHaveBeenCalledTimes(2);
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
