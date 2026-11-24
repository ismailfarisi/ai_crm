import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChannelAgentDto, ChannelAgentTestResultDto } from '@saas/shared';
import { AgentsView } from './agents-view';

const calls = {
  list: vi.fn(),
  tools: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
};

vi.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      ai: { ...original.api.ai, listConfigs: async () => [], listModels: async () => [] },
      channelAgents: {
        ...original.api.channelAgents,
        list: () => calls.list(),
        tools: (kind: string) => calls.tools(kind),
        create: (input: unknown) => calls.create(input),
        update: (id: string, input: unknown) => calls.update(id, input),
        test: (input: unknown) => calls.test(input),
      },
    },
  };
});

const sales: ChannelAgentDto = {
  id: 'a1',
  name: 'Sales',
  description: 'New enquiries and quote requests',
  instructions: 'Ask for size and quantity.',
  kind: 'CUSTOMER',
  provider: null,
  model: null,
  skills: ['draft_quote'],
  channels: ['WHATSAPP_META'],
  isEnabled: true, showStockQuantity: false,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
};

const outcome = (over: Partial<ChannelAgentTestResultDto>): ChannelAgentTestResultDto => ({
  outcome: 'REPLY',
  agent: { id: 'a1', name: 'Sales' },
  transfers: [],
  reply: null,
  tool: null,
  actions: [],
  handoverSummary: null,
  ...over,
});

function renderView() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentsView />
    </QueryClientProvider>,
  );
}

describe('AgentsView', () => {
  beforeEach(() => {
    Object.values(calls).forEach((fn) => fn.mockReset());
    calls.list.mockResolvedValue([sales]);
    calls.tools.mockImplementation(async (kind: string) =>
      kind === 'CUSTOMER'
        ? [{ name: 'draft_quote', description: 'Draft a quote', isMutating: true }]
        : [{ name: 'expense.from_document', description: 'Claim an expense', isMutating: true }],
    );
  });

  it('lists each agent with what it handles, its channels and its tools', async () => {
    renderView();
    expect(await screen.findByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('New enquiries and quote requests')).toBeInTheDocument();
    expect(screen.getByText(/On: WhatsApp\. Tools: Draft quote\. Model: default\./)).toBeInTheDocument();
  });

  it('creates a staff agent with the tools and channels ticked', async () => {
    calls.list.mockResolvedValue([]);
    calls.create.mockResolvedValue({ ...sales, name: 'Finance', kind: 'STAFF' });
    renderView();
    fireEvent.click((await screen.findAllByRole('button', { name: /New agent/ }))[0]);

    const dialog = await screen.findByRole('dialog');
    const form = within(dialog);
    fireEvent.change(form.getByLabelText(/Who it works with/), { target: { value: 'STAFF' } });
    fireEvent.change(form.getByLabelText(/^Name/), { target: { value: 'Finance' } });
    fireEvent.change(form.getByLabelText(/What it handles/), {
      target: { value: 'Receipts and supplier invoices' },
    });
    fireEvent.change(form.getByLabelText(/Instructions/), {
      target: { value: 'Fuel goes under Vehicle costs.' },
    });
    fireEvent.click(await form.findByLabelText(/Expense from document/));
    // Staff do not link an email address, so it is not offered.
    expect(form.queryByLabelText(/Email/)).not.toBeInTheDocument();
    fireEvent.click(form.getByLabelText('Slack'));
    fireEvent.click(form.getByRole('button', { name: 'Create agent' }));

    await waitFor(() =>
      expect(calls.create).toHaveBeenCalledWith({
        name: 'Finance',
        description: 'Receipts and supplier invoices',
        instructions: 'Fuel goes under Vehicle costs.',
        kind: 'STAFF',
        provider: null,
        model: null,
        skills: ['expense.from_document'],
        channels: ['SLACK'],
        isEnabled: true,
        showStockQuantity: false,
      }),
    );
  });

  it('shows which agent would take a message and the reply it would write', async () => {
    calls.test.mockResolvedValue(
      outcome({
        agent: { id: 'a2', name: 'Support' },
        transfers: [{ from: 'Sales', to: 'Support', reason: 'A delivery problem' }],
        reply: 'Sorry about that. Which order is it?',
      }),
    );
    renderView();
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'my boxes arrived damaged' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'See what happens' }));

    const status = await screen.findByRole('status');
    expect(calls.test).toHaveBeenCalledWith({
      body: 'my boxes arrived damaged',
      provider: 'WHATSAPP_META',
      kind: 'CUSTOMER',
    });
    expect(status).toHaveTextContent('Sales would pass it to Support: A delivery problem');
    expect(status).toHaveTextContent('Support would send this reply:');
    expect(status).toHaveTextContent('Sorry about that. Which order is it?');
  });

  it('says so when no agent would take the message', async () => {
    calls.test.mockResolvedValue(outcome({ outcome: 'NO_AGENT', agent: null }));
    renderView();
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'See what happens' }));

    expect(await screen.findByRole('status')).toHaveTextContent('No agent would take this message');
  });
});
