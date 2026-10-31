import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChannelMessageDto } from '@/lib/api/endpoints';
import { api } from '@/lib/api/endpoints';
import { useMediaQuery } from '@/hooks/use-media-query';
import { InboxWorkspace } from './inbox-workspace';

vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      channels: { ...actual.api.channels, messages: vi.fn(), sendMessage: vi.fn() },
    },
  };
});

vi.mock('@/hooks/use-contacts', () => ({
  useContacts: () => ({ data: { items: [] } }),
}));

vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: vi.fn() }));

const canManage = vi.fn(() => true);
vi.mock('@/lib/session-context', () => ({ useCan: () => canManage() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function message(over: Partial<ChannelMessageDto>): ChannelMessageDto {
  return {
    id: 'm1',
    organizationId: 'org',
    contactId: null,
    provider: 'WHATSAPP_META',
    direction: 'INBOUND',
    sender: '+971500000001',
    recipient: 'shop',
    body: 'Is the order ready?',
    status: 'received',
    createdAt: '2026-10-30T09:00:00.000Z',
    ...over,
  } as ChannelMessageDto;
}

const MESSAGES = [
  message({ id: 'a1', sender: '+971500000001', body: 'Is the order ready?' }),
  message({
    id: 'a2',
    direction: 'OUTBOUND',
    sender: 'shop',
    recipient: '+971500000001',
    body: 'Tomorrow morning',
    status: 'failed',
    createdAt: '2026-10-30T09:05:00.000Z',
  }),
  message({ id: 'b1', sender: '+971500000002', body: 'Send me the quote', createdAt: '2026-10-30T08:00:00.000Z' }),
];

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InboxWorkspace />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.channels.messages).mockReset();
  canManage.mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});

describe('InboxWorkspace on a phone', () => {
  beforeEach(() => vi.mocked(useMediaQuery).mockReturnValue(false));

  it('shows the list first, then one thread with a Back button, then the list again', async () => {
    vi.mocked(api.channels.messages).mockResolvedValue(MESSAGES);
    renderWorkspace();

    const row = await screen.findByRole('button', { name: /\+971500000001/ });
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();

    fireEvent.click(row);

    // The open thread replaces the list: its history and composer are on screen.
    expect(screen.getByText('Tomorrow morning')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search conversations' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));

    expect(screen.getByRole('searchbox', { name: 'Search conversations' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();
  });
});

describe('InboxWorkspace on a desk', () => {
  beforeEach(() => vi.mocked(useMediaQuery).mockReturnValue(true));

  it('shows the list and the newest thread side by side, without a Back button', async () => {
    vi.mocked(api.channels.messages).mockResolvedValue(MESSAGES);
    renderWorkspace();

    expect(await screen.findByRole('searchbox', { name: 'Search conversations' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull();
    expect(screen.getByRole('button', { name: /\+971500000001/ })).toHaveAttribute('aria-current', 'true');
  });

  it('says a message was not delivered in words, not just colour', async () => {
    vi.mocked(api.channels.messages).mockResolvedValue(MESSAGES);
    renderWorkspace();

    const bubble = (await screen.findByText('Tomorrow morning')).parentElement!;
    expect(within(bubble).getByText('Not delivered')).toBeInTheDocument();
  });

  it('labels every composer control', async () => {
    vi.mocked(api.channels.messages).mockResolvedValue(MESSAGES);
    renderWorkspace();

    expect(await screen.findByRole('combobox', { name: 'Send through' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Recipient' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeInTheDocument();
  });

  it('points to Settings › Channels when there are no conversations', async () => {
    vi.mocked(api.channels.messages).mockResolvedValue([]);
    renderWorkspace();

    const link = await screen.findByRole('link', { name: /Settings › Channels/ });
    expect(link).toHaveAttribute('href', '/settings/channels');
  });

  it('explains a failed load in plain words, with Try again', async () => {
    vi.mocked(api.channels.messages).mockRejectedValue(new Error('Internal server error'));
    renderWorkspace();

    expect(await screen.findByText("Couldn't load your messages")).toBeInTheDocument();
    expect(screen.queryByText('Internal server error')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
