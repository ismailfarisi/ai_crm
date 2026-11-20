'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AI_MODEL_FEATURES, type AiSettingsDto } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { PageHeader, Skeleton } from '@/components/ui/primitives';
import { ModelPicker, type ModelChoice } from './model-picker';

const EMPTY: ModelChoice = { provider: '', model: '' };

/**
 * Which model runs what. A provider only holds a key; the default model here
 * is used by everything that does not name its own.
 */
export function AiModelsView() {
  const queryClient = useQueryClient();
  const { data: settings, isPending } = useQuery({
    queryKey: queryKeys.aiSettings,
    queryFn: api.ai.getSettings,
  });

  const [defaultModel, setDefaultModel] = useState('');
  const [features, setFeatures] = useState<Record<string, ModelChoice>>({});

  // Adjusted during render, same pattern as ai-budget-view.tsx.
  const [lastSynced, setLastSynced] = useState<AiSettingsDto | null>(null);
  if (settings && settings !== lastSynced) {
    setLastSynced(settings);
    setDefaultModel(settings.defaultModel ?? settings.effectiveDefaultModel ?? '');
    setFeatures(
      Object.fromEntries(
        Object.entries(settings.featureModels).map(([key, choice]) => [
          key,
          { provider: choice.provider ?? '', model: choice.model },
        ]),
      ),
    );
  }

  const save = useMutation({
    mutationFn: () =>
      api.ai.updateSettings({
        defaultModel: defaultModel.trim() || null,
        featureModels: Object.fromEntries(
          Object.entries(features)
            .filter(([, choice]) => choice.model.trim())
            .map(([key, choice]) => [
              key,
              {
                provider: (choice.provider || null) as 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER' | null,
                model: choice.model.trim(),
              },
            ]),
        ),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiSettings });
      toast.success('Models saved');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save models'),
  });

  const header = (
    <PageHeader
      title="Models"
      description="Pick the model the AI runs on. Everything uses the default unless you choose a different one for it."
    />
  );

  if (isPending) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const fallback = defaultModel.trim() || 'the default model';

  return (
    <div className="space-y-6">
      {header}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-5 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
      >
        <ModelPicker
          withProvider={false}
          modelLabel="Default model"
          value={{ provider: '', model: defaultModel }}
          onChange={(choice) => setDefaultModel(choice.model)}
          placeholder="Choose a model"
          hint="Runs on the default provider. Type to search the models your key can use."
        />

        <div className="space-y-4 border-t border-border/40 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Use a different model for</h3>
            <p className="text-xs text-ink-subtle">
              Leave a model blank to use {fallback}.
            </p>
          </div>
          {AI_MODEL_FEATURES.map((feature) => (
            <div key={feature.key} className="space-y-2">
              <div>
                <p className="text-sm font-medium text-ink">{feature.label}</p>
                <p className="text-xs text-ink-subtle">{feature.description}</p>
              </div>
              <ModelPicker
                value={features[feature.key] ?? EMPTY}
                onChange={(choice) => setFeatures((prev) => ({ ...prev, [feature.key]: choice }))}
                placeholder={`Default (${fallback})`}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Save models
          </Button>
        </div>
      </form>
    </div>
  );
}
