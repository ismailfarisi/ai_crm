import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChannelConfigDto } from '@/lib/api/endpoints';
import { ChannelCard } from './channel-card';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function config(over: Partial<ChannelConfigDto> = {}): ChannelConfigDto {
  return {
    id: 'c1',
    organizationId: 'org',
    provider: 'WHATSAPP_META',
    isEnabled: true,
    status: 'configured',
    credentials: null,
    webhookSecret: null,
    webhookUrl: 'https://api.example.test/webhooks/whatsapp',
    lastTestedAt: null,
    ...over,
  };
}

function renderCard(c: ChannelConfigDto) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelCard config={c} onConfigure={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ChannelCard toggle', () => {
  it('is a switch named for the channel it enables', () => {
    renderCard(config());
    const toggle = screen.getByRole('switch', { name: 'Enable WhatsApp' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it('is disabled until the channel has credentials', () => {
    renderCard(config({ provider: 'TELEGRAM', status: 'unconfigured', isEnabled: false }));
    expect(screen.getByRole('switch', { name: 'Enable Telegram' })).toBeDisabled();
  });
});
