import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CUSTOMER_AGENT_TOOLS, type ChannelAgentDto } from '@saas/shared';
import { AgentsView } from './agents-view';

const calls = {
  list: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  customers: vi.fn(),
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
      customers: { ...original.api.customers, list: (params: unknown) => calls.customers(params) },
      channelAgents: {
        ...original.api.channelAgents,
        list: () => calls.list(),
        tools: async () => [...CUSTOMER_AGENT_TOOLS],
        update: (id: string, input: unknown) => calls.update(id, input),
        test: (input: unknown) => calls.test(input),
      },
    },
  };
});

const support: ChannelAgentDto = {
  id: 'a1',
  name: 'Support',
  description: 'Order and quote questions',
  instructions: 'Be brief.',
  kind: 'CUSTOMER',
  provider: null,
  model: null,
  skills: [],
  channels: ['WHATSAPP_META'],
  isEnabled: true,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
};

function renderView() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentsView />
    </QueryClientProvider>,
  );
}

describe('order and quote tools on a customer agent', () => {
  beforeEach(() => {
    Object.values(calls).forEach((fn) => fn.mockReset());
    calls.customers.mockResolvedValue({
      items: [{ id: 'cust-a', companyName: 'Al Noor Sweets' }],
      total: 1,
    });
  });

  it('are off until ticked, and say who gets an answer once they are', async () => {
    calls.list.mockResolvedValue([support]);
    calls.update.mockResolvedValue({ ...support, skills: ['check_order_status'] });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }));

    const form = within(await screen.findByRole('dialog'));
    const orders = await form.findByLabelText(/Answer "where is my order"/);
    expect(orders).not.toBeChecked();
    expect(form.getByLabelText(/Answer "what is the status of my quote"/)).not.toBeChecked();
    expect(form.queryByRole('note')).not.toBeInTheDocument();

    fireEvent.click(orders);
    expect(form.getByRole('note')).toHaveTextContent(
      'only a sender Kerf can match to one customer',
    );
    expect(form.getByRole('note')).toHaveTextContent('Everyone else is told nothing');

    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.update).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ skills: ['check_order_status'] }),
      ),
    );
  });

  it('does not ask who the sender is while no agent can look anything up', async () => {
    calls.list.mockResolvedValue([support]);
    renderView();
    await screen.findByLabelText('Message');
    expect(screen.queryByLabelText('The sender is')).not.toBeInTheDocument();
    expect(calls.customers).not.toHaveBeenCalled();
  });

  it('tries a message as a stranger by default, and as a chosen customer', async () => {
    calls.list.mockResolvedValue([{ ...support, skills: ['check_order_status'] }]);
    calls.test.mockResolvedValue({
      outcome: 'REPLY',
      agent: { id: 'a1', name: 'Support' },
      transfers: [],
      reply: 'SO-0007 is in production.',
      tool: null,
      actions: ['Look up orders for Al Noor Sweets'],
      handoverSummary: null,
    });
    renderView();
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'where is my order?' },
    });
    const sender = await screen.findByLabelText('The sender is');
    expect(sender).toHaveValue('');
    expect(sender).toHaveDisplayValue('Not matched to a customer');

    fireEvent.click(screen.getByRole('button', { name: 'See what happens' }));
    await waitFor(() =>
      expect(calls.test).toHaveBeenLastCalledWith({
        body: 'where is my order?',
        provider: 'WHATSAPP_META',
        kind: 'CUSTOMER',
      }),
    );

    await screen.findByRole('option', { name: 'Al Noor Sweets' });
    fireEvent.change(sender, { target: { value: 'cust-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'See what happens' }));
    await waitFor(() =>
      expect(calls.test).toHaveBeenLastCalledWith({
        body: 'where is my order?',
        provider: 'WHATSAPP_META',
        kind: 'CUSTOMER',
        asCustomerId: 'cust-a',
      }),
    );
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Look up orders for Al Noor Sweets');
    expect(status).toHaveTextContent('SO-0007 is in production.');
  });
});
