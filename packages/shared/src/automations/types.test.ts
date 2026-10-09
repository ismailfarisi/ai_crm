import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_PERMISSIONS,
  validateWorkflowGraph,
  type AutomationNode,
  type AutomationEdge,
  type AutomationWorkflowDto,
  type AutomationExecutionDto,
  type CrmDomainEvent,
  type AiAgentNodeConfig,
  type AiAgentNodeResult,
} from './types';

describe('Automation Types & Helpers', () => {
  it('defines all required automation permissions', () => {
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_READ).toBe('automation:read');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_CREATE).toBe('automation:create');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_UPDATE).toBe('automation:update');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_DELETE).toBe('automation:delete');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE).toBe('automation:execute');
    expect(AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE).toBe('automation:approve');
  });

  it('validates workflow graph and identifies entry triggers for webhookTrigger', () => {
    const nodes: AutomationNode[] = [
      {
        id: 'trigger-1',
        type: 'webhookTrigger',
        position: { x: 0, y: 0 },
        data: { label: 'Webhook', config: {} },
      },
      {
        id: 'action-1',
        type: 'httpRequestNode',
        position: { x: 200, y: 0 },
        data: { label: 'HTTP Request', config: { url: 'https://api.test' } },
      },
    ];
    const edges: AutomationEdge[] = [{ id: 'e1', source: 'trigger-1', target: 'action-1' }];

    const validation = validateWorkflowGraph(nodes, edges);
    expect(validation.isValid).toBe(true);
    expect(validation.triggerNodeId).toBe('trigger-1');
    expect(validation.error).toBeUndefined();
  });

  it('validates workflow graph for other trigger types', () => {
    const triggerTypes = [
      'scheduleTrigger',
      'crmEventTrigger',
      'manualTrigger',
    ] as const;

    for (const tType of triggerTypes) {
      const nodes: AutomationNode[] = [
        {
          id: `trigger-${tType}`,
          type: tType,
          position: { x: 0, y: 0 },
          data: { label: tType, config: {} },
        },
      ];
      const validation = validateWorkflowGraph(nodes, []);
      expect(validation.isValid).toBe(true);
      expect(validation.triggerNodeId).toBe(`trigger-${tType}`);
    }
  });

  it('rejects graph with no trigger node', () => {
    const nodes: AutomationNode[] = [
      {
        id: 'action-1',
        type: 'httpRequestNode',
        position: { x: 200, y: 0 },
        data: { label: 'HTTP Request', config: {} },
      },
    ];
    const validation = validateWorkflowGraph(nodes, []);
    expect(validation.isValid).toBe(false);
    expect(validation.error).toContain('Trigger node');
    expect(validation.triggerNodeId).toBeUndefined();
  });

  it('handles empty nodes array gracefully', () => {
    const validation = validateWorkflowGraph([], []);
    expect(validation.isValid).toBe(false);
    expect(validation.error).toBeDefined();
  });

  it('validates workflow graph containing aiAgentNode', () => {
    const config: AiAgentNodeConfig = {
      goal: 'Autonomous account triage and enrichment',
      allowedDomains: ['SALES', 'GENERAL'],
      autoApprove: false,
      timeoutDuration: '15m',
    };

    const nodes: AutomationNode[] = [
      {
        id: 'trigger-1',
        type: 'crmEventTrigger',
        position: { x: 0, y: 0 },
        data: { label: 'CRM Event Trigger', config: {} },
      },
      {
        id: 'agent-1',
        type: 'aiAgentNode',
        position: { x: 250, y: 0 },
        data: {
          label: 'AI Deal Agent',
          config,
        },
      },
    ];
    const edges: AutomationEdge[] = [{ id: 'e1', source: 'trigger-1', target: 'agent-1' }];

    const validation = validateWorkflowGraph(nodes, edges);
    expect(validation.isValid).toBe(true);
    expect(validation.triggerNodeId).toBe('trigger-1');
    expect(validation.error).toBeUndefined();
  });

  it('types and instantiates CrmDomainEvent correctly with snapshots and changedFields', () => {
    const event: CrmDomainEvent<{ name: string; status: string; value: number }> = {
      tenantId: 'tenant-attio-1',
      eventType: 'record.updated',
      entityType: 'custom_object',
      entityName: 'deal',
      entityId: 'rec-12345',
      actorUserId: 'usr-agent-007',
      timestamp: '2026-10-08T14:30:00.000Z',
      snapshot: {
        before: { name: 'Acme Deal', status: 'LEAD', value: 50000 },
        after: { name: 'Acme Deal', status: 'QUALIFIED', value: 50000 },
        changedFields: ['status'],
      },
    };

    expect(event.tenantId).toBe('tenant-attio-1');
    expect(event.eventType).toBe('record.updated');
    expect(event.entityType).toBe('custom_object');
    expect(event.entityName).toBe('deal');
    expect(event.entityId).toBe('rec-12345');
    expect(event.actorUserId).toBe('usr-agent-007');
    expect(event.snapshot.changedFields).toEqual(['status']);
    expect(event.snapshot.before?.status).toBe('LEAD');
    expect(event.snapshot.after?.status).toBe('QUALIFIED');
  });

  it('types AiAgentNodeResult with telemetry, usage, and toolCalls', () => {
    const result: AiAgentNodeResult = {
      success: true,
      solution: 'Assigned enterprise deal to strategic rep based on ARR tier',
      stepsTaken: 4,
      toolCalls: [
        { name: 'query_custom_record', args: { objectSlug: 'deal', id: 'rec-12345' } },
        { name: 'mutate_custom_record', args: { objectSlug: 'deal', id: 'rec-12345', updates: { rep: 'usr-42' } } },
      ],
      usage: {
        promptTokens: 1250,
        completionTokens: 350,
        totalTokens: 1600,
        estimatedCostUsd: 0.0084,
      },
      estimatedCostUsd: 0.0084,
      error: null,
    };

    expect(result.success).toBe(true);
    expect(result.solution).toContain('Assigned enterprise deal');
    expect(result.stepsTaken).toBe(4);
    expect(result.toolCalls?.length).toBe(2);
    expect(result.usage?.totalTokens).toBe(1600);
    expect(result.usage?.estimatedCostUsd).toBe(0.0084);
    expect(result.estimatedCostUsd).toBe(0.0084);
    expect(result.error).toBeNull();
  });
});
