'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/primitives';
import { ArrowLeft, Webhook, Calendar, Zap, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateAutomationWorkflow } from '@/hooks/use-automations';
import type { AutomationNode, AutomationNodeType, AutomationTriggerType } from '@saas/shared';
import { CRM_EVENTS, findCrmEvent } from '@/components/automations/crm-events';
import { STEP_WORDING } from '@/components/automations/step-wording';

const TRIGGER_NODE: Record<AutomationTriggerType, AutomationNodeType> = {
  CRM_EVENT: 'crmEventTrigger',
  SCHEDULE: 'scheduleTrigger',
  WEBHOOK: 'webhookTrigger',
  MANUAL: 'manualTrigger',
};

/** Most automations in a workshop start from something happening in Kerf, so that comes first. */
const START_OPTIONS = [
  { type: 'CRM_EVENT' as const, icon: Zap },
  { type: 'SCHEDULE' as const, icon: Calendar },
  { type: 'WEBHOOK' as const, icon: Webhook },
];

export default function NewAutomationPage() {
  const router = useRouter();
  const createMutation = useCreateAutomationWorkflow();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('CRM_EVENT');
  // Chosen here so the canvas opens with the first step already filled in.
  const [event, setEvent] = useState<string>('quote.accepted');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Give the automation a name first');
      return;
    }

    setIsSubmitting(true);
    try {
      // The canvas opens with the step that starts the automation already on it.
      const nodeType = TRIGGER_NODE[triggerType];
      const initialNode: AutomationNode = {
        id: 'trigger-1',
        type: nodeType,
        position: { x: 150, y: 200 },
        data: {
          label: STEP_WORDING[nodeType].label,
          config: triggerType === 'CRM_EVENT' ? { event } : {},
        },
      };

      const created = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        triggerType,
        nodes: [initialNode],
        edges: [],
      });

      toast.success('Automation created. Now add what should happen.');
      router.push(`/automations/${created.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not create the automation');
      setIsSubmitting(false);
    }
  };

  return (
    <div data-testid="new-automation-page" className="space-y-6">
      <Link
        href="/automations"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Back to automations
      </Link>

      <PageHeader
        title="New automation"
        description="Name it and choose what starts it. You add the steps on the next screen."
      />

      <form onSubmit={handleSubmit}>
        <Card>
          <CardBody className="space-y-6">
        <div className="space-y-1">
          <label htmlFor="new-automation-name" className="text-sm font-medium text-ink">Name</label>
          <input
            type="text"
            id="new-automation-name"
            data-testid="new-workflow-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tell the team when a quote is accepted"
            className="w-full rounded-xl border border-border px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
            required
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="new-automation-desc" className="text-sm font-medium text-ink">Note (optional)</label>
          <textarea
            rows={2}
            id="new-automation-desc"
            data-testid="new-workflow-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is it for? e.g. So production knows to order materials"
            className="w-full rounded-xl border border-border p-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none resize-none"
          />
        </div>

        <div className="space-y-2">
          <span id="new-automation-start" className="text-sm font-medium text-ink">What starts it</span>
          <div role="radiogroup" aria-labelledby="new-automation-start" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {START_OPTIONS.map((t) => {
              const wording = STEP_WORDING[TRIGGER_NODE[t.type]];
              const chosen = triggerType === t.type;
              return (
                <button
                  key={t.type}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  data-testid={`trigger-option-${t.type}`}
                  onClick={() => setTriggerType(t.type)}
                  className={`p-3.5 rounded-xl border text-left transition cursor-pointer space-y-1.5 ${
                    chosen ? 'border-brand bg-brand-soft/60 ring-2 ring-brand/10' : 'border-border hover:border-border-strong'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <t.icon aria-hidden className={`h-4 w-4 ${chosen ? 'text-ink' : 'text-ink-muted'}`} />
                    {chosen && <Check aria-hidden className="h-3.5 w-3.5 text-ink" />}
                  </span>
                  <span className="block text-sm font-semibold text-ink">{wording.label}</span>
                  <span className="block text-sm leading-relaxed text-ink-muted">{wording.description}</span>
                </button>
              );
            })}
          </div>

          {triggerType === 'CRM_EVENT' && (
            <div className="space-y-1 pt-2">
              <label htmlFor="new-automation-event" className="text-sm font-medium text-ink">
                Start when
              </label>
              <select
                id="new-automation-event"
                data-testid="new-workflow-event-select"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none"
              >
                {CRM_EVENTS.map((ev) => (
                  <option key={ev.value} value={ev.value}>
                    {ev.label}
                  </option>
                ))}
              </select>
              <p className="text-sm text-ink-muted">
                Runs every time {findCrmEvent(event)?.when ?? 'this happens'}. You can change it later.
              </p>
            </div>
          )}
        </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-4">
              <Link href="/automations">
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                loading={isSubmitting}
                data-testid="submit-create-automation-btn"
              >
                <Plus className="size-4" />
                Create and add steps
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
