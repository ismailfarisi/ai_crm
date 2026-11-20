'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  createChannelAgentSchema,
  type ChannelAgentDto,
  type ChannelAgentKind,
} from '@saas/shared';
import {
  useChannelAgentTools,
  useCreateChannelAgent,
  useUpdateChannelAgent,
} from '@/hooks/use-channel-agents';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { ModelPicker } from '@/components/settings/ai-models/model-picker';
import {
  AGENT_KIND_LABELS,
  CUSTOMER_LOOKUP_TOOL_NAMES,
  agentChannelOptions,
  toolLabel,
} from './agent-labels';

interface AgentFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  agent?: ChannelAgentDto | null;
}

type FormValues = z.input<typeof createChannelAgentSchema>;
type SubmitValues = z.output<typeof createChannelAgentSchema>;

const FORM_ID = 'channel-agent-form';

const EMPTY: FormValues = {
  name: '',
  description: '',
  instructions: '',
  kind: 'CUSTOMER',
  provider: null,
  model: null,
  skills: [],
  channels: ['WHATSAPP_META'],
  isEnabled: true,
};

const KIND_HELP: Record<ChannelAgentKind, string> = {
  CUSTOMER:
    'It writes its own replies to customers, following the instructions below. It cannot look up prices or stock, and it only answers about a customer’s own orders and quotes if you tick those tools. It passes the conversation to a person when it cannot help.',
  STAFF:
    'It takes commands and files from staff who have linked their own chat. Each person can only use the tools their role allows, and anything that changes a record waits for their YES.',
};

export function AgentFormDialog({ open, onClose, agent }: AgentFormDialogProps) {
  const create = useCreateChannelAgent();
  const update = useUpdateChannelAgent();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={agent ? `Edit ${agent.name}` : 'New agent'}
      description="An agent has its own job, instructions, model and tools. Messages go to the agent whose job fits."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={create.isPending || update.isPending}>
            {agent ? 'Save changes' : 'Create agent'}
          </Button>
        </>
      }
    >
      {open && (
        // Keyed so the form starts from this agent's values each time it opens.
        <AgentForm
          key={agent?.id ?? 'new'}
          agent={agent ?? null}
          onSave={async (values) => {
            if (agent) await update.mutateAsync({ id: agent.id, input: values });
            else await create.mutateAsync(values);
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}

function AgentForm({
  agent,
  onSave,
}: {
  agent: ChannelAgentDto | null;
  onSave: (values: SubmitValues) => Promise<void>;
}) {
  const [rootError, setRootError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createChannelAgentSchema),
    defaultValues: agent
      ? {
          name: agent.name,
          description: agent.description,
          instructions: agent.instructions,
          kind: agent.kind,
          provider: agent.provider as FormValues['provider'],
          model: agent.model,
          skills: agent.skills,
          channels: agent.channels as FormValues['channels'],
          isEnabled: agent.isEnabled,
        }
      : EMPTY,
  });

  const kind = watch('kind');
  const skills = watch('skills') ?? [];
  const channels = watch('channels') ?? [];
  const { data: tools, isPending: toolsPending } = useChannelAgentTools(kind);
  const channelOptions = agentChannelOptions(kind);

  const toggle = (field: 'skills' | 'channels', value: string) => {
    const current: string[] = watch(field) ?? [];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    setValue(field, next as never, { shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    setRootError(null);
    try {
      await onSave(values);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors && Object.keys(error.fieldErrors).length) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof FormValues, { message });
        }
      } else {
        setRootError(error instanceof Error ? error.message : 'Could not save the agent.');
      }
    }
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4" noValidate>
      {rootError && (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs font-medium text-danger"
        >
          {rootError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          required
          placeholder="Sales"
          error={errors.name?.message}
          {...register('name')}
        />
        <Select
          label="Who it works with"
          disabled={!!agent}
          hint={agent ? 'This cannot be changed after the agent is created.' : undefined}
          options={Object.entries(AGENT_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          {...register('kind', {
            onChange: () => {
              // The two kinds have different tools and channels.
              setValue('skills', []);
              setValue('channels', []);
            },
          })}
        />
      </div>
      <p className="-mt-2 text-xs text-ink-muted">{KIND_HELP[kind]}</p>

      <Input
        label="What it handles"
        required
        placeholder="New enquiries and requests for a quote"
        hint="One line. When you have more than one agent, this is how a message finds the right one."
        error={errors.description?.message}
        {...register('description')}
      />

      <Textarea
        label="Instructions"
        required
        className="min-h-32"
        placeholder={
          kind === 'CUSTOMER'
            ? 'Greet the customer by name. Ask for size, quantity, material and deadline before drafting a quote. We are open Sunday to Thursday, 8am to 6pm.'
            : 'Fuel and parking go under Vehicle costs. Always ask which job a purchase order is for.'
        }
        hint="How it should behave and what it should know, in your own words."
        error={errors.instructions?.message}
        {...register('instructions')}
      />

      <ModelPicker
        value={{ provider: watch('provider') ?? '', model: watch('model') ?? '' }}
        onChange={(choice) => {
          setValue('provider', (choice.provider || null) as FormValues['provider'], {
            shouldDirty: true,
          });
          setValue('model', choice.model || null, { shouldDirty: true });
        }}
        placeholder="Default model"
        hint="Leave blank to use the model chosen for Agents under “2. Choose models”."
      />

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Tools it may use</legend>
        <p className="mb-2 text-xs text-ink-muted">
          {kind === 'CUSTOMER'
            ? 'Every customer agent can also pass the conversation to another agent or to a person.'
            : 'A staff member still needs the matching permission to use a tool.'}
        </p>
        {toolsPending ? (
          <p className="text-xs text-ink-muted">Loading tools…</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {(tools ?? []).map((tool) => (
              <label
                key={tool.name}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-brand)]"
                  checked={skills.includes(tool.name)}
                  onChange={() => toggle('skills', tool.name)}
                />
                <span>
                  {toolLabel(tool.name)}
                  <span className="block text-xs text-ink-muted">{tool.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {kind === 'CUSTOMER' && skills.some((name) => CUSTOMER_LOOKUP_TOOL_NAMES.includes(name)) && (
          <p
            role="note"
            className="mt-2 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-xs text-ink-muted"
          >
            <span className="font-medium text-ink">Who gets an answer: </span>
            only a sender Kerf can match to one customer. That means their WhatsApp number or email
            is on exactly one customer record, or someone linked the sender to the customer in the
            Inbox. Everyone else is told nothing about any order or quote and is passed to a person.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Channels it answers on</legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {channelOptions.map((channel) => (
            <label
              key={channel.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-brand)]"
                checked={channels.includes(channel.value as never)}
                onChange={() => toggle('channels', channel.value)}
              />
              {channel.label}
            </label>
          ))}
        </div>
        {channels.length === 0 && (
          <p className="mt-1 text-xs text-ink-muted">
            With no channel ticked, this agent never receives a message.
          </p>
        )}
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-brand)]"
          {...register('isEnabled')}
        />
        Enabled
      </label>
    </form>
  );
}
