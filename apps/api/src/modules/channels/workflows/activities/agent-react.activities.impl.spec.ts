const mockActivityInfo = {
  workflowExecution: { workflowId: 'agent-wf-1', runId: 'run-1' },
  activityId: '7',
  attempt: 1,
};
jest.mock('@temporalio/activity', () => ({
  ApplicationFailure: jest.requireActual('@temporalio/activity').ApplicationFailure,
  Context: { current: () => ({ info: mockActivityInfo }) },
}));

import { NotFoundException } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/activity';
import { AiProviderError } from '@/modules/ai/interfaces/ai-provider.interface';
import {
  agentSystemPrompt,
  createAgentReactActivities,
  toAiMessages,
} from './agent-react.activities.impl';

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
  const aiService = { generateWithTools: jest.fn() };
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

describe('planReActTurn', () => {
  const tools = [{ name: 'draft_quote', description: 'Draft a quote', inputSchema: {} }];
  const plan = (activities: any, conversationHistory: any[] = [{ role: 'user', content: 'p' }]) =>
    activities.planReActTurn({
      organizationId: 'org-1',
      userId: 'user-1',
      prompt: 'p',
      conversationHistory,
      availableTools: tools,
    });
  const toolTurn = (toolCalls: any[], text = '') => ({
    text,
    toolCalls,
    raw: { provider: 'anthropic', content: [{ type: 'thinking', signature: 's' }] },
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'm',
    stopReason: 'tool_use',
  });

  it('calls the model with native tools, a fixed system prompt and caching', async () => {
    const { activities, aiService } = makeActivities();
    aiService.generateWithTools.mockResolvedValueOnce(
      toolTurn([{ id: 'toolu_1', name: 'draft_quote', input: { a: 1 } }], 'Drafting.'),
    );

    const turn = await plan(activities);

    const [feature, options] = aiService.generateWithTools.mock.calls[0];
    expect(feature).toBe('automations.ai_agent');
    expect(options).toEqual(
      expect.objectContaining({
        tools,
        cache: true,
        messages: [{ role: 'user', content: 'p' }],
        system: expect.stringContaining('never say an action succeeded'),
      }),
    );
    expect(turn).toEqual({
      thought: 'Drafting.',
      model: 'm',
      toolCalls: [{ id: 'toolu_1', name: 'draft_quote', args: { a: 1 } }],
      raw: { provider: 'anthropic', content: [{ type: 'thinking', signature: 's' }] },
    });
  });

  it('returns the text as the final answer when no tool is called', async () => {
    const { activities, aiService } = makeActivities();
    aiService.generateWithTools.mockResolvedValueOnce({
      ...toolTurn([], 'All done.'),
      stopReason: 'end_turn',
    });
    expect(await plan(activities)).toEqual({ thought: '', model: 'm', finalAnswer: 'All done.' });
  });

  it('answers a refusal instead of failing the turn', async () => {
    const { activities, aiService } = makeActivities();
    aiService.generateWithTools.mockResolvedValueOnce({ ...toolTurn([]), stopReason: 'refusal' });
    expect((await plan(activities)).finalAnswer).toBe("I can't help with that request.");
  });

  it('stops Temporal retrying a deterministic provider failure', async () => {
    const { activities, aiService } = makeActivities();
    aiService.generateWithTools.mockRejectedValueOnce(
      new AiProviderError('Anthropic API error: tools.0.name does not match pattern', false),
    );
    const err = await plan(activities).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).message).toContain('does not match pattern');

    aiService.generateWithTools.mockRejectedValueOnce(
      new AiProviderError('Anthropic API error: overloaded'),
    );
    const transient = await plan(activities).catch((e: unknown) => e);
    expect(transient).toBeInstanceOf(AiProviderError);
  });

  it('separates calls to tools that are not on offer', async () => {
    const { activities, aiService } = makeActivities();
    aiService.generateWithTools.mockResolvedValueOnce(
      toolTurn([
        { id: 'toolu_1', name: 'draft_quote', input: {} },
        { id: 'toolu_2', name: 'record_delete', input: {} },
      ]),
    );
    const turn = await plan(activities);
    expect(turn.toolCalls).toEqual([{ id: 'toolu_1', name: 'draft_quote', args: {} }]);
    expect(turn.invalidToolCalls).toEqual([{ id: 'toolu_2', name: 'record_delete' }]);
    expect(turn.raw).toBeDefined();
  });

  it('replaces a repeated or missing id, and then drops the raw turn it no longer matches', async () => {
    const { activities, aiService } = makeActivities();
    aiService.generateWithTools.mockResolvedValueOnce(
      toolTurn([
        { id: 'call_1', name: 'draft_quote', input: { a: 1 } },
        { id: 'call_1', name: 'draft_quote', input: { a: 2 } },
        { id: '', name: 'draft_quote', input: { a: 3 } },
      ]),
    );
    const turn = await plan(activities);
    const ids = turn.toolCalls!.map((c: any) => c.id);
    expect(ids[0]).toBe('call_1');
    expect(new Set(ids).size).toBe(3);
    expect(turn.toolCalls!.map((c: any) => c.args)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(turn.raw).toBeUndefined();
  });
});

