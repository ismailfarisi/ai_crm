'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createAiAgentSchema, type AiAgentDto } from '@saas/shared';
import { useCreateAiAgent, useUpdateAiAgent } from '@/hooks/use-ai-agents';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';

interface AiAgentFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  agent?: AiAgentDto | null;
}

type FormValues = z.input<typeof createAiAgentSchema>;
type SubmitValues = z.output<typeof createAiAgentSchema>;

const INTENT_OPTIONS = [
  { value: 'GENERAL_QUESTION', label: 'General question' },
  { value: 'QUOTATION_REQUEST', label: 'Quotation request' },
  { value: 'ORDER_STATUS', label: 'Order status' },
  { value: 'PRICING_QUESTION', label: 'Pricing question' },
  { value: 'COMPLAINT', label: 'Complaint' },
  { value: 'SUPPORT_REQUEST', label: 'Support request' },
  { value: 'SCHEDULING', label: 'Scheduling' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'OTHER', label: 'Other' },
];

const ACTION_TYPE_OPTIONS = [
  { value: 'AUTO_ACK', label: 'Send a canned acknowledgement' },
  { value: 'CREATE_DRAFT_QUOTE', label: 'Draft a quote (awaits approval)' },
];

const PROVIDER_OPTIONS = [
  { value: 'EMAIL_SMTP', label: 'Email (SMTP)' },
  { value: 'EMAIL_RESEND', label: 'Email (Resend)' },
  { value: 'WHATSAPP_META', label: 'WhatsApp' },
  { value: 'TELEGRAM', label: 'Telegram' },
];

const EMPTY: FormValues = {
  name: '',
  intent: 'ORDER_STATUS',
  actionType: 'AUTO_ACK',
  config: {},
  confidenceThreshold: 0.75,
  eligibleProviders: ['EMAIL_SMTP', 'EMAIL_RESEND'],
  isEnabled: true,
  model: '',
};

export function AiAgentFormDialog({ open, onClose, agent }: AiAgentFormDialogProps) {
  const isEditing = Boolean(agent);

  const create = useCreateAiAgent();
  const update = useUpdateAiAgent();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createAiAgentSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      agent
        ? {
            name: agent.name,
            intent: agent.intent,
            actionType: agent.actionType,
            config: agent.config ?? {},
            confidenceThreshold: agent.confidenceThreshold,
            eligibleProviders: agent.eligibleProviders as FormValues['eligibleProviders'],
            isEnabled: agent.isEnabled,
            // Blank in the form means "use the provider's model"; the schema
            // turns it back into null on the way out.
            model: agent.model ?? '',
          }
        : EMPTY,
    );
  }, [open, agent, reset]);

  const eligibleProviders = watch('eligibleProviders') ?? [];

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (agent) {
        await update.mutateAsync({ id: agent.id, input: values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof FormValues, { message });
        }
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={isEditing ? 'Edit AI agent' : 'New AI agent'}
      description="Which intent triggers what action — no deploy needed to add or tune one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="ai-agent-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Create agent'}
          </Button>
        </>
      }
    >
      <form id="ai-agent-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label="Name"
          required
          placeholder="Order status auto-ack"
          error={errors.name?.message}
          {...register('name')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Intent"
            required
            options={INTENT_OPTIONS}
            error={errors.intent?.message}
            {...register('intent')}
          />
          <Select
            label="Action"
            required
            options={ACTION_TYPE_OPTIONS}
            error={errors.actionType?.message}
            {...register('actionType')}
          />
        </div>

        <Textarea
          label="Acknowledgement template"
          hint="Sent to the customer as-is — never the AI's freeform draft reply."
          placeholder="Thanks for reaching out. We are looking into this and will follow up shortly."
          error={undefined}
          {...register('config.template' as 'config')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Confidence threshold"
            type="number"
            min={0}
            max={1}
            step={0.05}
            hint="Only dispatches when the classifier is at least this confident (0-1)."
            error={errors.confidenceThreshold?.message}
            {...register('confidenceThreshold', { valueAsNumber: true })}
          />

          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-brand)]"
              {...register('isEnabled')}
            />
            Enabled
          </label>
        </div>

        <Input
          label="Model"
          placeholder="Leave blank to use the provider's model"
          hint="Only set this to run this agent on a different model from the rest of the organisation. Changing the provider's model moves everything left blank."
          error={errors.model?.message}
          {...register('model')}
        />

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Eligible channels</legend>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_OPTIONS.map((provider) => (
              <label
                key={provider.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-brand)]"
                  value={provider.value}
                  checked={eligibleProviders.includes(provider.value as never)}
                  {...register('eligibleProviders')}
                />
                {provider.label}
              </label>
            ))}
          </div>
          {errors.eligibleProviders?.message && (
            <p className="mt-1 text-xs text-danger">{errors.eligibleProviders.message}</p>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}
