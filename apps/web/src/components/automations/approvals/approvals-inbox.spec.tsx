import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AutomationApprovalDto } from '@saas/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { ApprovalsInbox } from './approvals-inbox';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ can: () => true }),
}));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      automations: { listApprovals: vi.fn(), decideApproval: vi.fn() },
    },
  };
});

const future = (ms: number) => new Date(Date.now() + ms).toISOString();
const past = (ms: number) => new Date(Date.now() - ms).toISOString();

const make = (over: Partial<AutomationApprovalDto>): AutomationApprovalDto => ({
  id: 'ap-1',
  executionId: 'exec-1',
  workflowId: 'wf-1',
  nodeId: 'n1',
  kind: 'step',
  title: 'Approve the discount',
  details: { message: 'Please check the 20% discount' },
  status: 'PENDING',
  requestedAt: past(3 * 3600_000),
  expiresAt: future(2 * 86_400_000),
  decidedBy: null,
  decidedAt: null,
  comment: null,
  workflowName: 'Quote follow-up',
  triggerSource: 'event',
  triggerSummary: 'Quote Q-1 accepted',
  ...over,
});

const renderInbox = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApprovalsInbox />
    </QueryClientProvider>,
  );
};

const newer = make({
  id: 'ap-2',
  executionId: 'exec-2',
  workflowId: 'wf-2',
  workflowName: 'Refund flow',
  kind: 'agent_action',
  title: 'Send refund email',
  details: { tool: 'draft_email', preview: { to: 'a@b.co' } },
  requestedAt: past(3600_000),
  expiresAt: null,
  triggerSummary: 'Webhook call',
});

describe('ApprovalsInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists items oldest first with every field', async () => {
    vi.mocked(api.automations.listApprovals).mockResolvedValue([newer, make({})]);
    renderInbox();

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole('link', { name: 'Quote follow-up' })).toHaveAttribute(
      'href',
      '/automations/wf-1',
    );
    expect(within(items[0]).getByText('Approval step')).toBeTruthy();
    expect(within(items[0]).getByText('Quote Q-1 accepted')).toBeTruthy();
    expect(within(items[0]).getByText('Please check the 20% discount')).toBeTruthy();
    expect(within(items[0]).getByText(/Requested 3 hours ago/)).toBeTruthy();
    expect(within(items[0]).getByText(/Times out in 2 days — takes the timeout path/)).toBeTruthy();

    expect(within(items[1]).getByText('AI action')).toBeTruthy();
    expect(within(items[1]).getByText('draft_email')).toBeTruthy();
    expect(within(items[1]).getByText(/a@b\.co/)).toBeTruthy();
    expect(within(items[1]).getByText('No timeout shown')).toBeTruthy();
  });

  it('says the action is dropped for an agent approval with a timeout', async () => {
    vi.mocked(api.automations.listApprovals).mockResolvedValue([
      { ...newer, expiresAt: future(2 * 3600_000) },
    ]);
    renderInbox();
    expect(await screen.findByText(/the action is dropped/)).toBeTruthy();
  });

  it('shows the empty state', async () => {
    vi.mocked(api.automations.listApprovals).mockResolvedValue([]);
    renderInbox();
    expect(await screen.findByText('Nothing is waiting for approval.')).toBeTruthy();
  });

  it('removes the item after Approve', async () => {
    vi.mocked(api.automations.listApprovals)
      .mockResolvedValueOnce([make({})])
      .mockResolvedValue([]);
    vi.mocked(api.automations.decideApproval).mockResolvedValue(make({ status: 'APPROVED' }));
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('Nothing is waiting for approval.')).toBeTruthy());
    expect(api.automations.decideApproval).toHaveBeenCalledWith('ap-1', { action: 'APPROVE' });
  });

  it('on a 409 shows who decided and removes the item', async () => {
    vi.mocked(api.automations.listApprovals).mockResolvedValue([make({})]);
    const err = Object.assign(new ApiError(409, 'Conflict'), {
      body: { status: 'APPROVED', decidedBy: { id: 'u', name: 'Dana' }, decidedAt: past(60_000) },
    });
    vi.mocked(api.automations.decideApproval).mockRejectedValue(err);
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/^Already approved by Dana/)),
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
