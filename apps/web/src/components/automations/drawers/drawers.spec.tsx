import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeInspectorDrawer } from './node-inspector-drawer';
import { TestRunDrawer } from './test-run-drawer';
import { ExecutionTraceDrawer } from './execution-trace-drawer';
import { ExpressionHelper } from './expression-helper';
import type { AutomationNode, AutomationWorkflowDto, AutomationExecutionDto } from '@saas/shared';

describe('Automation Drawers', () => {
  const sampleNode: AutomationNode = {
    id: 'node-1',
    type: 'httpRequestNode',
    position: { x: 100, y: 100 },
    data: {
      label: 'Fetch Deals',
      config: { method: 'POST', url: 'https://api.crm.io/deals', body: { dealId: 123 } },
      continueOnFail: false,
      retryCount: 2,
    },
  };

  const sampleApprovalNode: AutomationNode = {
    id: 'node-2',
    type: 'approvalNode',
    position: { x: 200, y: 100 },
    data: {
      label: 'Manager Approval Gate',
      config: {},
      timeoutDuration: '48 hours',
    },
  };

  const sampleWorkflow: AutomationWorkflowDto = {
    id: 'wf-1',
    tenantId: 'tenant-1',
    name: 'Sample Flow',
    status: 'ACTIVE',
    triggerType: 'WEBHOOK',
    triggerConfig: {},
    nodes: [sampleNode],
    edges: [],
    version: 1,
    createdAt: '2026-08-17T00:00:00Z',
    updatedAt: '2026-08-17T00:00:00Z',
  };

  const sampleExecution: AutomationExecutionDto = {
    id: 'exec-1',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    temporalWorkflowId: 'temp-1',
    status: 'COMPLETED',
    triggerPayload: { amount: 5000 },
    nodeResults: {
      'node-1': {
        status: 'SUCCESS',
        input: { amount: 5000 },
        output: { resultId: 'res_1' },
        durationMs: 42,
        startedAt: '2026-08-17T12:00:00Z',
      },
    },
    startedAt: '2026-08-17T12:00:00Z',
    finishedAt: '2026-08-17T12:00:01Z',
  };

  it('renders NodeInspectorDrawer and updates label and HTTP parameters', () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const onDelete = vi.fn();

    render(
      <NodeInspectorDrawer
        node={sampleNode}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId('node-inspector-drawer')).toBeDefined();
    expect(screen.getByDisplayValue('Fetch Deals')).toBeDefined();
    expect(screen.getByDisplayValue('https://api.crm.io/deals')).toBeDefined();

    // Change label
    const labelInput = screen.getByTestId('node-label-input');
    fireEvent.change(labelInput, { target: { value: 'New Node Name' } });
    expect(onUpdate).toHaveBeenCalledWith('node-1', { label: 'New Node Name' });

    // Change method
    const methodSelect = screen.getByTestId('http-method-select');
    fireEvent.change(methodSelect, { target: { value: 'PUT' } });
    expect(onUpdate).toHaveBeenCalled();

    // Click delete
    fireEvent.click(screen.getByTestId('delete-node-btn'));
    expect(onDelete).toHaveBeenCalledWith('node-1');
  });

  it('renders ApprovalNode timeout duration in NodeInspectorDrawer', () => {
    const onUpdate = vi.fn();
    render(
      <NodeInspectorDrawer
        node={sampleApprovalNode}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('approval-timeout-input')).toBeDefined();
    expect(screen.getByDisplayValue('48 hours')).toBeDefined();
  });

  it('renders TestRunDrawer and triggers execution', async () => {
    const onExecute = vi.fn().mockResolvedValue(sampleExecution);
    const onClose = vi.fn();

    render(
      <TestRunDrawer
        workflow={sampleWorkflow}
        onExecuteTest={onExecute}
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId('test-run-drawer')).toBeDefined();
    const runBtn = screen.getByTestId('execute-test-btn');
    fireEvent.click(runBtn);

    expect(onExecute).toHaveBeenCalled();
  });

  it('renders ExecutionTraceDrawer with timeline results', () => {
    const onClose = vi.fn();
    render(<ExecutionTraceDrawer execution={sampleExecution} onClose={onClose} />);

    expect(screen.getByTestId('execution-trace-drawer')).toBeDefined();
    expect(screen.getByText('node-1')).toBeDefined();
    expect(screen.getByText('42ms')).toBeDefined();
  });

  it('renders ExpressionHelper with tabs and variable insertion', () => {
    const onSelect = vi.fn();
    render(<ExpressionHelper onSelectVariable={onSelect} />);

    expect(screen.getByTestId('expression-helper')).toBeDefined();

    // Switch to JSON tab
    fireEvent.click(screen.getByTestId('tab-json'));
    expect(screen.getByTestId('variable-item-$json.name')).toBeDefined();

    // Click on pill to copy / insert
    fireEvent.click(screen.getByTestId('variable-item-$json.name'));
    expect(onSelect).toHaveBeenCalledWith('{{ $json.name }}');
  });
});
