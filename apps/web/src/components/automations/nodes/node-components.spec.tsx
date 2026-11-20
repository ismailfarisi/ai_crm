import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { BaseNode } from './base-node';
import { AddStepButton } from './add-step-button';
import { CanvasActionsContext, outputKey } from '../canvas/canvas-actions';
import { TriggerNode } from './trigger-node';
import { ConditionNode } from './condition-node';
import { ApprovalNode } from './approval-node';
import { ActionNode } from './action-node';
import { DelayNode } from './delay-node';
import { TransformNode } from './transform-node';
import { NODE_TYPES } from './node-types';
import {
  NodePaletteDrawer,
  NODE_PALETTE_ITEMS,
  PALETTE_CATEGORIES,
} from '../drawers/node-palette-drawer';
import type { AutomationNodeType } from '@saas/shared';

function renderWithReactFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('Automation Node Components', () => {
  // Suppress expected Handle nodeId warnings when rendering node components in isolation outside full canvas
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  beforeAll(() => {
    console.error = (...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('[React Flow]: Handle: No node id found')) {
        return;
      }
      originalConsoleError(...args);
    };
    console.warn = (...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('[React Flow]: Handle: No node id found')) {
        return;
      }
      originalConsoleWarn(...args);
    };
  });

  afterAll(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe('BaseNode', () => {
    it('renders title, category, and children', () => {
      renderWithReactFlow(
        <BaseNode
          icon={Sparkles}
          title="Custom AI Step"
          category="AI / LLM"
          subtitle="Generates summaries"
        >
          <div data-testid="custom-child">Child Content</div>
        </BaseNode>,
      );

      expect(screen.getByText('Custom AI Step')).toBeInTheDocument();
      expect(screen.getByText('AI / LLM')).toBeInTheDocument();
      expect(screen.getByText('Generates summaries')).toBeInTheDocument();
      expect(screen.getByTestId('custom-child')).toBeInTheDocument();
    });

    it('renders input and output handles by default', () => {
      const { container } = renderWithReactFlow(
        <BaseNode icon={Sparkles} title="Test Node" category="Test" />,
      );

      const targetHandle = container.querySelector('.react-flow__handle-left');
      const sourceHandle = container.querySelector('.react-flow__handle-right');

      expect(targetHandle).toBeInTheDocument();
      expect(sourceHandle).toBeInTheDocument();
    });

    it('hides input handle when hasInput is false', () => {
      const { container } = renderWithReactFlow(
        <BaseNode icon={Sparkles} title="Trigger" category="Trigger" hasInput={false} />,
      );

      const targetHandle = container.querySelector('.react-flow__handle-left');
      const sourceHandle = container.querySelector('.react-flow__handle-right');

      expect(targetHandle).toBeNull();
      expect(sourceHandle).toBeInTheDocument();
    });

    it('hides output handle when hasOutput is false', () => {
      const { container } = renderWithReactFlow(
        <BaseNode icon={Sparkles} title="Terminal" category="Terminal" hasOutput={false} />,
      );

      const targetHandle = container.querySelector('.react-flow__handle-left');
      const sourceHandle = container.querySelector('.react-flow__handle-right');

      expect(targetHandle).toBeInTheDocument();
      expect(sourceHandle).toBeNull();
    });

    it('applies selected border styling when selected is true', () => {
      renderWithReactFlow(
        <BaseNode
          icon={Sparkles}
          title="Selected Node"
          category="Test"
          selected={true}
          testId="selected-node"
        />,
      );

      const node = screen.getByTestId('selected-node');
      expect(node.className).toContain('border-brand');
    });

    it('renders execution status badges and highlight borders', () => {
      const { rerender } = renderWithReactFlow(
        <BaseNode icon={Sparkles} title="Status Node" category="Test" status="SUCCESS" testId="status-node" />,
      );
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByTestId('status-node').className).toContain('border-success');

      rerender(
        <ReactFlowProvider>
          <BaseNode icon={Sparkles} title="Status Node" category="Test" status="FAILED" testId="status-node" />
        </ReactFlowProvider>,
      );
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByTestId('status-node').className).toContain('border-danger');

      rerender(
        <ReactFlowProvider>
          <BaseNode icon={Sparkles} title="Status Node" category="Test" status="WAITING" testId="status-node" />
        </ReactFlowProvider>,
      );
      expect(screen.getByText('Waiting')).toBeInTheDocument();
      // Waiting is marked by the amber ring and the word, not by a pulse.
      expect(screen.getByTestId('status-node').className).toContain('border-brand');
      expect(screen.getByTestId('status-node').className).not.toContain('animate-pulse');

      rerender(
        <ReactFlowProvider>
          <BaseNode icon={Sparkles} title="Status Node" category="Test" status="SKIPPED" testId="status-node" />
        </ReactFlowProvider>,
      );
      expect(screen.getByText('Skipped')).toBeInTheDocument();
    });
  });

  describe('TriggerNode', () => {
    it('renders webhookTrigger with slug preview and no input handle', () => {
      const { container } = renderWithReactFlow(
        <TriggerNode
          type="webhookTrigger"
          data={{
            label: 'Order Webhook',
            config: { slug: 'order-created' },
          }}
        />,
      );

      expect(screen.getByText('Order Webhook')).toBeInTheDocument();
      expect(screen.getByText('/webhooks/order-created')).toBeInTheDocument();

      // No left handle
      expect(container.querySelector('.react-flow__handle-left')).toBeNull();
      // Has right handle
      expect(container.querySelector('.react-flow__handle-right')).toBeInTheDocument();
    });

    it('renders scheduleTrigger with cron expression preview', () => {
      renderWithReactFlow(
        <TriggerNode
          type="scheduleTrigger"
          data={{
            label: 'Daily Sync',
            config: { cron: '0 9 * * 1-5' },
          }}
        />,
      );

      expect(screen.getByText('Daily Sync')).toBeInTheDocument();
      expect(screen.getByText('Cron: 0 9 * * 1-5')).toBeInTheDocument();
    });

    it('renders crmEventTrigger with the event the inspector sets, by its label', () => {
      renderWithReactFlow(
        <TriggerNode
          type="crmEventTrigger"
          data={{
            label: 'Big quote alert',
            config: { event: 'quote.accepted' },
          }}
        />,
      );

      expect(screen.getByText('Big quote alert')).toBeInTheDocument();
      expect(screen.getByText('Customer accepted a quote')).toBeInTheDocument();
    });

    it('still reads a legacy eventType', () => {
      renderWithReactFlow(
        <TriggerNode type="crmEventTrigger" data={{ label: 'Old', config: { eventType: 'invoice.overdue' } }} />,
      );
      expect(screen.getByText('Invoice overdue')).toBeInTheDocument();
    });

    it('flags a stored event that is not in the event list', () => {
      renderWithReactFlow(
        <TriggerNode type="crmEventTrigger" data={{ label: 'On Deal Won', config: { event: 'deal.won' } }} />,
      );
      expect(screen.getByTestId('trigger-unknown-event')).toHaveTextContent('Unknown event: deal.won');
    });

    it('renders manualTrigger with execution hint', () => {
      renderWithReactFlow(
        <TriggerNode
          type="manualTrigger"
          data={{
            label: 'Run on Demand',
            config: {},
          }}
        />,
      );

      expect(screen.getByText('Run on Demand')).toBeInTheDocument();
      expect(screen.getByText('Runs when you press Run')).toBeInTheDocument();
    });
  });

  describe('ConditionNode', () => {
    it('renders condition logic with dual output handles (true and false)', () => {
      const { container } = renderWithReactFlow(
        <ConditionNode
          data={{
            label: 'Check Amount > 5000',
            config: { condition: 'payload.amount > 5000' },
          }}
        />,
      );

      expect(screen.getByText('Check Amount > 5000')).toBeInTheDocument();
      expect(screen.getByText('payload.amount > 5000')).toBeInTheDocument();
      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();

      // Input handle on left
      expect(container.querySelector('.react-flow__handle-left')).toBeInTheDocument();

      // Two custom output handles on right
      const trueHandle = container.querySelector('[data-handleid="true"]');
      const falseHandle = container.querySelector('[data-handleid="false"]');

      expect(trueHandle).toBeInTheDocument();
      expect(falseHandle).toBeInTheDocument();
    });
  });

  describe('ApprovalNode', () => {
    it('renders human approval node with 3 output handles (approved, rejected, timeout)', () => {
      const { container } = renderWithReactFlow(
        <ApprovalNode
          data={{
            label: 'VP Finance Approval',
            config: { message: 'Approve the Acme quote', timeoutDuration: '24 hours' },
          }}
        />,
      );

      expect(screen.getByText('VP Finance Approval')).toBeInTheDocument();
      expect(screen.queryByText('Approver:')).toBeNull();
      expect(screen.getByText('Approve the Acme quote')).toBeInTheDocument();
      expect(screen.getByText('24 hours')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.getByText('Rejected')).toBeInTheDocument();
      expect(screen.getByText('No answer')).toBeInTheDocument();

      // Input handle on left
      expect(container.querySelector('.react-flow__handle-left')).toBeInTheDocument();

      // 3 source handles on right
      const approvedHandle = container.querySelector('[data-handleid="approved"]');
      const rejectedHandle = container.querySelector('[data-handleid="rejected"]');
      const timeoutHandle = container.querySelector('[data-handleid="timeout"]');

      expect(approvedHandle).toBeInTheDocument();
      expect(rejectedHandle).toBeInTheDocument();
      expect(timeoutHandle).toBeInTheDocument();
    });
  });

  describe('ActionNode', () => {
    it('renders httpRequestNode with method and url', () => {
      renderWithReactFlow(
        <ActionNode
          type="httpRequestNode"
          data={{
            label: 'Fetch Stripe Customer',
            config: { method: 'POST', url: 'https://api.stripe.com/v1/customers' },
          }}
        />,
      );

      expect(screen.getByText('Fetch Stripe Customer')).toBeInTheDocument();
      expect(screen.getByText('POST')).toBeInTheDocument();
      expect(screen.getByText('https://api.stripe.com/v1/customers')).toBeInTheDocument();
    });

    it('renders aiPromptNode with model and prompt summary', () => {
      renderWithReactFlow(
        <ActionNode
          type="aiPromptNode"
          data={{
            label: 'Summarize Meeting Notes',
            config: { model: 'gpt-4o', prompt: 'Summarize key action items' },
          }}
        />,
      );

      expect(screen.getByText('Summarize Meeting Notes')).toBeInTheDocument();
      expect(screen.getByText('gpt-4o')).toBeInTheDocument();
      expect(screen.getByText('"Summarize key action items"')).toBeInTheDocument();
    });

    it('renders sendEmailNode with recipient and subject', () => {
      renderWithReactFlow(
        <ActionNode
          type="sendEmailNode"
          data={{
            label: 'Send Welcome Email',
            config: { to: 'client@example.com', subject: 'Welcome to our platform' },
          }}
        />,
      );

      expect(screen.getByText('Send Welcome Email')).toBeInTheDocument();
      expect(screen.getByText('client@example.com')).toBeInTheDocument();
      expect(screen.getByText('Sub: Welcome to our platform')).toBeInTheDocument();
    });

    it('renders crmMutateNode with mutation action', () => {
      renderWithReactFlow(
        <ActionNode
          type="crmMutateNode"
          data={{
            label: 'Create CRM Deal',
            config: { action: 'CREATE_DEAL' },
          }}
        />,
      );

      expect(screen.getByText('Create CRM Deal')).toBeInTheDocument();
      expect(screen.getByText('CREATE_DEAL')).toBeInTheDocument();
    });
  });

  describe('DelayNode', () => {
    it('renders delay duration in minutes', () => {
      renderWithReactFlow(
        <DelayNode
          data={{
            label: 'Wait 10 mins',
            config: { delayMinutes: 10 },
          }}
        />,
      );

      expect(screen.getByText('Wait 10 mins')).toBeInTheDocument();
      expect(screen.getByText('10 minutes')).toBeInTheDocument();
    });
  });

  describe('TransformNode', () => {
    it('renders JavaScript expression preview', () => {
      renderWithReactFlow(
        <TransformNode
          data={{
            label: 'Format Name',
            config: { script: 'return { fullName: payload.first + " " + payload.last };' },
          }}
        />,
      );

      expect(screen.getByText('Format Name')).toBeInTheDocument();
      expect(
        screen.getByText('return { fullName: payload.first + " " + payload.last };'),
      ).toBeInTheDocument();
    });
  });

  describe('NODE_TYPES Registry', () => {
    it('contains all 13 AutomationNodeType entries mapped to React Flow components', () => {
      const expectedTypes: AutomationNodeType[] = [
        'webhookTrigger',
        'scheduleTrigger',
        'crmEventTrigger',
        'manualTrigger',
        'conditionNode',
        'transformNode',
        'delayNode',
        'httpRequestNode',
        'aiPromptNode',
        'aiAgentNode',
        'sendEmailNode',
        'crmMutateNode',
        'approvalNode',
      ];

      expectedTypes.forEach((type) => {
        expect(NODE_TYPES[type]).toBeDefined();
        expect(typeof NODE_TYPES[type]).toBe('function');
      });
    });
  });

  describe('AddStepButton (the "+" on a step)', () => {
    // `useNodeId` reads the id React Flow gives each step it draws.
    vi.mock('@xyflow/react', async (original) => ({
      ...(await original<typeof import('@xyflow/react')>()),
      useNodeId: () => 'step-1',
    }));

    const renderOnCanvas = (ui: React.ReactElement, connected: string[] = []) => {
      const onAddAfter = vi.fn();
      render(
        <CanvasActionsContext.Provider value={{ onAddAfter, connectedOutputs: new Set(connected) }}>
          {ui}
        </CanvasActionsContext.Provider>,
      );
      return onAddAfter;
    };

    it('asks the canvas for a step after this one', () => {
      const onAddAfter = renderOnCanvas(<AddStepButton />);
      fireEvent.click(screen.getByRole('button', { name: 'Add a step after this one' }));
      expect(onAddAfter).toHaveBeenCalledWith('step-1', null);
    });

    it('continues the branch it sits on', () => {
      const onAddAfter = renderOnCanvas(<AddStepButton handle="true" outputName="Yes" />);
      fireEvent.click(screen.getByRole('button', { name: 'Add a step on the Yes path' }));
      expect(onAddAfter).toHaveBeenCalledWith('step-1', 'true');
    });

    it('offers to add a step in between when the output already leads somewhere', () => {
      renderOnCanvas(<AddStepButton />, [outputKey('step-1', null)]);
      expect(screen.getByRole('button', { name: 'Add a step in between' })).toBeInTheDocument();
    });

    it('shows nothing outside a canvas', () => {
      render(<AddStepButton />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('NodePaletteDrawer (the step chooser)', () => {
    it('offers only ways to start until the automation has one', () => {
      render(<NodePaletteDrawer />);

      expect(screen.getByText('What should start it?')).toBeInTheDocument();
      expect(screen.getByTestId('palette-item-crmEventTrigger')).toHaveTextContent('When something happens in Kerf');
      expect(screen.getByTestId('palette-item-scheduleTrigger')).toBeInTheDocument();
      // Every step is reachable: the rarely needed ones sit behind "More options".
      fireEvent.click(screen.getByTestId('palette-more-btn'));
      NODE_PALETTE_ITEMS.forEach((item) => {
        expect(screen.getByTestId(`palette-item-${item.type}`)).toBeInTheDocument();
      });
    });

    it('leaves out the ways to start once the automation has one', () => {
      render(<NodePaletteDrawer hasTrigger afterStepName="Customer accepted a quote" />);

      expect(screen.getByText('What happens next?')).toBeInTheDocument();
      expect(screen.getByTestId('node-palette-sub')).toHaveTextContent(
        'Runs after “Customer accepted a quote”, already connected.',
      );
      fireEvent.click(screen.getByTestId('palette-more-btn'));
      NODE_PALETTE_ITEMS.forEach((item) => {
        const shown = screen.queryByTestId(`palette-item-${item.type}`);
        if (item.category === 'Triggers') expect(shown).toBeNull();
        else expect(shown).toBeInTheDocument();
      });
    });

    it('names steps in plain words, not developer terms', () => {
      render(<NodePaletteDrawer hasTrigger />);
      fireEvent.click(screen.getByTestId('palette-more-btn'));

      const text = screen.getByTestId('node-palette-drawer').textContent ?? '';
      expect(text).toContain('Send an email');
      expect(text).toContain('Wait');
      expect(text).toContain('Only continue if…');
      for (const word of ['Node', 'Cron', 'LLM', 'ReAct', 'HITL', 'Mutation', 'JS expression', 'HTTP', 'DAG']) {
        expect(text).not.toContain(word);
      }
    });

    it('keeps the steps for other apps folded away until asked for', () => {
      render(<NodePaletteDrawer hasTrigger />);

      expect(screen.queryByTestId('palette-item-httpRequestNode')).toBeNull();
      fireEvent.click(screen.getByTestId('palette-more-btn'));
      expect(screen.getByTestId('palette-item-httpRequestNode')).toBeInTheDocument();
    });

    it('filters items by search input, including the folded ones', () => {
      render(<NodePaletteDrawer hasTrigger />);

      fireEvent.change(screen.getByTestId('node-palette-search'), { target: { value: 'another app' } });

      expect(screen.getByTestId('palette-item-httpRequestNode')).toBeInTheDocument();
      expect(screen.queryByTestId('palette-item-approvalNode')).toBeNull();
      expect(screen.queryByTestId('palette-item-sendEmailNode')).toBeNull();
    });

    it('shows empty state when no items match search query', () => {
      render(<NodePaletteDrawer />);

      fireEvent.change(screen.getByTestId('node-palette-search'), { target: { value: 'nonexistent-query-xyz' } });

      expect(screen.getByText('Nothing matches “nonexistent-query-xyz”')).toBeInTheDocument();
    });

    it('invokes onAddNode when a step is clicked', () => {
      const onAddNode = vi.fn();
      render(<NodePaletteDrawer hasTrigger onAddNode={onAddNode} />);

      fireEvent.click(screen.getByTestId('palette-item-delayNode'));
      expect(onAddNode).toHaveBeenCalledWith('delayNode');
    });

    it('sets drag transfer data on drag start', () => {
      const onDragStart = vi.fn();
      render(<NodePaletteDrawer hasTrigger onDragStart={onDragStart} />);

      const setDataMock = vi.fn();
      const dragEvent = {
        dataTransfer: {
          setData: setDataMock,
          effectAllowed: '',
        },
      };

      const itemCard = screen.getByTestId('palette-item-aiPromptNode');
      fireEvent.dragStart(itemCard, dragEvent);

      expect(setDataMock).toHaveBeenCalledWith('application/reactflow', 'aiPromptNode');
      expect(setDataMock).toHaveBeenCalledWith('automation/node-type', 'aiPromptNode');
      expect(onDragStart).toHaveBeenCalledWith(expect.anything(), 'aiPromptNode');
    });

    it('closes from its close button and on Escape', () => {
      const onClose = vi.fn();
      render(<NodePaletteDrawer onClose={onClose} />);

      fireEvent.click(screen.getByLabelText('Close'));
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
