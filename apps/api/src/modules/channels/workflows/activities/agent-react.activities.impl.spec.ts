const mockActivityInfo = {
  workflowExecution: { workflowId: 'agent-wf-1', runId: 'run-1' },
  activityId: '7',
  attempt: 1,
};
jest.mock('@temporalio/activity', () => ({
  ApplicationFailure: jest.requireActual('@temporalio/activity').ApplicationFailure,
  Context: { current: () => ({ info: mockActivityInfo }) },
}));

import { createAgentReactActivities } from './agent-react.activities.impl';

/** Same contract as ChannelIdempotencyService.runOnce, in memory. */
function makeIdempotency() {
  const done = new Map<string, unknown>();
  return {
    done,
    runOnce: jest.fn(
      async (tenantId: string, key: string, fn: () => Promise<unknown>) => {
        const k = `${tenantId}:${key}`;
        if (done.has(k)) return done.get(k);
        const result = await fn();
        done.set(k, result);
        return result;
      },
    ),
  };
}

function makeActivities() {
  const skill = {
    name: 'draft_quote',
    description: 'Draft a quote',
    isMutating: true,
    promptVersion: 'test/1',
    jsonSchema: {},
    requiredPermissions: [],
    resolve: jest.fn().mockResolvedValue({
      kind: 'resolved',
      value: { title: 'Boxes' },
    }),
    preview: jest.fn().mockResolvedValue('Draft quote Boxes'),
    pinArgs: undefined as undefined | ((v: unknown) => Record<string, unknown>),
    execute: jest.fn().mockImplementation(async () => ({
      reply: 'Drafted',
      resultType: 'QUOTE',
      resultId: `quote-${skill.execute.mock.calls.length}`,
    })),
  };
  const idempotency = makeIdempotency();
  const auditService = { record: jest.fn() };
  const skillRegistry = { permittedFor: jest.fn(() => [skill]) };
  const aiService = { generateStructured: jest.fn() };
  const activities = createAgentReactActivities({
    aiService: aiService as any,
    rbacService: {
      resolveAccess: jest.fn().mockResolvedValue({ permissions: [] }),
    } as any,
    skillRegistry: skillRegistry as any,
    auditService: auditService as any,
    customObjectToolFactory: {} as any,
    customObjectsService: {} as any,
    customRecordsService: {} as any,
    tenantContext: { runWithTenant: (_t: string, fn: any) => fn() } as any,
    idempotency: idempotency as any,
  });
  return { activities, skill, idempotency, auditService, skillRegistry, aiService };
}

const ctx = { organizationId: 'org-1', userId: 'user-1', message: 'draft it' };
const tool = { id: 'call-1', name: 'draft_quote', args: { title: 'Boxes' } };

describe('executeToolActivity idempotency', () => {
  beforeEach(() => {
    mockActivityInfo.workflowExecution.workflowId = 'agent-wf-1';
  });

  it('does not repeat a mutating tool when the activity is retried', async () => {
    const { activities, skill } = makeActivities();

    const first = await activities.executeToolActivity(tool, ctx);
    const retry = await activities.executeToolActivity(tool, ctx);

    expect(skill.execute).toHaveBeenCalledTimes(1);
    expect(retry).toEqual(first);
    expect(first.output).toEqual(
      expect.objectContaining({ resultId: 'quote-1' }),
    );
  });

  it('keys the guard on (workflowId, toolCallId)', async () => {
    const { activities, skill, idempotency } = makeActivities();

    await activities.executeToolActivity(tool, ctx);
    await activities.executeToolActivity({ ...tool, id: 'call-2' }, ctx);
    mockActivityInfo.workflowExecution.workflowId = 'agent-wf-2';
    await activities.executeToolActivity(tool, ctx);

    expect(skill.execute).toHaveBeenCalledTimes(3);
    const keys = idempotency.runOnce.mock.calls.map((c) => c[1]);
    expect(keys[0]).toContain('agent-wf-1');
    expect(keys[0]).toContain('call-1');
  });
});

describe('commitToolMutationActivity provenance', () => {
  it('records assistant provenance on committed mutations', async () => {
    const { activities, auditService } = makeActivities();
    await activities.commitToolMutationActivity(tool, {
      ...ctx,
      audit: { channel: 'ASSISTANT', messageId: 'msg-1' },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'AI_ASSISTED',
        channel: 'ASSISTANT',
        messageId: 'msg-1',
      }),
    );
  });

  it('keeps SYSTEM provenance when no audit context is given', async () => {
    const { activities, auditService } = makeActivities();
    await activities.commitToolMutationActivity(tool, ctx);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'SYSTEM', messageId: null }),
    );
  });
});

