'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { aiProviderConfigSchema } from '@saas/shared';
import { api, queryKeys, type AiConfigDto } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/utils';

interface AiProviderConfigModalProps {
  open: boolean;
  onClose: () => void;
  config: AiConfigDto | null;
}

const PROVIDER_TITLES: Record<AiConfigDto['provider'], string> = {
  OPENAI: 'OpenAI Configuration',
  ANTHROPIC: 'Anthropic Configuration',
  OPENROUTER: 'OpenRouter Configuration',
};

const MODEL_PLACEHOLDERS: Record<AiConfigDto['provider'], string> = {
  OPENAI: 'gpt-4o',
  ANTHROPIC: 'claude-sonnet-5',
  OPENROUTER: 'meta-llama/llama-3.1-70b-instruct',
};

export function AiProviderConfigModal({ open, onClose, config }: AiProviderConfigModalProps) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<{ apiKey?: string; model?: string }>({});

  const provider = config?.provider ?? 'OPENAI';

  useEffect(() => {
    if (config?.credentials) {
      setFormData(config.credentials);
    } else {
      setFormData({});
    }
    setErrors({});
  }, [config, open]);

  const updateField = (key: 'apiKey' | 'model', value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    setErrors({});
    const result = aiProviderConfigSchema.safeParse(formData);
    if (!result.success) {
      const formattedErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const fieldName = issue.path[0] as string;
        if (fieldName && !formattedErrors[fieldName]) {
          formattedErrors[fieldName] = issue.message;
        }
      }
      setErrors(formattedErrors);
      return false;
    }
    return true;
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.ai.saveConfig(provider, {
        isEnabled: config?.isEnabled ?? true,
        credentials: formData,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiConfigs });
      toast.success('AI provider configuration saved successfully');
      onClose();
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not save AI provider configuration',
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      saveMutation.mutate();
    }
  };

  if (!config) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={PROVIDER_TITLES[provider]}
      description="Configure API credentials and the default model for this AI provider."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button loading={saveMutation.isPending} onClick={handleSubmit}>
            Save Configuration
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <SecretInput
          label="API Key"
          placeholder="sk-..."
          value={formData.apiKey || ''}
          error={errors.apiKey}
          onChange={(val) => updateField('apiKey', val)}
          required
        />
        <Input
          label="Model"
          placeholder={MODEL_PLACEHOLDERS[provider]}
          value={formData.model || ''}
          error={errors.model}
          onChange={(e) => updateField('model', e.target.value)}
          hint={
            provider === 'OPENROUTER'
              ? 'Any model id OpenRouter proxies, e.g. meta-llama/llama-3.1-70b-instruct.'
              : undefined
          }
          required
        />
      </form>
    </Dialog>
  );
}

function SecretInput({
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  error?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className={cn(
            'w-full rounded-lg border bg-surface px-3 py-2 pr-10 text-sm text-ink placeholder:text-ink-subtle transition-colors',
            error ? 'border-danger' : 'border-border hover:border-border-strong',
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink p-1 rounded-md"
          aria-label={show ? 'Hide secret' : 'Show secret'}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
