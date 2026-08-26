'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Zap, Webhook, Calendar, Sparkles, Database, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateAutomationWorkflow } from '@/hooks/use-automations';
import type { AutomationTriggerType } from '@saas/shared';

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
      const initialNode = {
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
        nodes: [initialNode as any],
        edges: [],
      });

      toast.success('Automation workflow created');
      router.push(`/automations/${created.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create automation');
      setIsSubmitting(false);
    }
  };

  return (
    <div data-testid="new-automation-page" className="p-8 max-w-3xl mx-auto space-y-6 select-text">
      <Link
        href="/automations"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Automations
      </Link>

      <div className="space-y-1">
        <h1 className="text-xl font-bold text-stone-900">Create New Automation</h1>
        <p className="text-xs text-stone-500">Configure your starting trigger and enter the visual canvas.</p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 rounded-2xl bg-white border border-stone-200 shadow-sm space-y-6">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-stone-800">Automation Name *</label>
          <input
            type="text"
            data-testid="new-workflow-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Inbound Lead Webhook to Quote Generator"
            className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-stone-800">Description (Optional)</label>
          <textarea
            rows={2}
            data-testid="new-workflow-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What business process or automation does this workflow handle?"
            className="w-full rounded-xl border border-stone-200 p-3 text-xs text-stone-900 focus:border-amber-500 focus:outline-none resize-none"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-stone-800">Starting Trigger Type</label>
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
                    ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/10'
                    : 'border-stone-200 hover:border-stone-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <t.icon className={`h-4 w-4 ${triggerType === t.type ? 'text-amber-700' : 'text-stone-500'}`} />
                  {triggerType === t.type && <Check className="h-3.5 w-3.5 text-amber-700" />}
                </div>
                <h4 className="text-xs font-bold text-stone-900">{t.title}</h4>
                <p className="text-[11px] text-stone-500 leading-relaxed">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-stone-100 flex items-center justify-end gap-2">
          <Link
            href="/automations"
            className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-100 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="submit-create-automation-btn"
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700 active:scale-95 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {isSubmitting ? 'Creating...' : 'Create & Open Studio'}
          </button>
        </div>
      </form>
    </div>
  );
}
