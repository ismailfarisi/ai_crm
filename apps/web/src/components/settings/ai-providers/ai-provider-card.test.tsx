import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, type AiConfigDto } from '@/lib/api/endpoints';
import { AiProviderCard } from './ai-provider-card';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: { ...original.api, ai: { saveConfig: vi.fn(), testConfig: vi.fn(), setDefaultConfig: vi.fn() } },
  };
});

const config: AiConfigDto = {
  id: 'c1',
  organizationId: 'o1',
  provider: 'OPENAI',
  isEnabled: false,
  isDefault: false,
  status: 'configured',
  credentials: { model: 'gpt-4o-mini' },
  lastTestedAt: null,
};

const renderCard = (over: Partial<AiConfigDto> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiProviderCard config={{ ...config, ...over }} onConfigure={vi.fn()} />
    </QueryClientProvider>,
  );

describe('AiProviderCard', () => {
  it('names the switch after the provider and saves what it is set to', async () => {
    vi.mocked(api.ai.saveConfig).mockResolvedValue({ ...config, isEnabled: true });
    renderCard();
    const toggle = screen.getByRole('switch', { name: 'Enable OpenAI' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.ai.saveConfig).toHaveBeenCalledWith('OPENAI', expect.objectContaining({ isEnabled: true })),
    );
  });

  it('cannot be switched on before credentials exist', () => {
    renderCard({ status: 'unconfigured' });
    expect(screen.getByRole('switch', { name: 'Enable OpenAI' })).toBeDisabled();
  });
});
