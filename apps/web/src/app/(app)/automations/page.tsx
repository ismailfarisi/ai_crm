'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Hammer,
  MessageCircle,
  Palette,
  Sunrise,
  Plus,
  Search,
  ShieldCheck,
  BellRing,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { PERMISSIONS } from '@saas/shared';
import type { AutomationWorkflowDto } from '@saas/shared';
import {
  useAutomations,
  useAutomationSettings,
  useCreateAutomationWorkflow,
  useDeleteAutomationWorkflow,
} from '@/hooks/use-automations';
import {
  AUTOMATION_TEMPLATES,
  AUTOMATION_TEMPLATE_CATEGORIES,
  buildTemplateGraph,
  overdueRecipientNote,
  type AutomationTemplateCategory,
  type AutomationTemplateId,
} from '@/components/automations/templates';
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
import { useSession } from '@/lib/session-context';

const CATEGORY_ICONS: Record<AutomationTemplateCategory, React.ReactNode> = {
  Quotes: <CheckCircle2 className="size-4" />,
  Artwork: <Palette className="size-4" />,
  Production: <Hammer className="size-4" />,
  'Stock and purchasing': <Boxes className="size-4" />,
  Money: <BellRing className="size-4" />,
  Customers: <MessageCircle className="size-4" />,
  'Every day': <Sunrise className="size-4" />,
};

/** How many recipes show before "Show all". */
const RECIPES_SHOWN = 6;

const TRIGGER_FILTERS = ['ALL', 'WEBHOOK', 'SCHEDULE', 'CRM_EVENT', 'MANUAL'] as const;

const TRIGGER_LABELS: Record<string, string> = {
  WEBHOOK: 'Webhook',
  SCHEDULE: 'Schedule',
  CRM_EVENT: 'CRM event',
  MANUAL: 'Manual',
};

/** DRAFT → Draft, for labels that arrive as enum values. */
const sentenceCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

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
  const { session, can } = useSession();

  // Loading or failed settings count as off: drafts go to the team, never the customer.
  const { data: automationSettings } = useAutomationSettings();
  const aiEmailToCustomers = automationSettings?.aiEmailToCustomers === true;

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [pendingDelete, setPendingDelete] = useState<AutomationWorkflowDto | null>(null);
  const [recipeCategory, setRecipeCategory] = useState<AutomationTemplateCategory | 'ALL'>('ALL');
  const [showAllRecipes, setShowAllRecipes] = useState(false);

  const categoryRecipes = AUTOMATION_TEMPLATES.filter(
    (template) => recipeCategory === 'ALL' || template.category === recipeCategory,
  );
  const shownRecipes =
    recipeCategory === 'ALL' && !showAllRecipes ? categoryRecipes.slice(0, RECIPES_SHOWN) : categoryRecipes;

  const query = searchQuery.trim().toLowerCase();
  const filteredWorkflows = workflows.filter((wf) => {
    const matchesSearch =
      !query ||
      wf.name.toLowerCase().includes(query) ||
      (wf.description ?? '').toLowerCase().includes(query);
    return matchesSearch && (filterType === 'ALL' || wf.triggerType === filterType);
  });

  const createFromTemplate = async (id: AutomationTemplateId) => {
    try {
      const created = await createMutation.mutateAsync(
        buildTemplateGraph(id, { aiEmailToCustomers, teamEmail: session.user.email }),
      );
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
        description="Steps that run on their own when something happens in Kerf, on a schedule, or when you start them."
        actions={
          <div className="flex items-center gap-2">
            {can(PERMISSIONS.AUTOMATION_APPROVE) && (
              <Link href="/automations/approvals" data-testid="approvals-link">
                <Button variant="secondary">
                  <ShieldCheck className="size-4" />
                  Approvals
                </Button>
              </Link>
            )}
            <Link href="/automations/new" data-testid="create-automation-btn">
              <Button>
                <Plus className="size-4" />
                New automation
              </Button>
            </Link>
          </div>
        }
      />

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-ink">Ready-made recipes</h2>
          <p className="text-sm text-ink-muted">
            Pick one and it is set up for you. Nothing runs until you switch it on.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Recipe category">
          {(['ALL', ...AUTOMATION_TEMPLATE_CATEGORIES] as const).map((category) => (
            <button
              key={category}
              type="button"
              data-testid={`recipe-category-${category}`}
              aria-pressed={recipeCategory === category}
              onClick={() => setRecipeCategory(category)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                recipeCategory === category
                  ? 'border-brand bg-brand-soft text-ink'
                  : 'border-border text-ink-muted hover:border-brand/40',
              )}
            >
              {category === 'ALL' ? `All (${AUTOMATION_TEMPLATES.length})` : category}
            </button>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="recipe-gallery">
          {shownRecipes.map((template) => (
            <Card
              key={template.id}
              role="button"
              tabIndex={0}
              aria-label={`Create ${template.name}`}
              onClick={() => void createFromTemplate(template.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void createFromTemplate(template.id);
                }
              }}
              className="group cursor-pointer transition-colors hover:border-brand/40"
            >
              <CardBody className="space-y-2 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-ink">
                    {CATEGORY_ICONS[template.category]}
                  </span>
                  <Badge tone="neutral">{template.category}</Badge>
                </div>
                <h3 className="text-sm font-semibold text-ink">{template.name}</h3>
                <p className="text-sm text-ink-muted">{template.blurb}</p>
                <p className="text-xs font-medium text-ink-subtle">
                  {template.id === 'invoice-overdue-reminder'
                    ? overdueRecipientNote(aiEmailToCustomers)
                    : template.reaches}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
        {recipeCategory === 'ALL' && categoryRecipes.length > RECIPES_SHOWN && (
          <button
            type="button"
            data-testid="recipes-show-all"
            onClick={() => setShowAllRecipes((open) => !open)}
            className="text-sm font-medium text-ink underline-offset-2 hover:underline"
          >
            {showAllRecipes ? 'Show fewer' : `Show all ${categoryRecipes.length} recipes`}
          </button>
        )}
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
              {type === 'ALL' ? 'All triggers' : TRIGGER_LABELS[type]}
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
            <Card key={wf.id} className="group transition-colors hover:border-border-strong">
              <CardBody className="flex h-full flex-col justify-between gap-4 px-5 py-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="neutral">{TRIGGER_LABELS[wf.triggerType] ?? sentenceCase(wf.triggerType)}</Badge>
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[wf.status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                        {sentenceCase(wf.status)}
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
