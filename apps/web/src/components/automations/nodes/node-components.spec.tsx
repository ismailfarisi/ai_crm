import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { BaseNode } from './base-node';
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
      expect(node.className).toContain('border-amber-500');
    });

    it('renders execution status badges and highlight borders', () => {
      const { rerender } = renderWithReactFlow(
        <BaseNode icon={Sparkles} title="Status Node" category="Test" status="SUCCESS" testId="status-node" />,
      );
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByTestId('status-node').className).toContain('border-emerald-500');

      rerender(
        <ReactFlowProvider>
          <BaseNode icon={Sparkles} title="Status Node" category="Test" status="FAILED" testId="status-node" />
        </ReactFlowProvider>,
      );
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByTestId('status-node').className).toContain('border-rose-500');

      rerender(
        <ReactFlowProvider>
          <BaseNode icon={Sparkles} title="Status Node" category="Test" status="WAITING" testId="status-node" />
        </ReactFlowProvider>,
      );
      expect(screen.getByText('Waiting')).toBeInTheDocument();
      expect(screen.getByTestId('status-node').className).toContain('animate-pulse');

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

    it('renders crmEventTrigger with event type preview', () => {
      renderWithReactFlow(
        <TriggerNode
          type="crmEventTrigger"
          data={{
            label: 'On Deal Won',
            config: { eventType: 'deal.won' },
          }}
        />,
      );

      expect(screen.getByText('On Deal Won')).toBeInTheDocument();
      expect(screen.getByText('Event: deal.won')).toBeInTheDocument();
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
      expect(screen.getByText('Manual execution from UI or API')).toBeInTheDocument();
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
      expect(screen.getByText('True')).toBeInTheDocument();
      expect(screen.getByText('False')).toBeInTheDocument();

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
            config: { approverRole: 'executive', timeoutDuration: '24 hours' },
          }}
        />,
      );

      expect(screen.getByText('VP Finance Approval')).toBeInTheDocument();
      expect(screen.getByText('executive')).toBeInTheDocument();
      expect(screen.getByText('24 hours')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.getByText('Rejected')).toBeInTheDocument();
      expect(screen.getByText('Timeout')).toBeInTheDocument();

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
    it('contains all 12 AutomationNodeType entries mapped to React Flow components', () => {
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

  describe('NodePaletteDrawer', () => {
    it('renders palette header and all default node items', () => {
      render(<NodePaletteDrawer />);

      expect(screen.getByText('Node Palette')).toBeInTheDocument();
      expect(screen.getByTestId('node-palette-search')).toBeInTheDocument();

      // Check all 12 items are rendered
      NODE_PALETTE_ITEMS.forEach((item) => {
        expect(screen.getByTestId(`palette-item-${item.type}`)).toBeInTheDocument();
      });
    });

    it('filters items by search input', () => {
      render(<NodePaletteDrawer />);

      const searchInput = screen.getByTestId('node-palette-search');
      fireEvent.change(searchInput, { target: { value: 'webhook' } });

      expect(screen.getByTestId('palette-item-webhookTrigger')).toBeInTheDocument();
      expect(screen.queryByTestId('palette-item-approvalNode')).toBeNull();
      expect(screen.queryByTestId('palette-item-httpRequestNode')).toBeNull();
    });

    it('shows empty state when no items match search query', () => {
      render(<NodePaletteDrawer />);

      const searchInput = screen.getByTestId('node-palette-search');
      fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } });

      expect(screen.getByText('No nodes found')).toBeInTheDocument();
    });

    it('filters items by category pill', () => {
      render(<NodePaletteDrawer />);

      const triggersBtn = screen.getByTestId('category-filter-triggers');
      fireEvent.click(triggersBtn);

      expect(screen.getByTestId('palette-item-webhookTrigger')).toBeInTheDocument();
      expect(screen.getByTestId('palette-item-scheduleTrigger')).toBeInTheDocument();
      expect(screen.queryByTestId('palette-item-httpRequestNode')).toBeNull();

      const actionsBtn = screen.getByTestId('category-filter-actions');
      fireEvent.click(actionsBtn);

      expect(screen.getByTestId('palette-item-httpRequestNode')).toBeInTheDocument();
      expect(screen.getByTestId('palette-item-sendEmailNode')).toBeInTheDocument();
      expect(screen.queryByTestId('palette-item-webhookTrigger')).toBeNull();
    });

    it('invokes onAddNode callback when item card or add button is clicked', () => {
      const onAddNode = vi.fn();
      render(<NodePaletteDrawer onAddNode={onAddNode} />);

      // Click card
      const webhookCard = screen.getByTestId('palette-item-webhookTrigger');
      fireEvent.click(webhookCard);
      expect(onAddNode).toHaveBeenCalledWith('webhookTrigger');

      // Click quick-add button
      const addBtn = screen.getByTestId('add-node-btn-conditionNode');
      fireEvent.click(addBtn);
      expect(onAddNode).toHaveBeenCalledWith('conditionNode');
    });

    it('sets drag transfer data on drag start', () => {
      const onDragStart = vi.fn();
      render(<NodePaletteDrawer onDragStart={onDragStart} />);

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

    it('invokes onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<NodePaletteDrawer onClose={onClose} />);

      const closeBtn = screen.getByLabelText('Close palette');
      fireEvent.click(closeBtn);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
