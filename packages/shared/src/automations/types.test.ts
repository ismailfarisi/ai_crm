import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_PERMISSIONS,
  validateWorkflowGraph,
  type AutomationNode,
  type AutomationEdge,
  type AutomationWorkflowDto,
  type AutomationExecutionDto,
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
});