describe('surfaces', () => {
  it('treats a caller without a surface as an automation', async () => {
    const { activities, skillRegistry } = makeActivities();
    await activities.listAvailableTools({ organizationId: 'org-1', userId: 'user-1' });
    await activities.executeToolActivity(tool, ctx);
    expect(skillRegistry.permittedFor.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      'automation',
      'automation',
    ]);
  });

  it('lists and resolves assistant-only skills for the assistant surface', async () => {
    const { activities, skillRegistry } = makeActivities();
    await activities.listAvailableTools({ organizationId: 'org-1', userId: 'user-1', surface: 'assistant' });
    await activities.executeToolActivity(tool, { ...ctx, surface: 'assistant' });
    await activities.commitToolMutationActivity(tool, { ...ctx, surface: 'assistant' });
    expect(skillRegistry.permittedFor.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      'assistant',
      'assistant',
      'assistant',
    ]);
  });
});

describe('planReActTurn tool-call ids', () => {
  it('replaces a repeated id within a turn with a fresh one', async () => {
    const { activities, aiService } = makeActivities();
    aiService.generateStructured.mockResolvedValueOnce({
      model: 'm',
      data: {
        thought: '',
        toolCalls: [
          { id: 'call_1', name: 'draft_quote', args: { a: 1 } },
          { id: 'call_1', name: 'draft_quote', args: { a: 2 } },
          { name: 'draft_quote', args: { a: 3 } },
        ],
      },
    });
    const turn = await activities.planReActTurn({
      organizationId: 'org-1',
      userId: 'user-1',
      prompt: 'p',
      conversationHistory: [],
      availableTools: [{ name: 'draft_quote', description: '', inputSchema: {} }],
    });
    const ids = turn.toolCalls!.map((c) => c.id);
    expect(ids[0]).toBe('call_1');
    expect(new Set(ids).size).toBe(3);
    expect(turn.toolCalls!.map((c) => c.args)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });
});

describe('approved action pinning and verification', () => {
  const gated = { id: 'call-9', name: 'quote.create', args: { customer: 'Acme' } };

  it('returns the skill-pinned args with the approval request', async () => {
    const { activities, skill } = makeActivities();
    skill.name = 'quote.create';
    skill.pinArgs = (v: unknown) => ({ pinned: v });
    const result = await activities.executeToolActivity(gated, ctx);
    expect(result).toMatchObject({
      requiresApproval: true,
      previewPayload: { summary: 'Draft quote Boxes' },
      resolvedArgs: { pinned: { title: 'Boxes' } },
    });
    expect(skill.execute).not.toHaveBeenCalled();
  });

  it('omits resolvedArgs for skills that do not pin', async () => {
    const { activities, skill } = makeActivities();
    skill.name = 'quote.create';
    const result = await activities.executeToolActivity(gated, ctx);
    expect(result).not.toHaveProperty('resolvedArgs');
  });

  it('commits when the recomputed preview equals the approved one', async () => {
    const { activities, skill } = makeActivities();
    skill.name = 'quote.create';
    await activities.commitToolMutationActivity(gated, {
      ...ctx,
      approvedPreview: { summary: 'Draft quote Boxes' },
    });
    expect(skill.execute).toHaveBeenCalledTimes(1);
  });

  it('refuses, without executing, when the action changed since approval', async () => {
    const { activities, skill, auditService } = makeActivities();
    skill.name = 'quote.create';
    skill.preview.mockResolvedValue('Draft quote Boxes for a different customer');
    const commit = activities.commitToolMutationActivity(gated, {
      ...ctx,
      approvedPreview: { summary: 'Draft quote Boxes' },
    });
    await expect(commit).rejects.toMatchObject({
      message: 'This action changed since you approved it — ask again.',
      type: 'ApprovedActionChanged',
      nonRetryable: true,
    });
    expect(skill.execute).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('does not check the preview when no approved preview is given (automations)', async () => {
    const { activities, skill } = makeActivities();
    skill.name = 'quote.create';
    await activities.commitToolMutationActivity(gated, ctx);
    expect(skill.preview).not.toHaveBeenCalled();
    expect(skill.execute).toHaveBeenCalledTimes(1);
  });
});

describe('channel_message.send: what executes equals what was approved', () => {
  const { ChannelMessageSendSkill } = jest.requireActual('../../skills/channel-message-send.skill');
  const ada = {
    id: '7f8e1f0a-1111-4222-8333-944455556666',
    fullName: 'Ada Acme',
    email: 'ada@acme.test',
    phone: '+971500000001',
  };

  function harness() {
    let contact = { ...ada };
    const contacts = {
      list: jest.fn(async () => ({ items: [contact], meta: { total: 1 } })),
      findOne: jest.fn(async () => contact),
    };
    const history = { findOne: jest.fn().mockResolvedValue(null) };
    const channels = { sendMessage: jest.fn().mockResolvedValue({ id: 'm-1' }) };
    const skill = new ChannelMessageSendSkill(
      contacts,
      { forContext: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      history,
      () => channels,
    );
    const activities = createAgentReactActivities({
      aiService: {} as any,
      rbacService: { resolveAccess: jest.fn().mockResolvedValue({ permissions: ['channel:send'] }) } as any,
      skillRegistry: { permittedFor: () => [skill] } as any,
      auditService: { record: jest.fn() } as any,
      customObjectToolFactory: {} as any,
      customObjectsService: {} as any,
      customRecordsService: {} as any,
      tenantContext: { runWithTenant: (_t: string, fn: any) => fn() } as any,
      idempotency: makeIdempotency() as any,
    });
    return {
      activities,
      channels,
      history,
      setContact: (patch: Partial<typeof ada>) => (contact = { ...contact, ...patch }),
    };
  }
  const assistantCtx = { ...ctx, surface: 'assistant' as const };
  const planned = { id: 'send-1', name: 'channel_message.send', args: { contact: 'Ada', provider: 'WHATSAPP_META', body: 'Samples ship Monday' } };

  it('commits the pinned send to the approved recipient after the contact changes', async () => {
    const h = harness();
    const gated = await h.activities.executeToolActivity(planned, assistantCtx);
    expect(gated.resolvedArgs).toEqual({
      contact: ada.id,
      provider: 'WHATSAPP_META',
      recipient: '+971500000001',
      body: 'Samples ship Monday',
    });
    h.setContact({ phone: '+971599999999' });
    await h.activities.commitToolMutationActivity(
      { ...planned, args: gated.resolvedArgs!, pinned: true },
      { ...assistantCtx, approvedPreview: gated.previewPayload },
    );
    expect(h.channels.sendMessage).toHaveBeenCalledWith('org-1', 'user-1', {
      contactId: ada.id,
      provider: 'WHATSAPP_META',
      recipient: '+971500000001',
      body: 'Samples ship Monday',
    });
  });

  it('ignores a recipient the planner supplies and uses the contact address', async () => {
    const h = harness();
    const injected = { ...planned, args: { ...planned.args, recipient: '+15550000000' } };
    const gated = await h.activities.executeToolActivity(injected, assistantCtx);
    expect(gated.resolvedArgs).toMatchObject({ recipient: '+971500000001' });
    expect(gated.previewPayload?.summary).not.toContain('+15550000000');
  });

  it('re-derives the recipient when an unpinned commit carries one', async () => {
    const h = harness();
    const gated = await h.activities.executeToolActivity(planned, assistantCtx);
    await h.activities.commitToolMutationActivity(
      { ...planned, args: { ...gated.resolvedArgs!, recipient: '+15550000000' } },
      { ...assistantCtx, approvedPreview: gated.previewPayload },
    );
    expect(h.channels.sendMessage).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      expect.objectContaining({ recipient: '+971500000001' }),
    );
  });

  it('refuses and sends nothing when the preview no longer matches', async () => {
    const h = harness();
    const gated = await h.activities.executeToolActivity(planned, assistantCtx);
    h.setContact({ fullName: 'Ada Acme (left company)' });
    await expect(
      h.activities.commitToolMutationActivity(
        { ...planned, args: gated.resolvedArgs!, pinned: true },
        { ...assistantCtx, approvedPreview: gated.previewPayload },
      ),
    ).rejects.toMatchObject({ type: 'ApprovedActionChanged', nonRetryable: true });
    expect(h.channels.sendMessage).not.toHaveBeenCalled();
  });
});
