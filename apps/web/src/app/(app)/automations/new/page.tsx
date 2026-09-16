'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/primitives';
import { ArrowLeft, Webhook, Calendar, Database, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateAutomationWorkflow } from '@/hooks/use-automations';
import type { AutomationNode, AutomationTriggerType } from '@saas/shared';

export default function NewAutomationPage() {
  const router = useRouter();
  const createMutation = useCreateAutomationWorkflow();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('WEBHOOK');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Please enter a workflow name');
      return;
    }

    setIsSubmitting(true);
    try {
      // Create initial trigger node centered on canvas
      const initialNode: AutomationNode = {
        id: 'trigger-1',
        type:
          triggerType === 'WEBHOOK'
            ? 'webhookTrigger'
            : triggerType === 'SCHEDULE'
            ? 'scheduleTrigger'
            : triggerType === 'CRM_EVENT'
            ? 'crmEventTrigger'
            : 'manualTrigger',
        position: { x: 150, y: 200 },
        data: {
          label: `${triggerType === 'WEBHOOK' ? 'Inbound Webhook' : triggerType === 'SCHEDULE' ? 'Cron Schedule' : 'CRM Event'} Trigger`,
          config: {},
        },
      };

      const created = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        triggerType,
        nodes: [initialNode],
        edges: [],
      });

      toast.success('Automation workflow created');
      router.push(`/automations/${created.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create automation');
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
        description="Choose what starts it, then build the rest on the canvas."
      />

      <form onSubmit={handleSubmit}>
        <Card>
          <CardBody className="space-y-6">
        <div className="space-y-1">
          <label className="text-sm font-medium text-ink">Name</label>
          <input
            type="text"
            data-testid="new-workflow-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Inbound Lead Webhook to Quote Generator"
            className="w-full rounded-xl border border-border px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-ink">Description</label>
          <textarea
            rows={2}
            data-testid="new-workflow-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What business process or automation does this workflow handle?"
            className="w-full rounded-xl border border-border p-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none resize-none"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-ink">What starts it</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                type: 'WEBHOOK' as const,
                title: 'Webhook',
                desc: 'Listen for HTTP POST/GET events from external systems',
                icon: Webhook,
              },
              {
                type: 'CRM_EVENT' as const,
                title: 'CRM Event',
                desc: 'Trigger on Quote Created, Approved, or Contact updates',
                icon: Database,
              },
              {
                type: 'SCHEDULE' as const,
                title: 'Schedule (Cron)',
                desc: 'Run periodically (e.g. Daily at 8am for AI CFO reports)',
                icon: Calendar,
              },
            ].map((t) => (
              <div
                key={t.type}
                onClick={() => setTriggerType(t.type)}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer space-y-1.5 ${
                  triggerType === t.type
                    ? 'border-brand bg-brand-soft/60 ring-2 ring-brand/10'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <t.icon className={`h-4 w-4 ${triggerType === t.type ? 'text-ink' : 'text-ink-muted'}`} />
                  {triggerType === t.type && <Check className="h-3.5 w-3.5 text-ink" />}
                </div>
                <h4 className="text-sm font-semibold text-ink">{t.title}</h4>
                <p className="text-sm leading-relaxed text-ink-muted">{t.desc}</p>
              </div>
            ))}
          </div>
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
                Create and open the canvas
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
