import React, { Suspense } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AutomationAgentOptionDto, AutomationWorkflowDto } from '@saas/shared';
import AutomationStudioPage from './page';

const mutateAsync = vi.fn();
const regenerateMutateAsync = vi.fn();

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ can: () => true }),
}));

const automationState: { current: { data: AutomationWorkflowDto | null; isLoading: boolean } } = {
  current: { data: null, isLoading: true },
};

const agentOptionsState: { current: AutomationAgentOptionDto[] | undefined } = { current: [] };

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  notFound: vi.fn(),
}));

vi.mock('@/hooks/use-automations', () => ({
  useAutomation: () => ({ ...automationState.current, error: null, refresh: vi.fn() }),
  useUpdateAutomationWorkflow: () => ({ mutateAsync, isPending: false }),
  useRegenerateAutomationWebhook: () => ({ mutateAsync: regenerateMutateAsync }),
  useTestRunAutomation: () => ({ mutateAsync: vi.fn(), getExecution: vi.fn() }),
  useAutomationSettings: () => ({ data: { aiEmailToCustomers: false } }),
  useAutomationAgentOptions: () => ({ data: agentOptionsState.current }),
}));

vi.mock('@/components/automations/canvas/automation-canvas', () => ({
  AutomationCanvas: ({
    nodes,
    onSelectNode,
  }: {
    nodes: { id: string; data: { label: string } }[];
    onSelectNode: (n: { id: string }) => void;
  }) => (
    <ul data-testid="canvas">
      {nodes.map((n) => (
        <li key={n.id} onClick={() => onSelectNode(n)}>
          {n.data.label}
        </li>
      ))}
    </ul>
  ),
}));

