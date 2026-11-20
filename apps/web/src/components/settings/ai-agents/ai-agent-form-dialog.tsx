'use client';

import { useEffect, useState } from 'react';
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
  { value: 'AUTO_ACK', label: 'Send a set reply' },
  { value: 'CREATE_DRAFT_QUOTE', label: 'Create a draft quote for staff to approve' },
];

const PROVIDER_OPTIONS = [
  { value: 'EMAIL_SMTP', label: 'Email (SMTP)' },
  { value: 'EMAIL_RESEND', label: 'Email (Resend)' },
  { value: 'WHATSAPP_META', label: 'WhatsApp' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'SLACK', label: 'Slack' },
];

const EMPTY: FormValues = {
  name: '',
  intent: 'ORDER_STATUS',
  actionType: 'AUTO_ACK',
  config: {},
  confidenceThreshold: 0.75,
  eligibleProviders: ['EMAIL_SMTP', 'EMAIL_RESEND'],
  isEnabled: true,
};

function getFirstErrorMessage(errors: Record<string, any>): string {
  for (const key of Object.keys(errors)) {
    const err = errors[key];
    if (!err) continue;
    if (typeof err?.message === 'string' && err.message.length > 0) {
      return err.message;
    }
    if (typeof err === 'object') {
      const nested = getFirstErrorMessage(err);
      if (nested) return nested;
    }
  }
  return 'Please check the form for errors.';
}

export function AiAgentFormDialog({ open, onClose, agent }: AiAgentFormDialogProps) {
  const isEditing = Boolean(agent);
  const [rootError, setRootError] = useState<string | null>(null);

  const create = useCreateAiAgent();
  const update = useUpdateAiAgent();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createAiAgentSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    register('eligibleProviders');
  }, [register]);

  useEffect(() => {
    if (!open) {
      setRootError(null);
      return;
    }

    setRootError(null);
    reset(
      agent
        ? {
            name: agent.name,
            intent: agent.intent,
            actionType: agent.actionType,
            config: agent.config ?? {},
            confidenceThreshold: agent.confidenceThreshold,
            eligibleProviders: (agent.eligibleProviders ?? []) as FormValues['eligibleProviders'],
            isEnabled: agent.isEnabled,
          }
        : EMPTY,
    );
  }, [open, agent, reset]);

  const eligibleProviders = watch('eligibleProviders') ?? [];
  const sendsOnlyReply = watch('actionType') === 'AUTO_ACK';

  const toggleProvider = (val: string) => {
    const current = watch('eligibleProviders') ?? [];
    const next = current.includes(val as never)
      ? current.filter((p) => p !== val)
      : [...current, val];
    setValue('eligibleProviders', next as FormValues['eligibleProviders'], {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const onSubmit = handleSubmit(
    async (values) => {
      setRootError(null);
      try {
        if (agent) {
          await update.mutateAsync({ id: agent.id, input: values });
        } else {
          await create.mutateAsync(values);
        }
        onClose();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
            for (const [field, message] of Object.entries(error.fieldErrors)) {
              setError(field as keyof FormValues, { message });
            }
          } else {
            setRootError(error.message);
          }
        } else if (error instanceof Error) {
          setRootError(error.message);
        } else {
          setRootError('An unexpected error occurred while saving.');
        }
      }
    },
    (formErrors) => {
      setRootError(getFirstErrorMessage(formErrors));
    },
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={isEditing ? 'Edit rule' : 'New rule'}
      description="When a customer message is about one thing, do one thing. Only one rule per kind of request."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            type="submit"
            form="ai-agent-form"
            loading={isSubmitting || update.isPending || create.isPending}
            onClick={onSubmit}
          >
            {isEditing ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form id="ai-agent-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        {rootError && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs font-medium text-danger">
            {rootError}
          </div>
        )}
        <Input
          label="Name"
          required
          placeholder="Order status reply"
          error={errors.name?.message}
          {...register('name')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="When the customer&apos;s message is"
            required
            options={INTENT_OPTIONS}
            error={errors.intent?.message}
            {...register('intent')}
          />
          <Select
            label="Do this"
            required
            options={ACTION_TYPE_OPTIONS}
            error={errors.actionType?.message}
            {...register('actionType')}
          />
        </div>

        <Textarea
          label={sendsOnlyReply ? 'Reply to send' : 'Reply to send (optional)'}
          hint={
            sendsOnlyReply
              ? 'Sent to the customer exactly as written. The AI does not write its own reply.'
              : 'Sent to the customer after the draft quote is created, exactly as written. Leave blank to send nothing.'
          }
          placeholder="Thanks for reaching out. We are looking into this and will follow up shortly."
          error={undefined}
          {...register('config.template' as 'config')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="How sure the AI must be (0 to 1)"
            type="number"
            min={0}
            max={1}
            step={0.05}
            hint="0.75 means the rule only runs when the AI is at least 75% sure what the customer wants. Below that, it asks a question or hands over to a person."
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

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Channels this rule covers</legend>
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
                  onChange={() => toggleProvider(provider.value)}
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
