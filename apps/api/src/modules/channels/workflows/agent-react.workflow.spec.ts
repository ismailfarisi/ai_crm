const mockHandlers = new Map<any, Function>();
const mockActivities = {
  listAvailableTools: jest.fn(),
  planReActTurn: jest.fn(),
  executeToolActivity: jest.fn(),
  commitToolMutationActivity: jest.fn(),
  emitAssistantEventActivity: jest.fn(),
};

let mockConditionImpl: (predicate: () => boolean, timeout?: string) => Promise<boolean> =
  async (pred) => pred();

jest.mock('@temporalio/workflow', () => {
  return {
    proxyActivities: () => ({
      listAvailableTools: (...args: any[]) =>
        (global as any).__mockActivities.listAvailableTools(...args),
      planReActTurn: (...args: any[]) =>
        (global as any).__mockActivities.planReActTurn(...args),
      executeToolActivity: (...args: any[]) =>
        (global as any).__mockActivities.executeToolActivity(...args),
      commitToolMutationActivity: (...args: any[]) =>
        (global as any).__mockActivities.commitToolMutationActivity(...args),
      emitAssistantEventActivity: (...args: any[]) =>
        (global as any).__mockActivities.emitAssistantEventActivity(...args),
    }),
    setHandler: (def: any, handler: Function) => {
      (global as any).__mockHandlers.set(def, handler);
    },
    condition: jest.fn().mockImplementation((predicate: () => boolean, timeout?: string) => {
      return (global as any).__mockCondition(predicate, timeout);
    }),
    defineSignal: (name: string) => ({ name, type: 'signal' }),
    defineQuery: (name: string) => ({ name, type: 'query' }),
    getExternalWorkflowHandle: jest.fn(),
    ApplicationFailure: class ApplicationFailure extends Error {},
    isCancellation: (e: unknown) => (e as any)?.name === 'CancelledFailure',
  };
});

(global as any).__mockActivities = mockActivities;
(global as any).__mockHandlers = mockHandlers;
(global as any).__mockCondition = (predicate: () => boolean, timeout?: string) =>
  mockConditionImpl(predicate, timeout);

import { agentReActWorkflow, approvalSignal } from './agent-react.workflow';

