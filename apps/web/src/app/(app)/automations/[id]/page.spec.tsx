import React, { Suspense } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AutomationWorkflowDto } from '@saas/shared';
import AutomationStudioPage from './page';

const mutateAsync = vi.fn();
const regenerateMutateAsync = vi.fn();

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ can: () => true }),
}));

const automationState: { current: { data: AutomationWorkflowDto | null; isLoading: boolean } } = {
  current: { data: null, isLoading: true },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: vi.fn(),
}));

vi.mock('@/hooks/use-automations', () => ({
  useAutomation: () => ({ ...automationState.current, error: null, refresh: vi.fn() }),
  useUpdateAutomationWorkflow: () => ({ mutateAsync, isPending: false }),
  useRegenerateAutomationWebhook: () => ({ mutateAsync: regenerateMutateAsync }),
  useTestRunAutomation: () => ({ mutateAsync: vi.fn(), getExecution: vi.fn() }),
  useAutomationSettings: () => ({ data: { aiEmailToCustomers: false } }),
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
});
