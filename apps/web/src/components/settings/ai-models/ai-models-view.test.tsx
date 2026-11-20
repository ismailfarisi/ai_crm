import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiModelsView } from './ai-models-view';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      ai: {
        ...original.api.ai,
        getSettings: () => getSettings(),
        updateSettings: (payload: unknown) => updateSettings(payload),
        listConfigs: () =>
          Promise.resolve([
            { id: 'c1', provider: 'OPENAI', isEnabled: true, isDefault: true },
            { id: 'c2', provider: 'ANTHROPIC', isEnabled: true, isDefault: false },
          ]),
        listModels: () => Promise.resolve([{ id: 'gpt-4o', name: 'GPT-4o' }]),
      },
    },
  };
});

const renderView = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiModelsView />
    </QueryClientProvider>,
  );

describe('AiModelsView', () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    updateSettings.mockResolvedValue({});
  });

  it("starts from the model the provider was set up with when no default is saved", async () => {
    getSettings.mockResolvedValue({
      defaultModel: null,
      effectiveDefaultModel: 'gpt-4o-mini',
      featureModels: {},
    });
    renderView();
    expect(await screen.findByLabelText('Default model')).toHaveValue('gpt-4o-mini');
  });

  it('saves the default and only the features given their own model', async () => {
    getSettings.mockResolvedValue({
      defaultModel: 'gpt-4o',
      effectiveDefaultModel: 'gpt-4o',
      featureModels: { receipt_scan: { provider: 'ANTHROPIC', model: 'claude-haiku' } },
    });
    renderView();
    const defaultModel = await screen.findByLabelText('Default model');
    fireEvent.change(defaultModel, { target: { value: 'gpt-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save models' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        defaultModel: 'gpt-5',
        featureModels: { receipt_scan: { provider: 'ANTHROPIC', model: 'claude-haiku' } },
      }),
    );
  });
});
