'use client';

import { useState } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { useCostingPolicy, useUpdateCostingPolicy } from '@/hooks/use-catalog';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/primitives';

/** Shown as whole percentages; the API stores fractions for margins and the alert. */
const pct = (fraction: number | undefined) =>
  fraction == null ? '' : String(Math.round(fraction * 1000) / 10);

interface Draft {
  minMargin?: string;
  maxDiscount?: string;
  overBudget?: string;
  requireKnownCost?: boolean;
  enforce?: boolean;
}

/**
 * The shop's costing rules in one place: the margin floor and discount cap
 * quotes are checked against, and how far a job may run past its quoted cost
 * before the order warns.
 */
export function CostingRulesView() {
  const { policy, isLoading } = useCostingPolicy();
  const save = useUpdateCostingPolicy();
  const canEdit = useCan({ permission: PERMISSIONS.CATALOG_MANAGE });
  // Edits sit on top of the saved policy, so the form shows saved values until touched.
  const [draft, setDraft] = useState<Draft>({});
  const edit =
    <K extends keyof Draft>(key: K) =>
    (value: Required<Draft>[K]) =>
      setDraft((d) => ({ ...d, [key]: value }));
  const minMargin = draft.minMargin ?? pct(policy?.minMarginPct);
  const maxDiscount = draft.maxDiscount ?? (policy ? String(policy.maxDiscountPct) : '');
  const overBudget = draft.overBudget ?? pct(policy?.overBudgetAlertPct);
  const requireKnownCost = draft.requireKnownCost ?? policy?.requireKnownCost ?? false;
  const enforce = draft.enforce ?? policy?.enforce ?? false;
  const setMinMargin = edit('minMargin');
  const setMaxDiscount = edit('maxDiscount');
  const setOverBudget = edit('overBudget');
  const setRequireKnownCost = edit('requireKnownCost');
  const setEnforce = edit('enforce');

  const overBudgetN = Number(overBudget);
  const overBudgetBad = overBudget === '' || !(overBudgetN >= 0 && overBudgetN <= 500);
  const minMarginN = Number(minMargin);
  const minMarginBad = minMargin === '' || !(minMarginN >= 0 && minMarginN <= 100);
  const maxDiscountN = Number(maxDiscount);
  const maxDiscountBad = maxDiscount === '' || !(maxDiscountN >= 0 && maxDiscountN <= 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Costing rules"
        description="How quotes are checked before they go out, and when a job's real cost should worry you."
      />
      {isLoading || !policy ? (
        <p className="text-ink-muted">Loading…</p>
      ) : (
        <form
          className="max-w-2xl space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (overBudgetBad || minMarginBad || maxDiscountBad) return;
            save.mutate({
              minMarginPct: minMarginN / 100,
              maxDiscountPct: maxDiscountN,
              requireKnownCost,
              enforce,
              overBudgetAlertPct: overBudgetN / 100,
            });
          }}
        >
          <section className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-2xs">
            <h2 className="text-base font-semibold text-ink">Quotes</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Lowest margin (%)"
                type="number"
                min={0}
                max={100}
                step="0.1"
                disabled={!canEdit}
                value={minMargin}
                error={minMarginBad ? 'Between 0 and 100' : undefined}
                hint="A quote earning less than this, after costs, gets flagged."
                onChange={(e) => setMinMargin(e.target.value)}
              />
              <Input
                label="Biggest discount on a line (%)"
                type="number"
                min={0}
                max={100}
                step="0.1"
                disabled={!canEdit}
                value={maxDiscount}
                error={maxDiscountBad ? 'Between 0 and 100' : undefined}
                hint="A line discounted more than this gets flagged."
                onChange={(e) => setMaxDiscount(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!canEdit}
                checked={requireKnownCost}
                onChange={(e) => setRequireKnownCost(e.target.checked)}
              />
              <span>
                Flag lines with no cost
                <span className="block text-xs text-ink-muted">
                  A line typed with no cost hides how much the quote really earns.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!canEdit}
                checked={enforce}
                onChange={(e) => setEnforce(e.target.checked)}
              />
              <span>
                Stop flagged quotes from being approved
                <span className="block text-xs text-ink-muted">
                  Off: flags are a warning only. On: someone has to fix the quote first.
                </span>
              </span>
            </label>
          </section>

          <section className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-2xs">
            <h2 className="text-base font-semibold text-ink">Jobs</h2>
            <Input
              label="Warn when a job costs more than quoted by (%)"
              type="number"
              min={0}
              max={500}
              step="1"
              containerClassName="max-w-xs"
              disabled={!canEdit}
              value={overBudget}
              error={overBudgetBad ? 'Between 0 and 500' : undefined}
              hint={
                overBudgetBad
                  ? undefined
                  : `A job quoted at AED 10,000 of cost warns once it has cost more than AED ${(10000 * (1 + overBudgetN / 100)).toLocaleString('en-AE', { maximumFractionDigits: 0 })}. Shown on the order and sent to people who can see costs.`
              }
              onChange={(e) => setOverBudget(e.target.value)}
            />
          </section>

          {canEdit && (
            <Button type="submit" loading={save.isPending}>
              Save rules
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