const savedWorkflow: AutomationWorkflowDto = {
  id: 'wf-1',
  tenantId: 'tenant-1',
  name: 'Quote follow-up',
  status: 'ACTIVE',
  triggerType: 'MANUAL',
  triggerConfig: {},
  nodes: [
    { id: 't', type: 'manualTrigger', position: { x: 0, y: 0 }, data: { label: 'Start', config: {} } },
    { id: 'm', type: 'sendEmailNode', position: { x: 0, y: 120 }, data: { label: 'Email owner', config: {} } },
  ],
  edges: [{ id: 't-m', source: 't', target: 'm' }],
  version: 3,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('AutomationStudioPage', () => {
  it('shows the saved graph when the workflow arrives after the first render', async () => {
    const params = Promise.resolve({ id: 'wf-1' });
    const page = () => (
      <Suspense fallback={null}>
        <AutomationStudioPage params={params} />
      </Suspense>
    );

    automationState.current = { data: null, isLoading: true };
    const view = await act(async () => render(page()));
    expect(screen.getByText('Loading Automation Studio...')).toBeInTheDocument();

    automationState.current = { data: savedWorkflow, isLoading: false };
    await act(async () => view.rerender(page()));

    const canvas = await screen.findByTestId('canvas');
    expect(canvas).toHaveTextContent('Start');
    expect(canvas).toHaveTextContent('Email owner');
  });

  it('lifts regenerateSignature out of triggerConfig when saving a secret rotation', async () => {
    const hook: AutomationWorkflowDto = {
      ...savedWorkflow,
      triggerType: 'WEBHOOK',
      webhookSlug: 'a'.repeat(43),
      triggerConfig: { requireSignature: true, signatureSecret: 'old' },
      nodes: [{ id: 't', type: 'webhookTrigger', position: { x: 0, y: 0 }, data: { label: 'Hook', config: {} } }],
      edges: [],
    };
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(hook);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    automationState.current = { data: hook, isLoading: false };
    const params = Promise.resolve({ id: 'wf-1' });
    await act(async () =>
      render(
        <Suspense fallback={null}>
          <AutomationStudioPage params={params} />
        </Suspense>,
      ),
    );
    fireEvent.click(await screen.findByText('Hook'));
    fireEvent.click(await screen.findByTestId('webhook-secret-regenerate'));
    expect(screen.getByTestId('save-workflow-btn')).toHaveTextContent('Save Changes*');
    fireEvent.click(screen.getByTestId('save-workflow-btn'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const input = mutateAsync.mock.calls[0][0].input;
    expect(input.regenerateSignature).toBe(true);
    expect(input.triggerConfig).toEqual({ requireSignature: true });
  });

  describe('trigger settings in the save payload', () => {
    const scheduleWorkflow: AutomationWorkflowDto = {
      ...savedWorkflow,
      triggerType: 'SCHEDULE',
      triggerConfig: { schedule: { frequency: 'daily', time: '09:00', timezone: 'Asia/Dubai' } },
      nodes: [
        { id: 't', type: 'scheduleTrigger', position: { x: 0, y: 0 }, data: { label: 'Tick', config: {} } },
      ],
      edges: [],
    };

    const open = async () => {
      mutateAsync.mockReset();
      mutateAsync.mockResolvedValue(scheduleWorkflow);
      automationState.current = { data: scheduleWorkflow, isLoading: false };
      const params = Promise.resolve({ id: 'wf-1' });
      await act(async () =>
        render(
          <Suspense fallback={null}>
            <AutomationStudioPage params={params} />
          </Suspense>,
        ),
      );
      await screen.findByTestId('canvas');
    };

    it('omits triggerConfig when only the name changed', async () => {
      await open();
      fireEvent.change(screen.getByTestId('workflow-name-input'), { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByTestId('save-workflow-btn'));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
      const input = mutateAsync.mock.calls[0][0].input;
      expect(input.name).toBe('Renamed');
      expect(input).not.toHaveProperty('triggerConfig');
    });

    it('blocks Save while the schedule is invalid, so a stale schedule is never sent', async () => {
      await open();
      fireEvent.click(screen.getByText('Tick'));
      fireEvent.change(await screen.findByTestId('schedule-frequency'), { target: { value: 'monthly' } });
      fireEvent.change(screen.getByTestId('schedule-day-of-month'), { target: { value: '31' } });
      expect(screen.getByTestId('save-workflow-btn')).toBeDisabled();
      fireEvent.click(screen.getByTestId('save-workflow-btn'));
      expect(mutateAsync).not.toHaveBeenCalled();
      fireEvent.change(screen.getByTestId('schedule-day-of-month'), { target: { value: '15' } });
      expect(screen.getByTestId('save-workflow-btn')).not.toBeDisabled();
    });

    it('sends triggerConfig after a schedule edit, marks the canvas dirty, then resets', async () => {
      await open();
      fireEvent.click(screen.getByText('Tick'));
      fireEvent.change(await screen.findByTestId('schedule-frequency'), { target: { value: 'hourly' } });
      expect(screen.getByTestId('save-workflow-btn')).toHaveTextContent('Save Changes*');
      expect(screen.getByTestId('owner-warning')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('save-workflow-btn'));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(mutateAsync.mock.calls[0][0].input.triggerConfig).toEqual({
        schedule: { frequency: 'hourly', minute: 0, timezone: 'Asia/Dubai' },
      });
      await waitFor(() => expect(screen.getByTestId('save-workflow-btn')).toHaveTextContent('Saved'));
      fireEvent.click(screen.getByTestId('save-workflow-btn'));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
      expect(mutateAsync.mock.calls[1][0].input).not.toHaveProperty('triggerConfig');
    });
  });

  describe('activating', () => {
    const quoteAlert: AutomationWorkflowDto = {
      ...savedWorkflow,
      name: 'Big quote alert',
      status: 'DRAFT',
      triggerType: 'CRM_EVENT',
      triggerConfig: { event: 'quote.accepted' },
      nodes: [
        // Saved by an older build, with the event under `eventType`.
        { id: 't', type: 'crmEventTrigger', position: { x: 0, y: 0 }, data: { label: 'Quote in', config: { eventType: 'quote.accepted' } } },
      ],
      edges: [],
    };

    const open = async (wf: AutomationWorkflowDto) => {
      mutateAsync.mockReset();
      push.mockReset();
      automationState.current = { data: wf, isLoading: false };
      const params = Promise.resolve({ id: 'wf-1' });
      await act(async () =>
        render(
          <Suspense fallback={null}>
            <AutomationStudioPage params={params} />
          </Suspense>,
        ),
      );
      await screen.findByTestId('canvas');
    };

    describe('with an AI agent step', () => {
      const withAgentStep = (config: Record<string, unknown>, status: 'DRAFT' | 'ACTIVE' = 'DRAFT') => ({
        ...quoteAlert,
        status,
        nodes: [
          ...quoteAlert.nodes,
          { id: 'a', type: 'aiAgentNode' as const, position: { x: 0, y: 120 }, data: { label: 'Chase quote', config } },
        ],
      });
      const chaser = { id: 'agent-1', name: 'Quote chaser', description: '', isEnabled: true, tools: [] };

      it('cannot be activated while the step has no task, and says which step', async () => {
        agentOptionsState.current = [chaser];
        await open(withAgentStep({ goal: '' }));

        const activate = screen.getByTestId('status-toggle-btn');
        expect(activate).toBeDisabled();
        expect(activate).toHaveAttribute(
          'title',
          'The AI agent step "Chase quote" has no task. Say what the agent should do before switching this automation on.',
        );
      });

      it('can be activated once the task is typed, and the task is saved with it', async () => {
        agentOptionsState.current = [chaser];
        const wf = withAgentStep({ goal: '', agentId: 'agent-1' });
        await open(wf);
        mutateAsync.mockResolvedValue({ ...wf, status: 'ACTIVE' });

        fireEvent.click(screen.getByText('Chase quote'));
        fireEvent.change(screen.getByTestId('agent-step-task-input'), {
          target: { value: 'Follow up quote {{ $trigger.payload.quoteNumber }}' },
        });
        const activate = screen.getByTestId('status-toggle-btn');
        expect(activate).toBeEnabled();
        fireEvent.click(activate);
        fireEvent.click(screen.getByRole('button', { name: 'Activate automation' }));

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        const input = mutateAsync.mock.calls[0][0].input;
        expect(input.status).toBe('ACTIVE');
        expect(input.nodes.find((n: { id: string }) => n.id === 'a').data.config).toEqual({
          goal: 'Follow up quote {{ $trigger.payload.quoteNumber }}',
          agentId: 'agent-1',
        });
      });

      it('cannot be activated while its agent is switched off', async () => {
        agentOptionsState.current = [{ ...chaser, isEnabled: false }];
        await open(withAgentStep({ goal: 'Chase it', agentId: 'agent-1' }));

        expect(screen.getByTestId('status-toggle-btn')).toBeDisabled();
        expect(screen.getByTestId('status-toggle-btn').getAttribute('title')).toContain(
          '"Quote chaser" is switched off in Settings → AI',
        );
      });

      it('a draft with an unfinished step can still be saved', async () => {
        agentOptionsState.current = [chaser];
        const wf = withAgentStep({ goal: 'Chase it' });
        await open(wf);
        mutateAsync.mockResolvedValue(wf);

        fireEvent.click(screen.getByText('Chase quote'));
        fireEvent.change(screen.getByTestId('agent-step-task-input'), { target: { value: '' } });
        expect(screen.getByTestId('save-workflow-btn')).toBeEnabled();
        fireEvent.click(screen.getByTestId('save-workflow-btn'));

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        expect(mutateAsync.mock.calls[0][0].input).not.toHaveProperty('status');
      });

      it('an automation that is on cannot be saved with the task removed', async () => {
        agentOptionsState.current = [chaser];
        await open(withAgentStep({ goal: 'Chase it' }, 'ACTIVE'));

        fireEvent.click(screen.getByText('Chase quote'));
        fireEvent.change(screen.getByTestId('agent-step-task-input'), { target: { value: '  ' } });

        const save = screen.getByTestId('save-workflow-btn');
        expect(save).toBeDisabled();
        expect(save.getAttribute('title')).toContain('has no task');
        // Switching it off is still possible.
        expect(screen.getByTestId('status-toggle-btn')).toBeEnabled();
      });
    });

    it('asks first, naming what it runs on, then saves only the status', async () => {
      await open(quoteAlert);
      mutateAsync.mockResolvedValue({ ...quoteAlert, status: 'ACTIVE' });
      fireEvent.click(screen.getByTestId('status-toggle-btn'));
      expect(mutateAsync).not.toHaveBeenCalled();
      expect(screen.getByText('Activate “Big quote alert”?')).toBeInTheDocument();
      expect(screen.getByText(/It runs every time a customer accepts a quote./)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Activate automation' }));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(mutateAsync.mock.calls[0][0].input).toEqual({ status: 'ACTIVE' });
      await waitFor(() => expect(screen.getByTestId('status-toggle-btn')).toHaveTextContent('Deactivate'));
      expect(screen.getByTestId('workflow-status-badge')).toHaveTextContent('ACTIVE');
    });

    it('saves pending edits with the status, and writes the event as `event`', async () => {
      await open(quoteAlert);
      mutateAsync.mockResolvedValue({ ...quoteAlert, status: 'ACTIVE' });
      fireEvent.change(screen.getByTestId('workflow-name-input'), { target: { value: 'Big quote alert 2' } });
      expect(screen.getByTestId('save-workflow-btn')).toHaveTextContent('Save Changes*');
      fireEvent.click(screen.getByTestId('status-toggle-btn'));
      expect(screen.getByText(/Your unsaved changes are saved with it./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Activate automation' }));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      const input = mutateAsync.mock.calls[0][0].input;
      expect(input.status).toBe('ACTIVE');
      expect(input.name).toBe('Big quote alert 2');
      expect(input.nodes[0].data.config).toEqual({ event: 'quote.accepted' });
    });

    it('Save never changes the status', async () => {
      await open(quoteAlert);
      mutateAsync.mockResolvedValue(quoteAlert);
      fireEvent.change(screen.getByTestId('workflow-name-input'), { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByTestId('save-workflow-btn'));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
      expect(mutateAsync.mock.calls[0][0].input).not.toHaveProperty('status');
    });

    it('Back asks before dropping unsaved changes', async () => {
      await open(quoteAlert);
      fireEvent.change(screen.getByTestId('workflow-name-input'), { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByTestId('back-to-automations-link'));
      expect(screen.getByText('Leave without saving?')).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/automations'));
    });
  });
});
