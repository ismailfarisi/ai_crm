import React, { Suspense } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { AutomationWorkflowDto } from '@saas/shared';
import AutomationStudioPage from './page';

const automationState: { current: { data: AutomationWorkflowDto | null; isLoading: boolean } } = {
  current: { data: null, isLoading: true },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: vi.fn(),
}));

vi.mock('@/hooks/use-automations', () => ({
  useAutomation: () => ({ ...automationState.current, error: null, refresh: vi.fn() }),
  useUpdateAutomationWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestRunAutomation: () => ({ mutateAsync: vi.fn(), getExecution: vi.fn() }),
}));

vi.mock('@/components/automations/canvas/automation-canvas', () => ({
  AutomationCanvas: ({ nodes }: { nodes: { id: string; data: { label: string } }[] }) => (
    <ul data-testid="canvas">
      {nodes.map((n) => (
        <li key={n.id}>{n.data.label}</li>
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
});
