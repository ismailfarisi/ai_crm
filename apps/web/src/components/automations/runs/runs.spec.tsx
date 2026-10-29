import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AutomationApprovalDto, AutomationExecutionDto } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { runsRefetchInterval } from '@/hooks/use-automations';
import { RunsDrawer } from './runs-drawer';
import { RunDetail } from './run-detail';
import { ApprovalDecision } from './approval-decision';

const session = { canApprove: true };
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ can: () => session.canApprove }),
}));

vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      automations: {
        listExecutions: vi.fn(),
        getExecution: vi.fn(),
        decideApproval: vi.fn(),
      },
    },
  };
});

const wrapper = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const summary = (id: string, status: 'FAILED' | 'COMPLETED', source: 'webhook' | 'event') => ({
  id,
  workflowId: 'wf-1',
  status,
  triggerSource: source,
  startedAt: '2026-10-01T10:00:00Z',
  finishedAt: '2026-10-01T10:00:05Z',
  errorMessage: null,
});

const detail = (over: Partial<AutomationExecutionDto> = {}): AutomationExecutionDto => ({
  id: 'exec-1',
  tenantId: 't',
  workflowId: 'wf-1',
  temporalWorkflowId: 'tw',
  status: 'FAILED',
  triggerSource: 'webhook',
  triggerPayload: { marker: 'payload-secret' },
  nodeResults: {},
  dataHidden: false,
  pendingApprovals: [],
  startedAt: '2026-10-01T10:00:00Z',
  finishedAt: '2026-10-01T10:00:05Z',
  errorMessage: 'Run failed hard',
  ...over,
});

const approval: AutomationApprovalDto = {
  id: 'ap-1',
  executionId: 'exec-1',
  workflowId: 'wf-1',
  nodeId: 'n1',
  kind: 'step',
  title: 'Approve the discount',
  details: {},
  status: 'PENDING',
  requestedAt: '2026-10-01T10:00:00Z',
  expiresAt: null,
  decidedBy: null,
  decidedAt: null,
  comment: null,
  workflowName: 'Flow',
  triggerSource: 'event',
  triggerSummary: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  session.canApprove = true;
});

describe('RunsDrawer', () => {
  it('lists runs with labels and loads the next cursor', async () => {
    vi.mocked(api.automations.listExecutions)
      .mockResolvedValueOnce({ items: [summary('e1', 'FAILED', 'webhook')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [summary('e2', 'COMPLETED', 'event')], nextCursor: null });

    wrapper(<RunsDrawer workflowId="wf-1" onClose={vi.fn()} />);

    expect(await screen.findByText('Webhook')).toBeDefined();
    expect(screen.getAllByTestId('run-status-chip')[0].textContent).toBe('Failed');

    fireEvent.click(screen.getByText('Load more'));
    expect(await screen.findByText('Event')).toBeDefined();
    expect(api.automations.listExecutions).toHaveBeenLastCalledWith('wf-1', { cursor: 'c2' });
    await waitFor(() => expect(screen.queryByText('Load more')).toBeNull());
  });

  it('sends status=FAILED when the Failed filter is chosen', async () => {
    vi.mocked(api.automations.listExecutions).mockResolvedValue({ items: [], nextCursor: null });
    wrapper(<RunsDrawer workflowId="wf-1" onClose={vi.fn()} />);
    await screen.findByText('No runs yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() =>
      expect(api.automations.listExecutions).toHaveBeenLastCalledWith('wf-1', { status: 'FAILED' }),
    );
  });
});

describe('RunDetail', () => {
  it('orders steps by startedAt and shows the run error', async () => {
    vi.mocked(api.automations.getExecution).mockResolvedValue(
      detail({
        nodeResults: {
          b: { status: 'SUCCESS', label: 'Second step', type: 'sendEmailNode', startedAt: '2026-10-01T10:00:03Z' },
          a: {
            status: 'FAILED',
            label: 'First step',
            type: 'httpRequestNode',
            error: 'boom',
            input: { x: 1 },
            startedAt: '2026-10-01T10:00:01Z',
          },
        },
      }),
    );
    wrapper(<RunDetail executionId="exec-1" onBack={vi.fn()} />);

    const steps = await screen.findAllByTestId('run-step');
    expect(steps[0].textContent).toContain('First step');
    expect(steps[1].textContent).toContain('Second step');
    expect(screen.getByText('Run failed hard')).toBeDefined();
    expect(screen.getByText('boom')).toBeDefined();
  });

  it('hides data and shows the copy when dataHidden', async () => {
    vi.mocked(api.automations.getExecution).mockResolvedValue(
      detail({
        dataHidden: true,
        triggerPayload: {},
        nodeResults: { a: { status: 'SUCCESS', label: 'Only step', startedAt: '2026-10-01T10:00:01Z' } },
      }),
    );
    const { container } = wrapper(<RunDetail executionId="exec-1" onBack={vi.fn()} />);

    expect(await screen.findByText("You can't see the data in this run.")).toBeDefined();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('says details were not recorded for an UNKNOWN run with no steps', async () => {
    vi.mocked(api.automations.getExecution).mockResolvedValue(
      detail({ status: 'UNKNOWN', errorMessage: null }),
    );
    wrapper(<RunDetail executionId="exec-1" onBack={vi.fn()} />);
    expect(await screen.findByText("Details weren't recorded for this run.")).toBeDefined();
  });
});

describe('ApprovalDecision', () => {
  it('posts APPROVE with the comment', async () => {
    vi.mocked(api.automations.decideApproval).mockResolvedValue({ ...approval, status: 'APPROVED' });
    const onDecided = vi.fn();
    wrapper(<ApprovalDecision approval={approval} onDecided={onDecided} />);

    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'looks fine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(api.automations.decideApproval).toHaveBeenCalledWith('ap-1', {
        action: 'APPROVE',
        comment: 'looks fine',
      }),
    );
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
  });

  it('shows who decided first on a 409', async () => {
    const conflict = Object.assign(new ApiError(409, 'Conflict'), {
      body: {
        message: 'Conflict',
        status: 'APPROVED',
        decidedBy: { id: 'u2', name: 'Ana' },
        decidedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    });
    vi.mocked(api.automations.decideApproval).mockRejectedValue(conflict);
    const onDecided = vi.fn();
    wrapper(<ApprovalDecision approval={approval} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(/Already approved by Ana, /)).toBeDefined();
    expect(onDecided).toHaveBeenCalled();
  });

  it('is hidden without automation:approve', () => {
    session.canApprove = false;
    const { container } = wrapper(<ApprovalDecision approval={approval} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('runs polling', () => {
  it('polls every 5000 ms while a run is moving and stops when all are finished', () => {
    expect(runsRefetchInterval(['COMPLETED', 'RUNNING'])).toBe(5000);
    expect(runsRefetchInterval(['WAITING_APPROVAL'])).toBe(5000);
    expect(runsRefetchInterval(['COMPLETED', 'FAILED', 'UNKNOWN'])).toBe(false);
  });
});
