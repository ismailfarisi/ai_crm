const mockHandlers = new Map<any, Function>();
const mockActivities = {
  planReActTurn: jest.fn(),
  executeToolActivity: jest.fn(),
  commitToolMutationActivity: jest.fn(),
};

let mockConditionImpl: (predicate: () => boolean, timeout?: string) => Promise<boolean> =
  async (pred) => pred();

jest.mock('@temporalio/workflow', () => {
  return {
    proxyActivities: () => ({
      planReActTurn: (...args: any[]) =>
        (global as any).__mockActivities.planReActTurn(...args),
      executeToolActivity: (...args: any[]) =>
        (global as any).__mockActivities.executeToolActivity(...args),
      commitToolMutationActivity: (...args: any[]) =>
        (global as any).__mockActivities.commitToolMutationActivity(...args),
    }),
    setHandler: (def: any, handler: Function) => {
      (global as any).__mockHandlers.set(def, handler);
    },
    condition: jest.fn().mockImplementation((predicate: () => boolean, timeout?: string) => {
      return (global as any).__mockCondition(predicate, timeout);
    }),
    defineSignal: (name: string) => ({ name, type: 'signal' }),
    defineQuery: (name: string) => ({ name, type: 'query' }),
    ApplicationFailure: class ApplicationFailure extends Error {},
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
      { organizationId: 'org-123', userId: 'user-456' },
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
      { organizationId: 'org-123', userId: 'user-456' },
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
      finalResponse: 'Action deleteAccount was rejected by user.',
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
      status: 'REJECTED',
      finalResponse: 'Action deleteAccount was rejected by user.',
      stepsExecuted: 1,
    });
    expect(mockActivities.commitToolMutationActivity).not.toHaveBeenCalled();
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
      status: 'COMPLETED',
      finalResponse: 'Execution finished.',
      stepsExecuted: 3,
    });
    expect(mockActivities.planReActTurn).toHaveBeenCalledTimes(3);
  });
});