describe('toAiMessages', () => {
  it('turns tool calls and their results into paired assistant and user messages', () => {
    const raw = { provider: 'anthropic', content: [] };
    expect(
      toAiMessages([
        { role: 'assistant', content: 'stale reply from a trimmed history' },
        { role: 'user', content: 'quote Acme and Beta' },
        {
          role: 'assistant',
          content: 'On it.',
          toolCalls: [
            { id: 't1', name: 'draft_quote', args: { c: 'Acme' } },
            { id: 't2', name: 'draft_quote', args: { c: 'Beta' } },
          ],
          raw,
        },
        { role: 'tool', toolCallId: 't1', toolName: 'draft_quote', content: '{"ok":1}' },
        { role: 'tool', toolCallId: 't2', toolName: 'draft_quote', content: '{"error":"x"}', isError: true },
      ]),
    ).toEqual([
      { role: 'user', content: 'quote Acme and Beta' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 't1', name: 'draft_quote', input: { c: 'Acme' } },
          { type: 'tool_use', id: 't2', name: 'draft_quote', input: { c: 'Beta' } },
        ],
        raw,
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 't1', content: '{"ok":1}' },
          { type: 'tool_result', toolUseId: 't2', content: '{"error":"x"}', isError: true },
        ],
      },
    ]);
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

