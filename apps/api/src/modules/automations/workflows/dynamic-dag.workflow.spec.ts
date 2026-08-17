// Setup mocks before imports
const mockHandlers = new Map<any, Function>();
const mockActivities = {
  executeHttpActivity: jest.fn(),
  executeAiPromptActivity: jest.fn(),
  executeEmailActivity: jest.fn(),
  executeCodeTransformActivity: jest.fn(),
  executeCrmMutationActivity: jest.fn(),
  recordNodeResultActivity: jest.fn().mockResolvedValue({ recorded: true }),
};

jest.mock('@temporalio/workflow', () => {
  const handlers = new Map<any, Function>();
  return {
    proxyActivities: () => ({
      executeHttpActivity: (...args: any[]) => (global as any).__mockActivities.executeHttpActivity(...args),
      executeAiPromptActivity: (...args: any[]) => (global as any).__mockActivities.executeAiPromptActivity(...args),
      executeEmailActivity: (...args: any[]) => (global as any).__mockActivities.executeEmailActivity(...args),
      executeCodeTransformActivity: (...args: any[]) => (global as any).__mockActivities.executeCodeTransformActivity(...args),
      executeCrmMutationActivity: (...args: any[]) => (global as any).__mockActivities.executeCrmMutationActivity(...args),
      recordNodeResultActivity: (...args: any[]) => (global as any).__mockActivities.recordNodeResultActivity(...args),
    }),
    setHandler: (def: any, handler: Function) => {
      (global as any).__mockHandlers.set(def, handler);
    },
    condition: jest.fn().mockImplementation(async (predicate: () => boolean) => {
      return predicate();
    }),
    sleep: jest.fn().mockResolvedValue(undefined),
    defineSignal: (name: string) => ({ name, type: 'signal' }),
    defineQuery: (name: string) => ({ name, type: 'query' }),
  };
});

(global as any).__mockActivities = mockActivities;
(global as any).__mockHandlers = mockHandlers;

import { dynamicDagWorkflow } from './dynamic-dag.workflow';
import {
  approveNodeSignal,
  DynamicWorkflowInput,
  getExecutionStateQuery,
  rejectNodeSignal,
} from './interfaces';

