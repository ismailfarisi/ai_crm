const mockActivityInfo = {
  workflowExecution: { workflowId: 'agent-wf-1', runId: 'run-1' },
  activityId: '7',
  attempt: 1,
};
jest.mock('@temporalio/activity', () => ({
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
    preview: jest.fn(),
    execute: jest.fn().mockImplementation(async () => ({
      reply: 'Drafted',
      resultType: 'QUOTE',
      resultId: `quote-${skill.execute.mock.calls.length}`,
    })),
  };
  const idempotency = makeIdempotency();
  const auditService = { record: jest.fn() };
  const activities = createAgentReactActivities({
    aiService: {} as any,
    rbacService: {
      resolveAccess: jest.fn().mockResolvedValue({ permissions: [] }),
    } as any,
    skillRegistry: { permittedFor: () => [skill] } as any,
    auditService: auditService as any,
    customObjectToolFactory: {} as any,
    customObjectsService: {} as any,
    customRecordsService: {} as any,
    tenantContext: { runWithTenant: (_t: string, fn: any) => fn() } as any,
    idempotency: idempotency as any,
  });
  return { activities, skill, idempotency, auditService };
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
