'use client';

import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys, type AiConfigDto } from '@/lib/api/endpoints';
import { Input, Select } from '@/components/ui/field';

export const AI_PROVIDER_LABELS: Record<AiConfigDto['provider'], string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  OPENROUTER: 'OpenRouter',
};

export interface ModelChoice {
  /** Empty string means the default provider. */
  provider: string;
  /** Empty string means the organisation's default model. */
  model: string;
}

interface ModelPickerProps {
  value: ModelChoice;
  onChange: (value: ModelChoice) => void;
  /** Hide the provider select where only the default provider applies. */
  withProvider?: boolean;
  modelLabel?: string;
  /** Shown in the empty model box, e.g. the default it falls back to. */
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Provider and model for one agent or feature. The model box suggests what the
 * provider's key can use but accepts any id, so a model the list misses — or a
 * provider that cannot be reached — never blocks saving.
 */
export function ModelPicker({
  value,
  onChange,
  withProvider = true,
  modelLabel = 'Model',
  placeholder,
  hint,
  disabled,
}: ModelPickerProps) {
  const listId = useId();
  const { data: configs } = useQuery({
    queryKey: queryKeys.aiConfigs,
    queryFn: api.ai.listConfigs,
  });
  const enabled = (configs ?? []).filter((c) => c.isEnabled && c.id);
  const listFrom =
    value.provider || enabled.find((c) => c.isDefault)?.provider || enabled[0]?.provider || '';

  const { data: models } = useQuery({
    queryKey: queryKeys.aiModels(listFrom),
    queryFn: () => api.ai.listModels(listFrom),
    enabled: !!listFrom,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return (
    <div
      className={
        withProvider ? 'grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]' : undefined
      }
    >
      {withProvider && (
        <Select
          label="Provider"
          value={value.provider}
          disabled={disabled}
          onChange={(e) => onChange({ provider: e.target.value, model: '' })}
          options={[
            { value: '', label: 'Default provider' },
            ...enabled.map((c) => ({ value: c.provider, label: AI_PROVIDER_LABELS[c.provider] })),
          ]}
        />
      )}
      <div>
        <Input
          label={modelLabel}
          list={listId}
          value={value.model}
          disabled={disabled}
          placeholder={placeholder}
          hint={hint}
          autoComplete="off"
          onChange={(e) => onChange({ ...value, model: e.target.value })}
        />
        <datalist id={listId}>
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
      </div>
    </div>
  );
}