describe('running as an agent from Settings → AI', () => {
  const makeSkill = (name: string, requiredPermissions: string[], isMutating = true) => ({
    name,
    description: name,
    isMutating,
    promptVersion: 'test/1',
    jsonSchema: {},
    requiredPermissions,
    resolve: jest.fn().mockResolvedValue({ kind: 'resolved', value: {} }),
    preview: jest.fn().mockResolvedValue(`Preview ${name}`),
    execute: jest.fn().mockResolvedValue({ reply: `${name} done`, resultType: 'X', resultId: 'x-1' }),
  });
  const staffAgent = {
    id: 'agent-1',
    organizationId: 'org-1',
    name: 'Quote chaser',
    instructions: 'Be brief. Never offer a discount.',
    kind: 'STAFF',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    skills: ['quote.lookup', 'quote.send', 'invoice.void'],
    isEnabled: true,
  };

  /** A user who may look up and send quotes and read contacts, but not void invoices. */
  function harness(agent: Record<string, unknown> | null = staffAgent, withAgents = true) {
    const skills = [
      makeSkill('quote.lookup', ['quote:read'], false),
      makeSkill('quote.send', ['quote:update']),
      makeSkill('contact.lookup', ['contact:read'], false),
      makeSkill('invoice.void', ['invoice:void']),
    ];
    const userPermissions = ['quote:read', 'quote:update', 'contact:read', 'custom_record:read'];
    const channelAgents = {
      findOne: jest.fn(async () => {
        if (!agent) throw new NotFoundException('Agent not found');
        return agent;
      }),
    };
    const aiService = { generateWithTools: jest.fn() };
    const customObjectsService = { list: jest.fn().mockResolvedValue([{ slug: 'moulds' }]) };
    const customObjectToolFactory = {
      createDynamicTools: jest.fn(() => [
        { name: 'query_custom_moulds', description: 'Moulds', jsonSchema: {} },
      ]),
    };
    const activities = createAgentReactActivities({
      aiService: aiService as any,
      rbacService: {
        resolveAccess: jest.fn().mockResolvedValue({ permissions: userPermissions }),
      } as any,
      // Same rule as SkillRegistry.permittedFor: every required permission held.
      skillRegistry: {
        permittedFor: (permissions: string[]) =>
          skills.filter((s) => s.requiredPermissions.every((p) => permissions.includes(p))),
      } as any,
      auditService: { record: jest.fn() } as any,
      customObjectToolFactory: customObjectToolFactory as any,
      customObjectsService: customObjectsService as any,
      customRecordsService: { list: jest.fn(), create: jest.fn() } as any,
      tenantContext: { runWithTenant: (_t: string, fn: any) => fn() } as any,
      idempotency: makeIdempotency() as any,
      ...(withAgents ? { channelAgents: channelAgents as any } : {}),
    });
    const skill = (name: string) => skills.find((s) => s.name === name)!;
    return { activities, channelAgents, aiService, skill };
  }

  const who = { organizationId: 'org-1', userId: 'user-1' };
  const agentCtx = { ...who, message: 'Chase Q-1', agentId: 'agent-1' };
  const names = (tools: Array<{ name: string }>) => tools.map((t) => t.name);

  describe('tools', () => {
    it('offers only tools that both the agent was given and the user is permitted', async () => {
      const { activities, channelAgents } = harness();

      const tools = await activities.listAvailableTools({ ...who, agentId: 'agent-1' });

      // contact.lookup: the user may, the agent was not given it.
      // invoice.void: the agent was given it, the user may not.
      expect(names(tools)).toEqual(['quote.lookup', 'quote.send']);
      expect(channelAgents.findOne).toHaveBeenCalledWith('org-1', 'agent-1');
    });

    it('without an agent, offers everything the user is permitted, as before', async () => {
      const { activities, channelAgents } = harness();

      const tools = await activities.listAvailableTools(who);

      expect(names(tools)).toEqual([
        'quote.lookup',
        'quote.send',
        'contact.lookup',
        'query_custom_moulds',
      ]);
      expect(channelAgents.findOne).not.toHaveBeenCalled();
    });

    it('an agent gets no custom-object tools, listed or called', async () => {
      const { activities } = harness();

      const tools = await activities.listAvailableTools({ ...who, agentId: 'agent-1' });
      expect(names(tools)).not.toContain('query_custom_moulds');
      await expect(
        activities.executeToolActivity({ id: 'c1', name: 'query_custom_moulds', args: {} }, agentCtx),
      ).rejects.toThrow("Tool 'query_custom_moulds' is unavailable or not authorized");
    });

    it('refuses a tool the agent has but the user is not permitted, even if the model asks for it', async () => {
      const { activities, skill } = harness();
      const call = { id: 'v1', name: 'invoice.void', args: {} };

      await expect(activities.executeToolActivity(call, agentCtx)).rejects.toThrow(
        "Tool 'invoice.void' is unavailable or not authorized",
      );
      await expect(activities.commitToolMutationActivity(call, agentCtx)).rejects.toThrow(
        "Tool 'invoice.void' is unavailable or not authorized",
      );
      expect(skill('invoice.void').execute).not.toHaveBeenCalled();
    });

    it('refuses a tool the user is permitted but the agent was not given', async () => {
      const { activities, skill } = harness();

      await expect(
        activities.executeToolActivity({ id: 'k1', name: 'contact.lookup', args: {} }, agentCtx),
      ).rejects.toThrow("Tool 'contact.lookup' is unavailable or not authorized");
      expect(skill('contact.lookup').execute).not.toHaveBeenCalled();
    });

    it('a change still comes back as an approval request, not done', async () => {
      const { activities, skill } = harness();

      const result = await activities.executeToolActivity(
        { id: 's1', name: 'quote.send', args: {} },
        agentCtx,
      );

      expect(result).toEqual(
        expect.objectContaining({
          isMutating: true,
          requiresApproval: true,
          previewPayload: { summary: 'Preview quote.send' },
        }),
      );
      expect(skill('quote.send').execute).not.toHaveBeenCalled();
    });

    it('the step\'s older "areas" limit still narrows the agent\'s tools further', async () => {
      const { activities } = harness({ ...staffAgent, skills: ['quote.lookup', 'purchase_order.x'] });

      const tools = await activities.listAvailableTools({
        ...who,
        agentId: 'agent-1',
        allowedDomains: ['FINANCE'],
      });

      expect(tools).toEqual([]);
    });
  });

  describe('an agent that cannot be used stops the run instead of falling back', () => {
    const expectUnavailable = async (promise: Promise<unknown>, message: string) => {
      const failure = await promise.then(
        () => null,
        (err: unknown) => err,
      );
      expect(failure).toBeInstanceOf(ApplicationFailure);
      expect((failure as ApplicationFailure).type).toBe('AgentUnavailable');
      expect((failure as ApplicationFailure).nonRetryable).toBe(true);
      expect((failure as ApplicationFailure).message).toBe(message);
    };

    it('deleted, or belonging to another organisation', async () => {
      const { activities, channelAgents } = harness(null);

      await expectUnavailable(
        activities.listAvailableTools({ organizationId: 'org-2', userId: 'user-1', agentId: 'agent-1' }),
        'The agent this step runs as no longer exists. Open the step and pick another agent.',
      );
      // Looked up inside the run's own organisation, never by id alone.
      expect(channelAgents.findOne).toHaveBeenCalledWith('org-2', 'agent-1');
    });

    it('switched off', async () => {
      const { activities, aiService } = harness({ ...staffAgent, isEnabled: false });

      await expectUnavailable(
        activities.planReActTurn({
          ...who,
          prompt: 'p',
          conversationHistory: [{ role: 'user', content: 'p' }],
          availableTools: [],
          agentId: 'agent-1',
        }),
        'The agent "Quote chaser" is switched off in Settings → AI. Switch it on or pick another agent.',
      );
      expect(aiService.generateWithTools).not.toHaveBeenCalled();
    });

    it('a customer-facing agent', async () => {
      const { activities } = harness({ ...staffAgent, name: 'Front desk', kind: 'CUSTOMER' });

      await expectUnavailable(
        activities.executeToolActivity({ id: 'l1', name: 'quote.lookup', args: {} }, agentCtx),
        '"Front desk" is an agent that answers customers, so it cannot run an automation step. Pick a staff agent.',
      );
    });

    it('a worker that cannot look agents up', async () => {
      const { activities } = harness(staffAgent, false);

      await expectUnavailable(
        activities.listAvailableTools({ ...who, agentId: 'agent-1' }),
        'The agent this step runs as no longer exists. Open the step and pick another agent.',
      );
    });

    it('a lookup that fails for another reason is retried, not reported as a missing agent', async () => {
      const { activities, channelAgents } = harness();
      channelAgents.findOne.mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        activities.listAvailableTools({ ...who, agentId: 'agent-1' }),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('planning', () => {
    const answer = { text: 'Done.', toolCalls: [], raw: {}, usage: {}, model: 'claude-sonnet-4-5', stopReason: 'end_turn' };
    const plan = (activities: any, agentId?: string) =>
      activities.planReActTurn({
        ...who,
        prompt: 'p',
        conversationHistory: [{ role: 'user', content: 'p' }],
        availableTools: [],
        ...(agentId ? { agentId } : {}),
      });

    it("uses the agent's instructions, provider and model, after the fixed rules", async () => {
      const { activities, aiService } = harness();
      aiService.generateWithTools.mockResolvedValueOnce(answer);

      const turn = await plan(activities, 'agent-1');

      const [feature, options, actor] = aiService.generateWithTools.mock.calls[0];
      expect(feature).toBe('automations.ai_agent');
      expect(options.model).toBe('claude-sonnet-4-5');
      expect(options.provider).toBe('anthropic');
      expect(options.system).toBe(agentSystemPrompt(staffAgent as any));
      // The approval rule is stated before anything the agent's author wrote.
      const rules = options.system.indexOf('never say an action succeeded until a tool result confirms it');
      const guidance = options.system.indexOf('Be brief. Never offer a discount.');
      expect(rules).toBeGreaterThan(-1);
      expect(guidance).toBeGreaterThan(rules);
      expect(options.system).toContain('You are working as the "Quote chaser" agent');
      expect(actor).toEqual({ organizationId: 'org-1', userId: 'user-1' });
      expect(turn).toEqual({
        thought: '',
        model: 'claude-sonnet-4-5',
        finalAnswer: 'Done.',
        agent: { id: 'agent-1', name: 'Quote chaser' },
      });
    });

    it("leaves provider and model to the organisation's defaults when the agent names none", async () => {
      const { activities, aiService } = harness({ ...staffAgent, provider: null, model: null });
      aiService.generateWithTools.mockResolvedValueOnce(answer);

      await plan(activities, 'agent-1');

      const options = aiService.generateWithTools.mock.calls[0][1];
      expect(options).not.toHaveProperty('model');
      expect(options).not.toHaveProperty('provider');
    });

    it('without an agent, sends the fixed prompt and no overrides', async () => {
      const { activities, aiService, channelAgents } = harness();
      aiService.generateWithTools.mockResolvedValueOnce(answer);

      const turn = await plan(activities);

      const options = aiService.generateWithTools.mock.calls[0][1];
      expect(options.system).toBe(agentSystemPrompt(null));
      expect(options).not.toHaveProperty('model');
      expect(options).not.toHaveProperty('provider');
      expect(turn).not.toHaveProperty('agent');
      expect(channelAgents.findOne).not.toHaveBeenCalled();
    });
  });
});
