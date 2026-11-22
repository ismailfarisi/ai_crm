import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NodeInspectorDrawer } from './node-inspector-drawer';
import { TestRunDrawer } from './test-run-drawer';
import { ExpressionHelper } from './expression-helper';
import { CRM_EVENTS, CRM_EVENT_GROUPS } from '../crm-events';
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
    triggerSource: null,
    dataHidden: false,
    pendingApprovals: [],
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

    // "48 hours" is shown as an amount and a unit, and saved back as text.
    expect(screen.getByTestId('approval-timeout-input-amount')).toHaveValue(48);
    expect(screen.getByTestId('approval-timeout-input-unit')).toHaveValue('hours');
    fireEvent.change(screen.getByTestId('approval-timeout-input-unit'), { target: { value: 'days' } });
    expect(onUpdate).toHaveBeenCalledWith('node-2', { timeoutDuration: '48 days' });
  });

  it('edits the approval message without clobbering sibling config', () => {
    const onUpdate = vi.fn();
    const node: AutomationNode = {
      ...sampleApprovalNode,
      data: { ...sampleApprovalNode.data, config: { other: 'keep' } },
    };
    render(<NodeInspectorDrawer node={node} onUpdate={onUpdate} onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('approval-message-input'), {
      target: { value: 'Approve {{ $trigger.payload.name }}' },
    });
    expect(onUpdate).toHaveBeenCalledWith('node-2', {
      config: { other: 'keep', message: 'Approve {{ $trigger.payload.name }}' },
    });
    expect(screen.getByText(/pauses here until someone who can approve automations decides/)).toBeDefined();
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


  it('brings the new event\'s sample when another event is saved while it is open', () => {
    const saved = (event: string): AutomationWorkflowDto => ({
      ...sampleWorkflow,
      triggerType: 'CRM_EVENT',
      triggerConfig: { event },
    });
    const { rerender } = render(
      <TestRunDrawer workflow={saved('quote.sent')} onExecuteTest={vi.fn()} onClose={vi.fn()} />,
    );
    // The sample is a form of the event's fields; "Edit as JSON" shows what is sent.
    const input = () => {
      fireEvent.click(screen.getByTestId('toggle-test-json-btn'));
      return screen.getByTestId('test-payload-input') as HTMLTextAreaElement;
    };
    expect(input().value).toContain('quote.sent');

    rerender(
      <TestRunDrawer
        workflow={saved('expense.submitted')}
        onExecuteTest={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const after = input().value;
    expect(after).toContain('expense.submitted');
    expect(after).not.toContain('quote.sent');
  });

  it('says a test run leaves out changes that are not saved', () => {
    const { rerender } = render(
      <TestRunDrawer workflow={sampleWorkflow} onExecuteTest={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId('test-run-unsaved-note')).toBeNull();

    rerender(
      <TestRunDrawer
        workflow={sampleWorkflow}
        hasUnsavedChanges
        onExecuteTest={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('test-run-unsaved-note').textContent).toContain('Save first');
  });

  it('surfaces an AI tool preview when execution is waiting for approval', async () => {
    const execution: AutomationExecutionDto = {
      ...sampleExecution,
      status: 'WAITING_APPROVAL',
      nodeResults: {
        'agent-node': {
          status: 'WAITING',
          startedAt: '2026-08-17T12:00:00Z',
          output: {
            pendingAction: {
              tool: 'quote.create',
              preview: { summary: 'Create quote QT-1' },
            },
          },
        },
      },
    };

    render(
      <TestRunDrawer
        workflow={sampleWorkflow}
        onExecuteTest={vi.fn().mockResolvedValue(execution)}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('execute-test-btn'));
    expect(await screen.findByTestId('pending-agent-approval')).toBeDefined();
    expect(screen.getByText('Waiting for someone to approve')).toBeDefined();
    expect(within(screen.getByTestId('pending-agent-approval')).getByText(/Create quote QT-1/)).toBeDefined();
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

  describe('real action fields', () => {
    const mk = (type: AutomationNode['type'], config: Record<string, any> = {}, id = 'n'): AutomationNode => ({
      id,
      type,
      position: { x: 0, y: 0 },
      data: { label: id, config },
    });
    const optionTexts = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('option')).map((o) => o.textContent);

    it('CRM step offers Contact/Quote and matching actions', () => {
      const onUpdate = vi.fn();
      const { rerender } = render(
        <NodeInspectorDrawer node={mk('crmMutateNode', { entity: 'contact' })} onUpdate={onUpdate} onClose={vi.fn()} />,
      );
      expect(optionTexts(screen.getByTestId('crm-entity-select'))).toEqual([
        'Choose…',
        'Contact',
        'Quote',
        'Artwork proof',
        'Invoice',
        "Today's shop summary",
      ]);
      expect(optionTexts(screen.getByTestId('crm-action-select'))).toEqual(['Choose…', 'Create', 'Update']);
      rerender(
        <NodeInspectorDrawer node={mk('crmMutateNode', { entity: 'quote' })} onUpdate={onUpdate} onClose={vi.fn()} />,
      );
      expect(optionTexts(screen.getByTestId('crm-action-select'))).toEqual([
        'Choose…',
        'Approve',
        'Reject',
        'Look up (changes nothing)',
      ]);
    });

    it('changing the entity resets the action and drops stale fields', () => {
      const onUpdate = vi.fn();
      render(
        <NodeInspectorDrawer
          node={mk('crmMutateNode', { entity: 'contact', action: 'update', recordId: 'c1', fields: { email: 'a@b.c' } })}
          onUpdate={onUpdate}
          onClose={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByTestId('crm-entity-select'), { target: { value: 'quote' } });
      expect(onUpdate).toHaveBeenCalledWith('n', { config: { entity: 'quote', action: '', recordId: 'c1' } });
    });

    it('legacy entity/action values show as unselected', () => {
      render(
        <NodeInspectorDrawer
          node={mk('crmMutateNode', { entity: 'deal', action: 'updateStatus' })}
          onUpdate={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect((screen.getByTestId('crm-entity-select') as HTMLSelectElement).value).toBe('');
      expect((screen.getByTestId('crm-action-select') as HTMLSelectElement).value).toBe('');
    });

    it('shows Record ID for update/approve/reject and Reason for reject only', () => {
      const onUpdate = vi.fn();
      const { rerender } = render(
        <NodeInspectorDrawer node={mk('crmMutateNode', { entity: 'contact', action: 'create' })} onUpdate={onUpdate} onClose={vi.fn()} />,
      );
      expect(screen.queryByTestId('crm-record-id-input')).toBeNull();
      rerender(
        <NodeInspectorDrawer node={mk('crmMutateNode', { entity: 'quote', action: 'approve' })} onUpdate={onUpdate} onClose={vi.fn()} />,
      );
      expect(screen.getByTestId('crm-record-id-input')).toBeDefined();
      expect(screen.queryByTestId('crm-reason-input')).toBeNull();
      rerender(
        <NodeInspectorDrawer node={mk('crmMutateNode', { entity: 'quote', action: 'reject' })} onUpdate={onUpdate} onClose={vi.fn()} />,
      );
      fireEvent.change(screen.getByTestId('crm-reason-input'), { target: { value: 'too low' } });
      expect(onUpdate).toHaveBeenLastCalledWith('n', {
        config: { entity: 'quote', action: 'reject', reason: 'too low' },
      });
    });

    it('contact fields editor writes config.fields', () => {
      const onUpdate = vi.fn();
      render(
        <NodeInspectorDrawer
          node={mk('crmMutateNode', { entity: 'contact', action: 'create', fields: { email: '{{ $json.email }}' } })}
          onUpdate={onUpdate}
          onClose={vi.fn()}
        />,
      );
      expect((screen.getByTestId('crm-field-value-0') as HTMLInputElement).value).toBe('{{ $json.email }}');
      fireEvent.change(screen.getByTestId('crm-field-value-0'), { target: { value: 'x@y.z' } });
      expect(onUpdate).toHaveBeenLastCalledWith('n', {
        config: { entity: 'contact', action: 'create', fields: { email: 'x@y.z' } },
      });
      fireEvent.click(screen.getByTestId('crm-add-field-btn'));
      expect(onUpdate).toHaveBeenLastCalledWith('n', {
        config: { entity: 'contact', action: 'create', fields: { email: 'x@y.z' } },
      });
      expect((screen.getByTestId('crm-field-value-1') as HTMLInputElement).value).toBe('');
      fireEvent.click(screen.getByTestId('crm-remove-field-0'));
      expect(onUpdate).toHaveBeenLastCalledWith('n', {
        config: { entity: 'contact', action: 'create', fields: {} },
      });
    });

    describe('blank contact field rows', () => {
      function Harness({ initial, onWrite }: { initial: AutomationNode; onWrite: (config: unknown) => void }) {
        const [node, setNode] = React.useState(initial);
        return (
          <NodeInspectorDrawer
            node={node}
            onUpdate={(_id, data) => {
              onWrite(data.config);
              setNode((n) => ({ ...n, data: { ...n.data, ...data } }));
            }}
            onClose={vi.fn()}
          />
        );
      }

      it('a blank row stays on screen but is not written into config.fields', () => {
        const onUpdate = vi.fn();
        render(
          <NodeInspectorDrawer
            node={mk('crmMutateNode', { entity: 'contact', action: 'update', recordId: 'c1', fields: { jobTitle: 'CTO' } })}
            onUpdate={onUpdate}
            onClose={vi.fn()}
          />,
        );
        fireEvent.click(screen.getByTestId('crm-add-field-btn'));
        expect(onUpdate).toHaveBeenLastCalledWith('n', {
          config: { entity: 'contact', action: 'update', recordId: 'c1', fields: { jobTitle: 'CTO' } },
        });
        expect(screen.getByTestId('crm-field-value-1')).toBeDefined();
      });

      it('clearing a value drops that field instead of writing an empty string', () => {
        const onUpdate = vi.fn();
        render(
          <NodeInspectorDrawer
            node={mk('crmMutateNode', { entity: 'contact', action: 'update', recordId: 'c1', fields: { jobTitle: 'CTO', phone: '1' } })}
            onUpdate={onUpdate}
            onClose={vi.fn()}
          />,
        );
        fireEvent.change(screen.getByTestId('crm-field-value-0'), { target: { value: '' } });
        expect(onUpdate).toHaveBeenLastCalledWith('n', {
          config: { entity: 'contact', action: 'update', recordId: 'c1', fields: { phone: '1' } },
        });
        expect((screen.getByTestId('crm-field-value-0') as HTMLInputElement).value).toBe('');
      });

      it('a blank row survives the round trip through the parent and is written once filled', () => {
        const onWrite = vi.fn();
        render(
          <Harness
            initial={mk('crmMutateNode', { entity: 'contact', action: 'create', fields: { email: 'a@b.c' } })}
            onWrite={onWrite}
          />,
        );
        fireEvent.click(screen.getByTestId('crm-add-field-btn'));
        expect(onWrite).toHaveBeenLastCalledWith({ entity: 'contact', action: 'create', fields: { email: 'a@b.c' } });
        expect(screen.getByTestId('crm-field-value-1')).toBeDefined();
        fireEvent.change(screen.getByTestId('crm-field-key-1'), { target: { value: 'jobTitle' } });
        fireEvent.change(screen.getByTestId('crm-field-value-1'), { target: { value: 'CTO' } });
        expect((screen.getByTestId('crm-field-key-1') as HTMLSelectElement).value).toBe('jobTitle');
        expect((screen.getByTestId('crm-field-value-1') as HTMLInputElement).value).toBe('CTO');
        expect(onWrite).toHaveBeenLastCalledWith({
          entity: 'contact',
          action: 'create',
          fields: { email: 'a@b.c', jobTitle: 'CTO' },
        });
      });
    });

    it('CRM trigger lists exactly the emitted events, none selected by default', () => {
      render(<NodeInspectorDrawer node={mk('crmEventTrigger', {})} onUpdate={vi.fn()} onClose={vi.fn()} />);
      const select = screen.getByTestId('crm-event-select') as HTMLSelectElement;
      expect(select.value).toBe('');
      // Every offered event, under its heading, in the order a job moves through the shop.
      const offered = CRM_EVENT_GROUPS.flatMap((group) => CRM_EVENTS.filter((ev) => ev.group === group));
      expect(offered).toHaveLength(CRM_EVENTS.length);
      expect(optionTexts(select)).toEqual(['Choose an event', ...offered.map((ev) => ev.label)]);
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['', ...offered.map((ev) => ev.value)]);
      expect(Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)).toEqual([...CRM_EVENT_GROUPS]);
    });

    it('email step after an AI step shows the customer-delivery hint', () => {
      const ai = mk('aiPromptNode', { prompt: 'write' }, 'ai');
      const mail = mk('sendEmailNode', { to: 'a@b.c', subject: 's', body: '{{ $json.text }}' }, 'mail');
      const edges = [{ id: 'e', source: 'ai', target: 'mail', sourceHandle: null, targetHandle: null }];
      const { rerender } = render(
        <NodeInspectorDrawer node={mail} allNodes={[ai, mail]} edges={edges} aiEmailToCustomers={false} onUpdate={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByText('Uses AI-written text — only people with a login here can receive it')).toBeDefined();
      rerender(
        <NodeInspectorDrawer node={mail} allNodes={[ai, mail]} edges={edges} aiEmailToCustomers={true} onUpdate={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByText('Uses AI-written text — can be sent to customers')).toBeDefined();
      rerender(
        <NodeInspectorDrawer node={mail} allNodes={[ai, mail]} edges={edges} onUpdate={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.queryByText(/Uses AI-written text/)).toBeNull();
    });

    it('email step without AI upstream shows no hint', () => {
      const mail = mk('sendEmailNode', { to: 'a@b.c', body: 'hi' }, 'mail');
      render(
        <NodeInspectorDrawer node={mail} allNodes={[mail]} edges={[]} aiEmailToCustomers={false} onUpdate={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.queryByText(/Uses AI-written text/)).toBeNull();
    });
  });
});
