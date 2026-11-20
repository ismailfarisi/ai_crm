import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChannelAiTestResultDto } from '@saas/shared';
import { AiTryMessage } from './ai-try-message';

const test = vi.fn();

vi.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      intentAgentConfig: {
        ...original.api.intentAgentConfig,
        test: (payload: unknown) => test(payload),
      },
    },
  };
});

const result = (over: Partial<ChannelAiTestResultDto>): ChannelAiTestResultDto => ({
  outcome: 'HANDOVER',
  intent: 'ORDER_STATUS',
  confidence: 0.9,
  summary: 'Asks where order 1042 is',
  rule: null,
  question: null,
  handoverReason: null,
  thenHandover: false,
  ...over,
});

async function tryMessage(message: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiTryMessage />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Customer message'), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'See what happens' }));
  return screen.findByRole('status');
}

describe('AiTryMessage', () => {
  beforeEach(() => test.mockReset());

  it('shows what the AI read and the reply a rule would send', async () => {
    test.mockResolvedValue(
      result({
        outcome: 'RULE',
        rule: {
          name: 'Order status reply',
          actionType: 'AUTO_ACK',
          reply: 'We are checking on your order.',
        },
      }),
    );
    const status = await tryMessage('where is my order 1042?');

    expect(test).toHaveBeenCalledWith({
      body: 'where is my order 1042?',
      provider: 'WHATSAPP_META',
    });
    expect(status).toHaveTextContent('A question about an order (90% sure)');
    expect(status).toHaveTextContent('The rule "Order status reply" would send this reply.');
    expect(status).toHaveTextContent('We are checking on your order.');
  });

  it('shows the question the AI would ask', async () => {
    test.mockResolvedValue(
      result({ outcome: 'ASK', confidence: 0.4, question: 'Which order is this about?' }),
    );
    const status = await tryMessage('hi');
    expect(status).toHaveTextContent('would ask the customer this question');
    expect(status).toHaveTextContent('Which order is this about?');
  });

  it('says why a conversation would go to a person', async () => {
    test.mockResolvedValue(
      result({ intent: 'HUMAN_REQUEST', handoverReason: 'HUMAN_REQUESTED' }),
    );
    const status = await tryMessage('can I talk to someone?');
    expect(status).toHaveTextContent('would go to a person in the Inbox');
    expect(status).toHaveTextContent('The customer asked for a person');
  });

  it('says a complaint goes to a person after its rule replies', async () => {
    test.mockResolvedValue(
      result({
        outcome: 'RULE',
        intent: 'COMPLAINT',
        rule: { name: 'Complaint reply', actionType: 'AUTO_ACK', reply: 'Sorry about that.' },
        thenHandover: true,
      }),
    );
    const status = await tryMessage('the boxes arrived crushed');
    expect(status).toHaveTextContent('The conversation would then go to a person.');
  });

  it('points at the setup when the AI cannot read the message', async () => {
    test.mockResolvedValue(
      result({ outcome: 'UNAVAILABLE', intent: null, confidence: null, summary: null }),
    );
    const status = await tryMessage('hello');
    expect(status).toHaveTextContent('Check that a provider is connected');
  });

  it('does nothing until a message is typed', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AiTryMessage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'See what happens' })).toBeDisabled();
    await waitFor(() => expect(test).not.toHaveBeenCalled());
  });
});
