import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChannelThreadDto } from '@saas/shared';
import { api, type ChannelMessageDto } from '@/lib/api/endpoints';
import { HandoverBar, pickHandover } from './handover';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      channels: {
        ...original.api.channels,
        takeOverThread: vi.fn().mockResolvedValue({}),
        returnThreadToAi: vi.fn().mockResolvedValue({}),
        resolveThread: vi.fn().mockResolvedValue({}),
      },
    },
  };
});

const thread = (over: Partial<ChannelThreadDto> = {}): ChannelThreadDto => ({
  id: 't1',
  provider: 'WHATSAPP_META',
  contactId: 'c1',
  state: 'NEEDS_HUMAN',
  assigneeUserId: null,
  assigneeName: null,
  agentId: null,
  agentName: null,
  handoverReason: 'HUMAN_REQUESTED',
  handoverSummary: 'Wants to talk about a late delivery',
  handedOverAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  ...over,
});

const inbound = (over: Partial<ChannelMessageDto> = {}) =>
  ({
    id: 'm1',
    direction: 'INBOUND',
    body: 'can I talk to someone?',
    createdAt: '2026-11-20T10:00:00.000Z',
    aiIntent: 'HUMAN_REQUEST',
    aiSummary: 'Wants to talk about a late delivery',
    aiSuggestedReply: 'Of course, I am checking your delivery now.',
    ...over,
  }) as ChannelMessageDto;

const renderBar = (handover: ChannelThreadDto | undefined, onUseReply = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HandoverBar handover={handover} messages={[inbound()]} onUseReply={onUseReply} />
    </QueryClientProvider>,
  );
  return onUseReply;
};

describe('pickHandover', () => {
  it('shows the channel waiting on a person when a contact writes on two', () => {
    const picked = pickHandover(
      [thread({ id: 'a', state: 'AI' }), thread({ id: 'b', state: 'NEEDS_HUMAN' })],
      'c1',
    );
    expect(picked?.id).toBe('b');
  });

  it('has nothing to show for a conversation without a contact', () => {
    expect(pickHandover([thread()], null)).toBeUndefined();
  });
});

describe('HandoverBar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says why the AI stopped and what it understood', () => {
    renderBar(thread());
    expect(screen.getByText(/waiting for a person/)).toBeInTheDocument();
    expect(screen.getByText(/The customer asked for a person/)).toBeInTheDocument();
    expect(screen.getByText(/Wants to talk about a late delivery/)).toBeInTheDocument();
  });

  it('takes the conversation over', async () => {
    renderBar(thread());
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    await waitFor(() => expect(api.channels.takeOverThread).toHaveBeenCalledWith('t1'));
  });

  it('puts the suggested reply into the composer', () => {
    const onUseReply = renderBar(thread());
    fireEvent.click(screen.getByRole('button', { name: 'Use this reply' }));
    expect(onUseReply).toHaveBeenCalledWith('Of course, I am checking your delivery now.');
  });

  it('offers to give a conversation a person holds back to the AI, or resolve it', async () => {
    renderBar(thread({ state: 'HUMAN', assigneeName: 'Aisha Khan' }));
    expect(screen.getByText(/Aisha Khan is answering/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to AI' }));
    await waitFor(() => expect(api.channels.returnThreadToAi).toHaveBeenCalledWith('t1'));
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });

  it('only offers to take over while the AI is answering', () => {
    renderBar(thread({ state: 'AI', handoverReason: null }));
    expect(screen.getByText(/The AI is answering/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to AI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this reply' })).not.toBeInTheDocument();
  });

  it('names the agent that holds the conversation', () => {
    renderBar(thread({ state: 'AI', handoverReason: null, agentId: 'a1', agentName: 'Sales' }));
    expect(screen.getByText(/The Sales agent is answering/)).toBeInTheDocument();
  });
});