describe('DynamicDagWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandlers.clear();
  });

  it('should execute a linear DAG of trigger -> httpRequest -> crmMutate', async () => {
    mockActivities.executeHttpActivity.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { customerId: 'cust-123', plan: 'enterprise' },
    });

    mockActivities.executeCrmMutationActivity.mockResolvedValue({
      success: true,
      entity: 'contact',
      action: 'create',
      recordId: 'cnt-999',
      data: {},
    });

    const input: DynamicWorkflowInput = {
      executionId: 'exec-1',
      workflowId: 'wf-1',
      tenantId: 'tenant-1',
      triggerPayload: { webhookId: 'hook-1', email: 'boss@corp.com' },
      nodes: [
        {
          id: 'node-trigger',
          type: 'webhookTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook Trigger', config: {} },
        },
        {
          id: 'node-http',
          type: 'httpRequestNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'Fetch Details',
            config: {
              url: 'https://api.example.com/lookup/{{ $trigger.webhookId }}',
              method: 'GET',
            },
          },
        },
        {
          id: 'node-crm',
          type: 'crmMutateNode',
          position: { x: 200, y: 0 },
          data: {
            label: 'Create Contact',
            config: {
              entity: 'contact',
              action: 'create',
              data: {
                customerId: '{{ $node["Fetch Details"].json.customerId }}',
                email: '{{ $trigger.email }}',
              },
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'node-trigger', target: 'node-http' },
        { id: 'e2', source: 'node-http', target: 'node-crm' },
      ],
    };

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('COMPLETED');
    expect(mockActivities.executeHttpActivity).toHaveBeenCalledWith({
      url: 'https://api.example.com/lookup/hook-1',
      method: 'GET',
    });
    expect(mockActivities.executeCrmMutationActivity).toHaveBeenCalledWith({
      entity: 'contact',
      action: 'create',
      data: {
        customerId: 'cust-123',
        email: 'boss@corp.com',
      },
    });
    expect(result.nodeResults['node-http'].status).toBe('SUCCESS');
    expect(result.nodeResults['node-crm'].status).toBe('SUCCESS');
  });

  it('should route along condition node true/false branch handles', async () => {
    mockActivities.executeEmailActivity.mockResolvedValue({
      success: true,
      messageId: 'email-1',
      to: 'vip@corp.com',
      sentAt: new Date().toISOString(),
    });

    const input: DynamicWorkflowInput = {
      executionId: 'exec-2',
      workflowId: 'wf-2',
      tenantId: 'tenant-1',
      triggerPayload: { amount: 5000 },
      nodes: [
        {
          id: 'trigger',
          type: 'manualTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Manual Trigger', config: {} },
        },
        {
          id: 'cond-1',
          type: 'conditionNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'Is High Value',
            config: {
              expression: '$trigger.amount > 1000',
            },
          },
        },
        {
          id: 'email-high',
          type: 'sendEmailNode',
          position: { x: 200, y: -50 },
          data: {
            label: 'Send VIP Email',
            config: {
              to: 'vip@corp.com',
              subject: 'High Value Lead: ${{ $trigger.amount }}',
            },
          },
        },
        {
          id: 'email-low',
          type: 'sendEmailNode',
          position: { x: 200, y: 50 },
          data: {
            label: 'Send Standard Email',
            config: {
              to: 'standard@corp.com',
              subject: 'Standard Lead: ${{ $trigger.amount }}',
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'cond-1' },
        { id: 'e-true', source: 'cond-1', target: 'email-high', sourceHandle: 'true' },
        { id: 'e-false', source: 'cond-1', target: 'email-low', sourceHandle: 'false' },
      ],
    };

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults['cond-1'].output).toEqual({ result: true });
    expect(mockActivities.executeEmailActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.executeEmailActivity).toHaveBeenCalledWith({
      to: 'vip@corp.com',
      subject: 'High Value Lead: $5000',
    });
    expect(result.nodeResults['email-high'].status).toBe('SUCCESS');
    expect(result.nodeResults['email-low']).toBeUndefined();
  });

  it('should handle approval signals and route to approved branch', async () => {
    const { condition } = require('@temporalio/workflow');

    let approveSignalHandler: Function;
    const input: DynamicWorkflowInput = {
      executionId: 'exec-3',
      workflowId: 'wf-3',
      tenantId: 'tenant-1',
      triggerPayload: { dealId: 'deal-99' },
      nodes: [
        {
          id: 'trigger',
          type: 'manualTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: {} },
        },
        {
          id: 'approval-node',
          type: 'approvalNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'Manager Approval',
            config: {},
            timeoutDuration: '1 day',
          },
        },
        {
          id: 'post-approval',
          type: 'sendEmailNode',
          position: { x: 200, y: 0 },
          data: {
            label: 'Send Confirmation',
            config: {
              to: 'team@corp.com',
              subject: 'Deal Approved',
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'approval-node' },
        { id: 'e2', source: 'approval-node', target: 'post-approval', sourceHandle: 'approved' },
      ],
    };

    // Simulate approval signal during execution
    (condition as jest.Mock).mockImplementationOnce(async (predicate) => {
      approveSignalHandler = mockHandlers.get(approveNodeSignal)!;
      approveSignalHandler({ nodeId: 'approval-node', approvedBy: 'manager@corp.com' });
      return predicate();
    });

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults['approval-node'].output).toEqual({
      decision: 'APPROVED',
      approvedBy: 'manager@corp.com',
      comment: undefined,
    });
    expect(mockActivities.executeEmailActivity).toHaveBeenCalled();
  });

  it('should handle rejection signals and route to rejected branch', async () => {
    const { condition } = require('@temporalio/workflow');

    let rejectSignalHandler: Function;
    const input: DynamicWorkflowInput = {
      executionId: 'exec-3-rej',
      workflowId: 'wf-3-rej',
      tenantId: 'tenant-1',
      triggerPayload: { dealId: 'deal-100' },
      nodes: [
        {
          id: 'trigger',
          type: 'manualTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: {} },
        },
        {
          id: 'approval-node',
          type: 'approvalNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'Manager Approval',
            config: {},
            timeoutDuration: '1 day',
          },
        },
        {
          id: 'post-rejection',
          type: 'sendEmailNode',
          position: { x: 200, y: 0 },
          data: {
            label: 'Send Rejection Alert',
            config: {
              to: 'team@corp.com',
              subject: 'Deal Rejected',
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'approval-node' },
        { id: 'e2', source: 'approval-node', target: 'post-rejection', sourceHandle: 'rejected' },
      ],
    };

    (condition as jest.Mock).mockImplementationOnce(async (predicate) => {
      rejectSignalHandler = mockHandlers.get(rejectNodeSignal)!;
      rejectSignalHandler({
        nodeId: 'approval-node',
        rejectedBy: 'vp@corp.com',
        reason: 'Budget exceeded',
      });
      return predicate();
    });

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults['approval-node'].output).toEqual({
      decision: 'REJECTED',
      rejectedBy: 'vp@corp.com',
      reason: 'Budget exceeded',
    });
    expect(mockActivities.executeEmailActivity).toHaveBeenCalled();
  });

  it('should handle SLA timeout and route to timeout branch', async () => {
    const { condition } = require('@temporalio/workflow');

    const input: DynamicWorkflowInput = {
      executionId: 'exec-3-timeout',
      workflowId: 'wf-3-timeout',
      tenantId: 'tenant-1',
      triggerPayload: { dealId: 'deal-101' },
      nodes: [
        {
          id: 'trigger',
          type: 'manualTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: {} },
        },
        {
          id: 'approval-node',
          type: 'approvalNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'Manager Approval',
            config: {},
            timeoutDuration: '12 hours',
          },
        },
        {
          id: 'timeout-alert',
          type: 'sendEmailNode',
          position: { x: 200, y: 0 },
          data: {
            label: 'Send Timeout Notification',
            config: {
              to: 'escalations@corp.com',
              subject: 'Approval Timed Out',
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'approval-node' },
        { id: 'e2', source: 'approval-node', target: 'timeout-alert', sourceHandle: 'timeout' },
      ],
    };

    // Simulate timeout (condition returns false)
    (condition as jest.Mock).mockResolvedValueOnce(false);

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults['approval-node'].output).toEqual({
      decision: 'TIMEOUT',
      reason: 'Approval timed out after 12 hours',
    });
    expect(mockActivities.executeEmailActivity).toHaveBeenCalled();
  });

  it('should execute aiPromptNode, transformNode, and delayNode in workflow', async () => {
    mockActivities.executeAiPromptActivity.mockResolvedValue({
      text: 'Summary of lead notes: Qualified Enterprise prospect',
      completion: 'Summary of lead notes: Qualified Enterprise prospect',
    });
    mockActivities.executeCodeTransformActivity.mockResolvedValue({
      output: { leadScore: 95, tier: 'TIER_1' },
    });

    const input: DynamicWorkflowInput = {
      executionId: 'exec-ai-trans',
      workflowId: 'wf-ai-trans',
      tenantId: 'tenant-1',
      triggerPayload: { rawNotes: 'Customer has 500 seats and $100k budget.' },
      nodes: [
        {
          id: 'trigger',
          type: 'webhookTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Inbound Webhook', config: {} },
        },
        {
          id: 'ai-node',
          type: 'aiPromptNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'AI Summary',
            config: {
              prompt: 'Summarize: {{ $trigger.rawNotes }}',
            },
          },
        },
        {
          id: 'transform-node',
          type: 'transformNode',
          position: { x: 200, y: 0 },
          data: {
            label: 'Calculate Score',
            config: {
              code: 'return { leadScore: 95, tier: "TIER_1" };',
            },
          },
        },
        {
          id: 'delay-node',
          type: 'delayNode',
          position: { x: 300, y: 0 },
          data: {
            label: 'Wait 5 minutes',
            config: { duration: '5 minutes' },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'ai-node' },
        { id: 'e2', source: 'ai-node', target: 'transform-node' },
        { id: 'e3', source: 'transform-node', target: 'delay-node' },
      ],
    };

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('COMPLETED');
    expect(mockActivities.executeAiPromptActivity).toHaveBeenCalledWith({
      prompt: 'Summarize: Customer has 500 seats and $100k budget.',
    });
    expect(mockActivities.executeCodeTransformActivity).toHaveBeenCalled();
    expect(result.nodeResults['ai-node'].status).toBe('SUCCESS');
    expect(result.nodeResults['transform-node'].status).toBe('SUCCESS');
    expect(result.nodeResults['delay-node'].status).toBe('SUCCESS');
  });

  it('should support getExecutionStateQuery query handler', async () => {
    const input: DynamicWorkflowInput = {
      executionId: 'exec-query',
      workflowId: 'wf-query',
      tenantId: 'tenant-1',
      triggerPayload: { test: true },
      nodes: [
        {
          id: 'trigger',
          type: 'manualTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: {} },
        },
      ],
      edges: [],
    };

    const workflowPromise = dynamicDagWorkflow(input);

    const queryHandler = mockHandlers.get(getExecutionStateQuery);
    expect(queryHandler).toBeDefined();

    const currentState = queryHandler();
    expect(currentState.executionId).toBe('exec-query');
    expect(currentState.status).toBeDefined();

    const result = await workflowPromise;
    expect(result.status).toBe('COMPLETED');
  });

  it('should fail workflow on node failure when continueOnFail is false', async () => {
    mockActivities.executeHttpActivity.mockRejectedValue(new Error('500 Internal Server Error'));

    const input: DynamicWorkflowInput = {
      executionId: 'exec-4',
      workflowId: 'wf-4',
      tenantId: 'tenant-1',
      triggerPayload: {},
      nodes: [
        {
          id: 'trigger',
          type: 'manualTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: {} },
        },
        {
          id: 'http-fail',
          type: 'httpRequestNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'Failing HTTP',
            config: { url: 'https://invalid.url' },
            continueOnFail: false,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'http-fail' }],
    };

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toBe('500 Internal Server Error');
    expect(result.nodeResults['http-fail'].status).toBe('FAILED');
  });

  it('should continue workflow on node failure when continueOnFail is true', async () => {
    mockActivities.executeHttpActivity.mockRejectedValue(new Error('404 Not Found'));
    mockActivities.executeEmailActivity.mockResolvedValue({ success: true });

    const input: DynamicWorkflowInput = {
      executionId: 'exec-5',
      workflowId: 'wf-5',
      tenantId: 'tenant-1',
      triggerPayload: {},
      nodes: [
        {
          id: 'trigger',
          type: 'manualTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: {} },
        },
        {
          id: 'http-fail',
          type: 'httpRequestNode',
          position: { x: 100, y: 0 },
          data: {
            label: 'Failing HTTP',
            config: { url: 'https://invalid.url' },
            continueOnFail: true,
          },
        },
        {
          id: 'fallback-email',
          type: 'sendEmailNode',
          position: { x: 200, y: 0 },
          data: {
            label: 'Send Alert',
            config: { to: 'admin@corp.com', subject: 'Workflow executed' },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'http-fail' },
        { id: 'e2', source: 'http-fail', target: 'fallback-email' },
      ],
    };

    const result = await dynamicDagWorkflow(input);

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults['http-fail'].status).toBe('FAILED');
    expect(result.nodeResults['fallback-email'].status).toBe('SUCCESS');
  });
});
