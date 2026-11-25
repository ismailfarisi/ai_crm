'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PackageCheck, Receipt } from 'lucide-react';
import {
  MATERIAL_COST_BASIS_LABELS,
  type MaterialCostBasis,
  type MaterialCostFigure,
  type MaterialCostRow,
  type QuoteCostCheck,
  type QuoteDto,
  type QuoteRecostMode,
} from '@saas/shared';
import {
  useApplyMaterialCost,
  useMaterialCosts,
  useQuoteCostChanges,
  useRecostQuote,
} from '@/hooks/use-catalog-admin';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { formatMoney } from '@/lib/utils';

const unit = (n: number, currency: string | undefined) => formatMoney(n, currency, { decimals: 4 });
const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 1000) / 10}%`);
const BASIS_TITLES: Record<MaterialCostBasis, string> = {
  LAST_PURCHASE: 'Last price paid',
  AVERAGE: 'Average in stock',
  SUPPLIER: 'Supplier price',
};

/**
 * What quotes are priced from against what the shop actually pays, and the
 * open quotes still priced on the old figure. Shown above the costing review
 * in the Costing accuracy tab, to people who may see costs.
 */
export function MaterialCostPanel({ currency }: { currency: string | undefined }) {
  const { data, isPending, isError, error } = useMaterialCosts();
  const [confirming, setConfirming] = useState<{ row: MaterialCostRow; figure: MaterialCostFigure } | null>(null);

  return (
    <div className="space-y-6">
      <section aria-labelledby="paid-heading" className="space-y-3">
        <div className="space-y-1">
          <h2 id="paid-heading" className="text-sm font-semibold text-ink">
            Costs against what you pay
          </h2>
          <p className="max-w-2xl text-sm text-ink-muted">
            Quotes are priced from the cost typed into the catalog. Kerf checks it against your latest goods receipt,
            the average cost of what is in stock and your supplier&rsquo;s price, and lists any that are 2% or more
            apart.
          </p>
        </div>

        {isPending ? (
          <Skeleton className="h-40" />
        ) : isError || !data ? (
          <EmptyState
            title="Couldn't compare costs"
            description={error instanceof Error ? error.message : 'Please try again.'}
          />
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={<PackageCheck className="size-8 text-ink-muted" />}
            title="Catalog costs match what you pay"
            description={
              data.checked === 0
                ? 'No receipts, stock or supplier prices yet to compare against.'
                : `${data.checked} material${data.checked === 1 ? '' : 's'} checked; none is 2% or more away.`
            }
          />
        ) : (
          <ul className="space-y-3">
            {data.rows.map((row) => (
              <CostRow
                key={row.id}
                row={row}
                currency={currency}
                onPick={(figure) => setConfirming({ row, figure })}
              />
            ))}
          </ul>
        )}

        {data && data.notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <OpenQuotesOnOldCosts />

      {confirming && (
        <ConfirmCost {...confirming} currency={currency} onClose={() => setConfirming(null)} />
      )}
    </div>
  );
}

function CostRow({
  row,
  currency,
  onPick,
}: {
  row: MaterialCostRow;
  currency: string | undefined;
  onPick: (figure: MaterialCostFigure) => void;
}) {
  const suggested = row.figures.find((f) => f.basis === row.suggested)!;
  const up = suggested.unitCost > row.current;
  return (
    <li className="rounded-xl border border-border/60 bg-surface p-4" data-testid="material-cost-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-ink">
            {row.target.name}
            {row.target.type === 'CATALOG_ITEM' && (
              <span className="ml-2 text-xs font-normal text-ink-subtle">stock item</span>
            )}
          </p>
          <p className="text-sm text-ink-muted">{row.reason}</p>
        </div>
        <Badge tone={up ? 'warning' : 'neutral'}>
          {up ? 'Quoting too low' : 'Quoting too high'} by {pct(Math.abs(suggested.gapPct ?? 1))}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-surface-muted px-3 py-2">
          <p className="text-xs text-ink-subtle">In the catalog now</p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {unit(row.current, currency)} <span className="text-xs text-ink-subtle">/ {row.uom}</span>
          </p>
        </div>
        {row.figures.map((f) => (
          <div key={f.basis} className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
            <div>
              <p className="text-xs text-ink-subtle">{BASIS_TITLES[f.basis]}</p>
              <p className="text-sm font-medium tabular-nums text-ink">
                {unit(f.unitCost, currency)} <span className="text-xs text-ink-subtle">/ {row.uom}</span>
              </p>
              <p className="text-xs text-ink-muted">{f.detail}</p>
            </div>
            <Button
              size="sm"
              variant={f.basis === row.suggested ? 'primary' : 'secondary'}
              onClick={() => onPick(f)}
              disabled={Math.round(f.unitCost * 10_000) === Math.round(row.current * 10_000)}
            >
              Use this
            </Button>
          </div>
        ))}
      </div>
    </li>
  );
}

function ConfirmCost({
  row,
  figure,
  currency,
  onClose,
}: {
  row: MaterialCostRow;
  figure: MaterialCostFigure;
  currency: string | undefined;
  onClose: () => void;
}) {
  const apply = useApplyMaterialCost();
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Update ${row.target.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={apply.isPending} onClick={() => apply.mutate({ row, basis: figure.basis }, { onSuccess: onClose })}>
            Update cost
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">
        Cost per {row.uom} changes from {unit(row.current, currency)} to <strong>{unit(figure.unitCost, currency)}</strong>,
        the {MATERIAL_COST_BASIS_LABELS[figure.basis]}.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        New quotes use it straight away. Open quotes keep their cost until you re-cost them below; accepted quotes
        and jobs already made never change.
      </p>
    </Dialog>
  );
}

/** Open quotes (not accepted, not replaced) whose costs have moved since they were saved. */
export function OpenQuotesOnOldCosts() {
  const { data, isPending } = useQuoteCostChanges();
  const [recosting, setRecosting] = useState<QuoteCostCheck | null>(null);

  return (
    <section aria-labelledby="old-costs-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="old-costs-heading" className="text-sm font-semibold text-ink">
          Open quotes priced on old costs {data ? `(${data.length})` : ''}
        </h2>
        <p className="max-w-2xl text-sm text-ink-muted">
          Quotes not yet accepted whose costs have moved since they were saved. Accepted quotes keep the cost they were
          made with.
        </p>
      </div>
      {isPending ? (
        <Skeleton className="h-24" />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-8 text-ink-muted" />}
          title="Every open quote is on today's costs"
          description="When a catalog cost changes, quotes that used it show up here."
        />
      ) : (
        <ul className="divide-y divide-border/40 rounded-xl border border-border/60 bg-surface">
          {data.map((q) => (
            <li key={q.quoteId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="stale-quote">
              <div className="min-w-0">
                <Link href={`/quotes/${q.quoteId}`} className="text-sm font-semibold text-ink hover:underline">
                  {q.quoteNumber ?? 'Quote'} · {q.customerName}
                </Link>
                <p className="text-sm text-ink-muted">
                  Cost was {formatMoney(q.savedCost, q.currency)}, now {formatMoney(q.currentCost, q.currency)}. Margin{' '}
                  {pct(q.savedMarginPct)} → <strong>{pct(q.currentMarginPct)}</strong> at the same price.
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setRecosting(q)}>
                Re-cost
              </Button>
            </li>
          ))}
        </ul>
      )}
      {recosting && <RecostDialog check={recosting} onClose={() => setRecosting(null)} />}
    </section>
  );
}

/** Re-cost one quote: keep its prices, or (before approval) move template prices with the cost. */
export function RecostDialog({
  check: q,
  onClose,
  onDone,
}: {
  check: QuoteCostCheck;
  onClose: () => void;
  onDone?: (quote: QuoteDto) => void;
}) {
  const recost = useRecostQuote();
  // mutateAsync, not mutate's callbacks: the banner that opened this dialog
  // unmounts once the re-cost clears the warning, and mutate's per-call
  // callbacks never fire for an unmounted caller.
  const run = async (mode: QuoteRecostMode) => {
    try {
      const quote = await recost.mutateAsync({ id: q.quoteId, mode });
      onDone?.(quote);
      onClose();
    } catch {
      // The hook already shows the error.
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Re-cost ${q.quoteNumber ?? 'this quote'}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {q.canReprice && (
            <Button variant="secondary" loading={recost.isPending} onClick={() => run('COSTS_AND_PRICES')}>
              Update costs and prices
            </Button>
          )}
          <Button loading={recost.isPending} onClick={() => run('COSTS')}>
            Update costs, keep prices
          </Button>
        </>
      }
    >
      <ul className="space-y-1 text-sm text-ink">
        <li>
          Cost: {formatMoney(q.savedCost, q.currency)} → <strong>{formatMoney(q.currentCost, q.currency)}</strong>
        </li>
        <li>
          Keeping prices ({formatMoney(q.subtotal, q.currency)}), margin goes from {pct(q.savedMarginPct)} to{' '}
          <strong>{pct(q.currentMarginPct)}</strong>.
        </li>
        {q.canReprice && (
          <li>
            Updating prices too, the subtotal becomes {formatMoney(q.repricedSubtotal, q.currency)} at{' '}
            {pct(q.repricedMarginPct)} margin.
          </li>
        )}
      </ul>
      <p className="mt-2 text-sm text-ink-muted">
        {q.status === 'APPROVED'
          ? 'This quote is approved, so its prices stay as approved. Create a revision to change them.'
          : 'Only lines built from a template change price; catalog items and hand-typed lines keep theirs.'}
      </p>
    </Dialog>
  );
}
