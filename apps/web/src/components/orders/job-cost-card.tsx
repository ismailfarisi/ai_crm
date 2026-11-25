'use client';

import Link from 'next/link';
import { AlertTriangle, ChevronDown, PiggyBank, TrendingUp } from 'lucide-react';
import type { JobCostSourceDto, OrderJobCostDto } from '@saas/shared';
import { useSalesOrderCosts } from '@/hooks/use-sales-orders';
import { cn, formatMoney } from '@/lib/utils';

const SOURCE_HREF: Record<JobCostSourceDto['kind'], (id: string) => string> = {
  PURCHASE_ORDER: (id) => `/purchasing/orders/${id}`,
  SUPPLIER_BILL: (id) => `/purchasing/bills/${id}`,
  EXPENSE_CLAIM: (id) => `/finance/expenses/${id}`,
};

const SOURCE_LABEL: Record<JobCostSourceDto['kind'], string> = {
  PURCHASE_ORDER: 'Purchase order',
  SUPPLIER_BILL: 'Supplier bill',
  EXPENSE_CLAIM: 'Expense',
};

const asPct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

/**
 * Quoted against actual cost for one order, laid out like the "Next step"
 * card above it: one headline, one line of why, then the figures. Only
 * rendered for people who can see cost; the API refuses everyone else too.
 */
export function JobCostCard({ orderId, className }: { orderId: string; className?: string }) {
  const { data, isPending, isError } = useSalesOrderCosts(orderId, true);
  if (isPending) {
    return (
      <section className={cn('rounded-2xl border border-border bg-surface p-4 text-sm text-ink-muted shadow-2xs', className)}>
        Working out the job’s cost…
      </section>
    );
  }
  if (isError || !data) return null;
  return <JobCostBody cost={data} className={className} />;
}

export function JobCostBody({ cost, className }: { cost: OrderJobCostDto; className?: string }) {
  const money = (n: number) => formatMoney(n, cost.currency);
  const { actual } = cost;
  const nothingYet = actual.total === 0;
  const losing = cost.marginLeft < 0;
  const warn = cost.overBudget || losing;
  const Icon = warn ? AlertTriangle : nothingYet ? PiggyBank : TrendingUp;

  const title = cost.overBudget
    ? `Over budget: ${asPct(cost.overByPct ?? 0)} more than quoted`
    : losing
      ? `Losing ${money(-cost.marginLeft)} on this job`
      : nothingYet
        ? 'No cost on this job yet'
        : `${money(cost.marginLeft)} margin left`;

  const detail = cost.overBudget
    ? `It has cost ${money(actual.total)} so far against ${money(cost.quotedCost ?? 0)} quoted. You are warned past ${asPct(cost.alertPct)}, set in Costing rules.`
    : nothingYet
      ? 'Material issued, labour booked and bought-in costs for this order show up here as they happen.'
      : cost.quotedCost == null
        ? `The quote had no cost, so there is nothing to compare against. Spent so far: ${money(actual.total)}.`
        : `Spent ${money(actual.total)} of the ${money(cost.quotedCost)} the quote expected (${asPct(actual.total / cost.quotedCost)}).`;

  const parts: { label: string; value: number; hint: string }[] = [
    { label: 'Material issued', value: actual.material, hint: 'Stock taken out for this job, at what it cost us' },
    { label: 'Labour', value: actual.labour, hint: 'Hours booked on its work orders' },
    { label: 'Machines and overhead', value: actual.machineAndOverhead, hint: 'Machine time and the shop’s running costs on its work orders' },
    { label: 'Bought in', value: actual.boughtIn, hint: 'Outsourced work, hire and other costs put on this job, before VAT we get back' },
  ];

  return (
    <section
      aria-labelledby="job-cost-title"
      className={cn(
        'rounded-2xl border bg-surface p-4 shadow-2xs',
        warn ? 'border-danger/40' : 'border-border',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full',
            warn ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Quoted vs actual
          </p>
          <h2 id="job-cost-title" className="text-base font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-muted">{detail}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Price" value={money(cost.price)} hint="What the customer pays, before VAT" />
        <Figure
          label="Quoted cost"
          value={cost.quotedCost == null ? '—' : money(cost.quotedCost)}
          hint={
            cost.quotedCost == null
              ? 'The quote had no cost on its lines'
              : cost.quotedCostComplete
                ? 'What the quote expected the job to cost'
                : 'Some quote lines had no cost, so this is low'
          }
        />
        <Figure
          label="Actual cost so far"
          value={money(actual.total)}
          hint="Everything below, added up"
          tone={cost.overBudget ? 'danger' : undefined}
        />
        <Figure
          label="Margin left"
          value={money(cost.marginLeft)}
          hint={
            cost.marginLeftPct == null
              ? 'Price less what has been spent so far'
              : `Price less spent so far: ${asPct(cost.marginLeftPct)} of the price`
          }
          tone={losing ? 'danger' : 'success'}
        />
      </dl>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-4">
        {parts.map((p) => (
          <div key={p.label}>
            <dt className="text-xs text-ink-subtle">{p.label}</dt>
            <dd className="text-sm font-medium tabular-nums text-ink">{money(p.value)}</dd>
            <dd className="text-[11px] text-ink-subtle">{p.hint}</dd>
          </div>
        ))}
      </dl>

      {cost.onOrder > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          {money(cost.onOrder)} more is ordered from suppliers but has not arrived, so it is not counted yet.
        </p>
      )}
      {cost.priceRateMissing && (
        <p className="mt-1 text-xs text-warning">
          No exchange rate for the order’s currency, so the price is shown unconverted.
        </p>
      )}

      {cost.sources.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            Bought-in costs on this job ({cost.sources.length})
          </summary>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {cost.sources.map((s) => (
              <li key={`${s.kind}-${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={SOURCE_HREF[s.kind](s.id)} className="font-medium text-ink underline-offset-2 hover:underline">
                    {SOURCE_LABEL[s.kind]} {s.number}
                  </Link>
                  <span className="text-ink-muted"> · {s.party}</span>
                  {s.description && <p className="truncate text-xs text-ink-subtle">{s.description}</p>}
                </div>
                <div className="text-right tabular-nums">
                  <p className="font-medium text-ink">{money(s.counted)}</p>
                  {s.onOrder > 0 && <p className="text-xs text-ink-subtle">+{money(s.onOrder)} on order</p>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'danger' | 'success';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          'text-sm font-semibold tabular-nums',
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink',
        )}
      >
        {value}
      </dd>
      <dd className="text-[11px] text-ink-subtle">{hint}</dd>
    </div>
  );
}
