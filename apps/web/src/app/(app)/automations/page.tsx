'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import type { AutomationTriggerType, AutomationWorkflowDto } from '@saas/shared';
import {
  useAutomations,
  useCreateAutomationWorkflow,
  useDeleteAutomationWorkflow,
} from '@/hooks/use-automations';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';

interface Template {
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  label: string;
  blurb: string;
  icon: React.ReactNode;
}

const TEMPLATES: Template[] = [
  {
    name: 'Quote Approval to Invoice Flow',
    description:
      'Pause on Quote creation for manager approval; generate Invoice on approval.',
    triggerType: 'CRM_EVENT',
    label: 'CRM event',
    blurb: 'Assigns quotes, checks margin, waits for approval, then issues the invoice.',
    icon: <CheckCircle2 className="size-4" />,
  },
  {
    name: 'Daily AI CFO Cashflow Health Check',
    description:
      'Runs daily at 8am: fetches burn rate and emails executive cash summary.',
    triggerType: 'SCHEDULE',
    label: 'Scheduled',
    blurb: 'Reads receivables and runway each morning and sends the owner a summary.',
    icon: <Sparkles className="size-4" />,
  },
  {
    name: 'Inbound Webhook to Lead Enrichment',
    description: 'Captures external website leads via webhook and creates CRM contacts.',
    triggerType: 'WEBHOOK',
    label: 'Webhook',
    blurb: 'Takes a JSON payload, enriches the company details, and alerts the team.',
    icon: <Webhook className="size-4" />,
  },
];

const TRIGGER_FILTERS = ['ALL', 'WEBHOOK', 'SCHEDULE', 'CRM_EVENT', 'MANUAL'] as const;

const STATUS_TONE = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  DRAFT: 'neutral',
} as const;

export default function AutomationsListPage() {
  const router = useRouter();
  const { data: workflows = [], isLoading } = useAutomations();
  const deleteMutation = useDeleteAutomationWorkflow();
  const createMutation = useCreateAutomationWorkflow();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [pendingDelete, setPendingDelete] = useState<AutomationWorkflowDto | null>(null);

  const query = searchQuery.trim().toLowerCase();
  const filteredWorkflows = workflows.filter((wf) => {
    const matchesSearch =
      !query ||
      wf.name.toLowerCase().includes(query) ||
      (wf.description ?? '').toLowerCase().includes(query);
    return matchesSearch && (filterType === 'ALL' || wf.triggerType === filterType);
  });

  const createFromTemplate = async (template: Template) => {
    try {
      const created = await createMutation.mutateAsync({
        name: template.name,
        description: template.description,
        triggerType: template.triggerType,
        nodes: [
          {
            id: 'trigger-1',
            type: template.triggerType === 'WEBHOOK' ? 'webhookTrigger' : 'crmEventTrigger',
            position: { x: 100, y: 150 },
            data: { label: template.name, config: {} },
          },
        ],
        edges: [],
      });
      toast.success('Created new automation workflow');
      router.push(`/automations/${created.id}`);
    } catch {
      toast.error('Failed to create workflow');
    }
  };

  return (
    <div data-testid="automations-list-page" className="space-y-6">
      <PageHeader
        title="Automations"
        description="Event-driven workflows, scheduled routines and approval pipelines."
        actions={
          <Link href="/automations/new" data-testid="create-automation-btn">
            <Button>
              <Plus className="size-4" />
              New automation
            </Button>
          </Link>
        }
      />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          Start from a template
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {TEMPLATES.map((template) => (
            <Card
              key={template.name}
              role="button"
              tabIndex={0}
              aria-label={`Create ${template.name}`}
              onClick={() => void createFromTemplate(template)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void createFromTemplate(template);
                }
              }}
              className="group cursor-pointer transition-colors hover:border-brand/40"
            >
              <CardBody className="space-y-2 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-ink">
                    {template.icon}
                  </span>
                  <Badge tone="neutral">{template.label}</Badge>
                </div>
                <h3 className="text-sm font-semibold text-ink">{template.name}</h3>
                <p className="text-sm text-ink-muted">{template.blurb}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            data-testid="search-automations-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search automations…"
            aria-label="Search automations"
            className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {TRIGGER_FILTERS.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilterType(type)}
              aria-pressed={filterType === type}
              className={clsx(
                'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                filterType === type
                  ? 'bg-brand-soft font-semibold text-ink'
                  : 'border border-border bg-surface text-ink-muted hover:bg-surface-muted',
              )}
            >
              {type === 'ALL' ? 'All triggers' : type.replace('_', ' ').toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Zap className="size-8" />}
            title="No automations found"
            description={
              searchQuery
                ? `Nothing matches "${searchQuery}".`
                : 'Create your first workflow, or start from one of the templates above.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredWorkflows.map((wf) => (
            <Card key={wf.id} className="group transition-colors hover:border-brand/40">
              <CardBody className="flex h-full flex-col justify-between gap-4 px-5 py-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="neutral">{wf.triggerType.replace('_', ' ').toLowerCase()}</Badge>
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[wf.status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                        {wf.status.toLowerCase()}
                      </Badge>
                      <button
                        type="button"
                        aria-label={`Delete ${wf.name}`}
                        onClick={() => setPendingDelete(wf)}
                        className="rounded-md p-1 text-ink-subtle opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <Link
                      href={`/automations/${wf.id}`}
                      data-testid={`workflow-card-${wf.id}`}
                      className="text-sm font-semibold text-ink hover:underline"
                    >
                      {wf.name}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                      {wf.description || 'No description provided.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/40 pt-3 text-xs text-ink-subtle">
                  <span>{wf.nodes?.length ?? 0} nodes</span>
                  <Link
                    href={`/automations/${wf.id}`}
                    className="flex items-center gap-1 font-medium text-ink-muted transition-colors hover:text-ink"
                  >
                    Open <ArrowRight className="size-3" />
                  </Link>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Delete automation"
        description={`${pendingDelete?.name ?? ''} will be removed.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={async () => {
                if (!pendingDelete) return;
                try {
                  await deleteMutation.mutateAsync(pendingDelete.id);
                  toast.success('Automation deleted');
                } catch {
                  toast.error('Failed to delete automation');
                }
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Runs already recorded against this workflow keep their history. Anything waiting on
          an approval step in it will never resume.
        </p>
      </Dialog>
    </div>
  );
}
