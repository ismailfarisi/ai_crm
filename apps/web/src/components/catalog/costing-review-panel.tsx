'use client';

import { useState } from 'react';
import { Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import type { CostingProposal, CostingReviewDto } from '@saas/shared';
import { useApplyCostingProposal, useCostingReview } from '@/hooks/use-catalog-admin';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { formatDate, formatMoney } from '@/lib/utils';

const WINDOWS = [
  { value: '90', label: 'Last 3 months' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
];

const COMPONENT_LABELS: Record<CostingReviewDto['byComponent'][number]['component'], string> = {
  material: 'Material',
  machine: 'Machine time',
  labor: 'Labour',
  tooling: 'Tooling',
  overhead: 'Overhead',
};

const FIELD_LABELS: Record<CostingProposal['field'], string> = {
  costPerUom: 'Cost',
  wastePct: 'Waste allowance',
  scrapPct: 'Time allowance on run minutes',
};

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function formatValue(p: CostingProposal, value: number, currency: string | undefined) {
  return p.field === 'costPerUom' ? formatMoney(value, currency, { decimals: 4 }) : pct(value);
}

/**
 * Costing accuracy: what completed jobs say about the rates quotes are
 * priced from, and the change each one points to. Nothing changes until
 * someone applies a proposal, and then only that one field.
 */
export function CostingReviewPanel({ currency }: { currency: string | undefined }) {
  const [days, setDays] = useState(180);
  const { data, isPending, isError, error } = useCostingReview(days);
  const [confirming, setConfirming] = useState<CostingProposal | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          Kerf compares what each completed job was estimated to cost with what it actually used, and proposes the
          catalog change that would have made the estimate right. A proposal needs at least three jobs behind it.
        </p>
        <Select
          aria-label="Jobs completed in"
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          options={WINDOWS}
        />
      </div>

      {isPending ? (
        <Skeleton className="h-64" />
      ) : isError || !data ? (
        <EmptyState
          title="Couldn't load the costing review"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <>
          <Summary review={data} currency={currency} />

          <section aria-labelledby="proposals-heading" className="space-y-3">
            <h2 id="proposals-heading" className="text-sm font-semibold text-ink">
              Proposed corrections ({data.proposals.length})
            </h2>
            {data.proposals.length === 0 ? (
              <EmptyState
                icon={<Gauge className="size-8 text-ink-muted" />}
                title="Nothing to correct"
                description={
                  data.jobs === 0
                    ? 'No jobs were completed in this period with an estimate to compare against.'
                    : 'Where enough jobs give evidence, the catalog’s rates match what they used.'
                }
              />
            ) : (
              <ul className="space-y-3">
                {data.proposals.map((p) => (
                  <ProposalCard key={p.id} proposal={p} currency={currency} onApply={() => setConfirming(p)} />
                ))}
              </ul>
            )}
          </section>

          {data.notes.length > 0 && (
            <section aria-label="Also worth knowing" className="rounded-xl border border-border/60 bg-surface p-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {confirming && (
        <ConfirmApply proposal={confirming} currency={currency} onClose={() => setConfirming(null)} />
      )}
    </div>
  );
}

function Summary({ review, currency }: { review: CostingReviewDto; currency: string | undefined }) {
  const over = (review.variancePct ?? 0) > 0;
  return (
    <section aria-labelledby="accuracy-heading" className="rounded-xl border border-border/60 bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h2 id="accuracy-heading" className="text-sm font-semibold text-ink">
          {review.jobs} job{review.jobs === 1 ? '' : 's'} completed since {formatDate(review.from)}
        </h2>
        {review.variancePct != null && (
          <p className={`flex items-center gap-1 text-sm font-medium ${over ? 'text-warning' : 'text-success'}`}>
            {over ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            Actual cost {Math.abs(review.variancePct).toFixed(1)}% {over ? 'over' : 'under'} estimate
          </p>
        )}
      </div>
      {review.jobs > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-subtle">
              <th className="px-4 py-2 font-medium" />
              <th className="px-4 py-2 text-right font-medium">Estimated</th>
              <th className="px-4 py-2 text-right font-medium">Actual</th>
              <th className="px-4 py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {review.byComponent
              .filter((c) => c.estimated !== 0 || c.actual !== 0)
              .map((c) => (
                <tr key={c.component}>
                  <td className="px-4 py-2 text-ink">{COMPONENT_LABELS[c.component]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.estimated, currency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.actual, currency)}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${c.actual > c.estimated ? 'text-warning' : 'text-ink-muted'}`}
                  >
                    {formatMoney(c.actual - c.estimated, currency)}
                  </td>
                </tr>
              ))}
            <tr className="font-medium">
              <td className="px-4 py-2 text-ink">Total</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatMoney(review.estimatedTotal, currency)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatMoney(review.actualTotal, currency)}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatMoney(review.actualTotal - review.estimatedTotal, currency)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

function ProposalCard({
  proposal: p,
  currency,
  onApply,
}: {
  proposal: CostingProposal;
  currency: string | undefined;
  onApply: () => void;
}) {
  const costlier = p.impact > 0;
  return (
    <li className="rounded-xl border border-border/60 bg-surface p-4" data-testid="costing-proposal">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-ink">{p.target.name}</p>
          <p className="text-sm text-ink">
            {FIELD_LABELS[p.field]}:{' '}
            <span className="tabular-nums text-ink-muted line-through">{formatValue(p, p.current, currency)}</span>{' '}
            → <span className="tabular-nums font-medium">{formatValue(p, p.proposed, currency)}</span>
            {p.capped && <span className="ml-1 text-xs text-warning">(the most the catalog allows)</span>}
          </p>
          <p className="text-sm text-ink-muted">{p.reason}</p>
          <p className="text-xs text-ink-subtle">
            {p.jobs} job{p.jobs === 1 ? '' : 's'}: {p.workOrderNumbers.join(', ')}
            {p.jobs > p.workOrderNumbers.length ? ' …' : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge tone={costlier ? 'warning' : 'neutral'}>
            {costlier ? 'Under-quoted' : 'Over-quoted'} {formatMoney(Math.abs(p.impact), currency)}
          </Badge>
          <Button size="sm" onClick={onApply}>
            Apply
          </Button>
        </div>
      </div>
    </li>
  );
}

function ConfirmApply({
  proposal: p,
  currency,
  onClose,
}: {
  proposal: CostingProposal;
  currency: string | undefined;
  onClose: () => void;
}) {
  const apply = useApplyCostingProposal();
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Update ${p.target.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={apply.isPending} onClick={() => apply.mutate(p, { onSuccess: onClose })}>
            Apply
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">
        {FIELD_LABELS[p.field]} changes from {formatValue(p, p.current, currency)} to{' '}
        <strong>{formatValue(p, p.proposed, currency)}</strong>.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        Quotes priced from now on use the new value. Quotes already sent and jobs already planned keep the figures
        they were made with.
      </p>
    </Dialog>
  );
}