describe('agentReActWorkflow logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandlers.clear();
    mockActivities.listAvailableTools.mockResolvedValue([]);
    mockActivities.emitAssistantEventActivity.mockResolvedValue(undefined);
    mockConditionImpl = async (pred) => pred();
  });

  it('validates workflow contract signatures and signals', () => {
    const { approvalSignal: reqSignal } = require('./agent-react.workflow');
    expect(reqSignal.name).toBe('agentApprovalSignal');
    expect(approvalSignal.name).toBe('agentApprovalSignal');
  });

  it('completes workflow immediately when planReActTurn returns a final answer', async () => {
    mockActivities.planReActTurn.mockResolvedValueOnce({
      thought: 'I know the answer immediately.',
      finalAnswer: 'The capital of France is Paris.',
    });

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'What is the capital of France?',
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      finalResponse: 'The capital of France is Paris.',
      stepsExecuted: 1,
    });
    expect(mockActivities.planReActTurn).toHaveBeenCalledTimes(1);
    expect(mockActivities.executeToolActivity).not.toHaveBeenCalled();
  });

  it('executes non-mutating tool and returns final response in subsequent turn', async () => {
    mockActivities.planReActTurn
      .mockResolvedValueOnce({
        thought: 'Need to look up documentation.',
        toolCalls: [
          {
            id: 'call-1',
            name: 'kbLookup',
            args: { query: 'pricing' },
          },
        ],
      })
      .mockResolvedValueOnce({
        thought: 'I have the documentation.',
        finalAnswer: 'Pricing is $20/month.',
      });

    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'call-1',
      toolName: 'kbLookup',
      isMutating: false,
      requiresApproval: false,
      output: { price: '$20/month' },
    });

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'How much does it cost?',
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      finalResponse: 'Pricing is $20/month.',
      stepsExecuted: 2,
    });
    expect(mockActivities.executeToolActivity).toHaveBeenCalledWith(
      { id: 'call-1', name: 'kbLookup', args: { query: 'pricing' } },
      {
        organizationId: 'org-123',
        userId: 'user-456',
        message: 'How much does it cost?',
      },
    );
    expect(mockActivities.commitToolMutationActivity).not.toHaveBeenCalled();
  });

  it('handles mutating tool requiring approval when user approves', async () => {
    mockActivities.planReActTurn
      .mockResolvedValueOnce({
        thought: 'Initiating refund.',
        toolCalls: [
          {
            id: 'refund-call-1',
            name: 'refundPayment',
            args: { paymentId: 'pay-999', amount: 50 },
          },
        ],
      })
      .mockResolvedValueOnce({
        thought: 'Refund processed, finishing.',
        finalAnswer: 'Refund of $50 has been issued successfully.',
      });

    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'refund-call-1',
      toolName: 'refundPayment',
      isMutating: true,
      requiresApproval: true,
      previewPayload: { paymentId: 'pay-999', amount: 50 },
    });

    mockActivities.commitToolMutationActivity.mockResolvedValueOnce({
      success: true,
      resultSummary: 'Refund pay-999 executed.',
    });

    // Simulate signal arrival before condition check finishes
    mockConditionImpl = async (predicate) => {
      const handler = mockHandlers.get(approvalSignal);
      if (handler) {
        handler({ approved: true, note: 'Approved by supervisor' });
      }
      return predicate();
    };

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'Please refund payment pay-999.',
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      finalResponse: 'Refund of $50 has been issued successfully.',
      stepsExecuted: 2,
    });
    expect(mockActivities.commitToolMutationActivity).toHaveBeenCalledWith(
      { id: 'refund-call-1', name: 'refundPayment', args: { paymentId: 'pay-999', amount: 50 } },
      {
        organizationId: 'org-123',
        userId: 'user-456',
        message: 'Please refund payment pay-999.',
      },
    );
  });

  it('handles mutating tool requiring approval when user rejects', async () => {
    mockActivities.planReActTurn.mockResolvedValueOnce({
      thought: 'Deleting user account.',
      toolCalls: [
        {
          id: 'del-1',
          name: 'deleteAccount',
          args: { targetUserId: 'target-001' },
        },
      ],
    });

    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'del-1',
      toolName: 'deleteAccount',
      isMutating: true,
      requiresApproval: true,
      previewPayload: { targetUserId: 'target-001' },
    });

    // Simulate rejection signal arrival
    mockConditionImpl = async (predicate) => {
      const handler = mockHandlers.get(approvalSignal);
      if (handler) {
        handler({ approved: false, note: 'Denied by admin' });
      }
      return predicate();
    };

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'Delete target account target-001.',
    });

    expect(result).toEqual({
      status: 'REJECTED',
      finalResponse: 'Action deleteAccount was rejected: Denied by admin',
      stepsExecuted: 1,
    });
    expect(mockActivities.commitToolMutationActivity).not.toHaveBeenCalled();
  });

  it('handles mutating tool requiring approval when approval times out', async () => {
    mockActivities.planReActTurn.mockResolvedValueOnce({
      thought: 'Deleting user account.',
      toolCalls: [
        {
          id: 'del-1',
          name: 'deleteAccount',
          args: { targetUserId: 'target-001' },
        },
      ],
    });

    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'del-1',
      toolName: 'deleteAccount',
      isMutating: true,
      requiresApproval: true,
      previewPayload: { targetUserId: 'target-001' },
    });

    // Simulate timeout (condition resolves to false)
    mockConditionImpl = async () => false;

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'Delete target account target-001.',
    });

    expect(result).toEqual({
      status: 'TIMED_OUT',
      finalResponse: 'Approval for deleteAccount timed out.',
      stepsExecuted: 1,
    });
    expect(mockActivities.commitToolMutationActivity).not.toHaveBeenCalled();
  });

  it('processes multiple queued signals in order', async () => {
    mockActivities.planReActTurn
      .mockResolvedValueOnce({
        thought: 'Action 1',
        toolCalls: [{ id: 'call-1', name: 'tool1', args: {} }],
      })
      .mockResolvedValueOnce({
        thought: 'Action 2',
        toolCalls: [{ id: 'call-2', name: 'tool2', args: {} }],
      })
      .mockResolvedValueOnce({
        thought: 'Done',
        finalAnswer: 'Both actions processed.',
      });

    mockActivities.executeToolActivity.mockResolvedValue({
      toolCallId: 'call-X',
      toolName: 'toolX',
      isMutating: true,
      requiresApproval: true,
      previewPayload: {},
    });

    mockActivities.commitToolMutationActivity.mockResolvedValue({ success: true });

    // Pre-queue two signals before workflow actually waits
    mockConditionImpl = async (predicate) => {
      const handler = mockHandlers.get(approvalSignal);
      if (handler) {
        // Only push one signal per check to simulate arriving one by one or pre-queued
        handler({ approved: true, note: 'Approved signal' });
      }
      return predicate();
    };

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'Queue test',
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      finalResponse: 'Both actions processed.',
      stepsExecuted: 3,
    });
    expect(mockActivities.commitToolMutationActivity).toHaveBeenCalledTimes(2);
  });

  it('handles tool execution with error message fallback', async () => {
    mockActivities.planReActTurn
      .mockResolvedValueOnce({
        thought: 'Calling flaky tool.',
        toolCalls: [
          {
            id: 'err-1',
            name: 'flakyTool',
            args: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        thought: 'Tool failed, explaining to user.',
        finalAnswer: 'Sorry, the service is temporarily unavailable.',
      });

    mockActivities.executeToolActivity.mockResolvedValueOnce({
      toolCallId: 'err-1',
      toolName: 'flakyTool',
      isMutating: false,
      requiresApproval: false,
      errorMessage: 'Network timeout',
    });

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'Run flaky tool.',
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      finalResponse: 'Sorry, the service is temporarily unavailable.',
      stepsExecuted: 2,
    });
    // Check that history passed to 2nd planReActTurn has the error
    expect(mockActivities.planReActTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationHistory: expect.arrayContaining([
          {
            role: 'tool',
            content: JSON.stringify({ error: 'Network timeout' }),
          },
        ]),
      }),
    );
  });

  it('stops after maxTurns when loop does not reach final answer', async () => {
    mockActivities.planReActTurn.mockResolvedValue({
      thought: 'Still thinking...',
      toolCalls: [],
    });

    const result = await agentReActWorkflow({
      organizationId: 'org-123',
      userId: 'user-456',
      conversationId: 'conv-789',
      prompt: 'Infinite loop test',
      maxTurns: 3,
    });

    expect(result).toEqual({
      status: 'FAILED',
      finalResponse:
        'Agent stopped after reaching the 3-turn limit without a final answer.',
      stepsExecuted: 3,
    });
    expect(mockActivities.planReActTurn).toHaveBeenCalledTimes(3);
  });
});

describe('assistant event sink', () => {
  const base = {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    prompt: 'send Ada the update',
    eventSink: { conversationId: 'conv-1', turnId: 'turn-1' },
    audit: { channel: 'ASSISTANT' as const, messageId: 'msg-user-1' },
  };

  beforeEach(() => {
    // Earlier tests may leave unconsumed mockResolvedValueOnce queues behind.
    mockActivities.planReActTurn.mockReset();
    mockActivities.executeToolActivity.mockReset();
    mockActivities.commitToolMutationActivity.mockReset();
    mockActivities.emitAssistantEventActivity.mockReset();
    mockActivities.emitAssistantEventActivity.mockResolvedValue(undefined);
  });

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
