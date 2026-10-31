'use client';

import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from './quote-lines-table';
import {
  allocateStageAmounts,
  BILLING_PRESETS,
  DEFAULT_BILLING_SCHEDULE,
  validateBillingSchedule,
  type BillingStage,
  type QuoteTotals,
} from '@saas/shared';

interface QuoteBillingCardProps {
  /** Null means the default: everything invoiced when the customer accepts. */
  schedule: BillingStage[] | null;
  onChange: (schedule: BillingStage[] | null) => void;
  totals: QuoteTotals;
  currency: string;
  readOnly?: boolean;
}

// One money format across the editor: the same one as the lines and totals.
const money = (n: number, currency: string) => formatCurrency(n, currency);

const sameStages = (a: BillingStage[], b: BillingStage[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * How the quote will be invoiced once approved.
 *
 * Previews the split with the same allocation the API stores, so the amounts
 * shown here are the amounts that will be invoiced, to the cent.
 */
export function QuoteBillingCard({ schedule, onChange, totals, currency, readOnly }: QuoteBillingCardProps) {
  const stages = schedule?.length ? schedule : DEFAULT_BILLING_SCHEDULE;
  const presetKey = BILLING_PRESETS.find((p) => sameStages(p.stages, stages))?.key ?? 'custom';
  const problems = useMemo(() => validateBillingSchedule(stages), [stages]);
  const amounts = useMemo(
    () => (problems.length ? null : allocateStageAmounts(totals, stages)),
    [problems, totals, stages],
  );

  const update = (index: number, patch: Partial<BillingStage>) =>
    onChange(stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)));

  const choosePreset = (key: string) => {
    if (key === 'custom') {
      onChange([
        { kind: 'DEPOSIT', label: 'Deposit', percent: 40, trigger: 'ON_APPROVAL' },
        { kind: 'MILESTONE', label: 'Proofs approved', percent: 30, trigger: 'MANUAL' },
        { kind: 'FINAL', label: 'On delivery', percent: 30, trigger: 'MANUAL' },
      ]);
      return;
    }
    const preset = BILLING_PRESETS.find((p) => p.key === key);
    onChange(preset && preset.key !== 'full' ? preset.stages : null);
  };

  return (
    <section className="rounded-2xl border border-border/40 bg-surface p-4 shadow-2xs" aria-labelledby="billing-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="billing-title" className="text-sm font-semibold text-ink">
          Billing
        </h2>
        {/* A locked quote states its schedule; a greyed-out dropdown reads as broken. */}
        {readOnly ? (
          <p className="text-sm font-medium text-ink">
            {BILLING_PRESETS.find((preset) => preset.key === presetKey)?.label ?? 'Custom stages'}
          </p>
        ) : (
          <select
            aria-label="Billing schedule"
            value={presetKey}
            onChange={(e) => choosePreset(e.target.value)}
            className="min-h-10 rounded-xl border border-border-control bg-surface px-3 text-sm text-ink focus:border-brand-ring focus:outline-hidden focus:ring-1 focus:ring-brand-ring"
          >
            {BILLING_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Custom stages</option>
          </select>
        )}
      </div>

      <ol className="space-y-2">
        {stages.map((stage, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
            {presetKey === 'custom' && !readOnly ? (
              <>
                <input
                  aria-label={`Stage ${index + 1} name`}
                  value={stage.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  className="min-w-0 flex-1 rounded-xl border border-border-control bg-surface px-2 py-1.5 focus:border-brand-ring focus:outline-hidden focus:ring-1 focus:ring-brand-ring text-ink"
                />
                <input
                  aria-label={`Stage ${index + 1} percent`}
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={stage.percent}
                  onChange={(e) => update(index, { percent: Number(e.target.value) })}
                  className="w-20 rounded-xl border border-border-control bg-surface px-2 py-1.5 focus:border-brand-ring focus:outline-hidden focus:ring-1 focus:ring-brand-ring text-right tabular-nums text-ink"
                />
                <span className="text-ink-subtle">%</span>
                <select
                  aria-label={`Stage ${index + 1} timing`}
                  value={stage.trigger}
                  onChange={(e) => update(index, { trigger: e.target.value as BillingStage['trigger'] })}
                  className="rounded-xl border border-border-control bg-surface px-2 py-1.5 focus:border-brand-ring focus:outline-hidden focus:ring-1 focus:ring-brand-ring text-ink"
                >
                  <option value="ON_APPROVAL">When accepted</option>
                  <option value="MANUAL">When reached</option>
                </select>
                <button
                  type="button"
                  aria-label={`Remove stage ${index + 1}`}
                  disabled={stages.length === 1}
                  onClick={() =>
                    onChange(
                      stages
                        .filter((_, i) => i !== index)
                        .map((s, i, all) => ({ ...s, kind: i === all.length - 1 ? 'FINAL' : s.kind === 'FINAL' ? 'MILESTONE' : s.kind })),
                    )
                  }
                  className="grid size-9 place-items-center rounded-full text-ink-subtle hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </>
            ) : (
              <span className="flex-1 text-ink">
                {stage.label}{' '}
                <span className="text-ink-subtle">
                  · {stage.percent}% ·{' '}
                  {stage.trigger === 'ON_APPROVAL'
                    ? 'when accepted'
                    : stage.trigger === 'ON_DELIVERY'
                      ? 'invoiced as each delivery ships'
                      : 'when reached'}
                </span>
              </span>
            )}
            <span className="ml-auto tabular-nums text-ink-muted">
              {amounts ? money(amounts[index].totalAmount, currency) : '—'}
            </span>
          </li>
        ))}
      </ol>

      {presetKey === 'custom' && !readOnly && stages.length < 12 && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...stages.map((s) => (s.kind === 'FINAL' ? { ...s, kind: 'MILESTONE' as const } : s)),
              { kind: 'FINAL', label: 'Balance', percent: 0, trigger: 'MANUAL' },
            ])
          }
          className="mt-2 inline-flex items-center gap-1 min-h-9 text-sm font-medium text-ink underline-offset-2 hover:underline"
        >
          <Plus className="size-3.5" />
          Add stage
        </button>
      )}

      {problems.length > 0 && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {problems.join(' ')}
        </p>
      )}
    </section>
  );
}
