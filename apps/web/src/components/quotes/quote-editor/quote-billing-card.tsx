'use client';

import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  allocateStageAmounts,
  BILLING_PRESETS,
  DEFAULT_BILLING_SCHEDULE,
  validateBillingSchedule,
  type BillingStage,
  type QuoteTotals,
} from '@saas/shared';

interface QuoteBillingCardProps {
  /** Null means the default: everything invoiced on approval. */
  schedule: BillingStage[] | null;
  onChange: (schedule: BillingStage[] | null) => void;
  totals: QuoteTotals;
  currency: string;
  readOnly?: boolean;
}

const money = (n: number, currency: string) =>
  `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

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
        <h2 id="billing-title" className="text-sm font-bold uppercase tracking-wider text-ink">
          Billing
        </h2>
        <select
          aria-label="Billing schedule"
          value={presetKey}
          disabled={readOnly}
          onChange={(e) => choosePreset(e.target.value)}
          className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink disabled:opacity-60"
        >
          {BILLING_PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom stages</option>
        </select>
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
                  className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-ink"
                />
                <input
                  aria-label={`Stage ${index + 1} percent`}
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={stage.percent}
                  onChange={(e) => update(index, { percent: Number(e.target.value) })}
                  className="w-20 rounded border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
                />
                <span className="text-ink-subtle">%</span>
                <select
                  aria-label={`Stage ${index + 1} timing`}
                  value={stage.trigger}
                  onChange={(e) => update(index, { trigger: e.target.value as BillingStage['trigger'] })}
                  className="rounded border border-line bg-surface px-2 py-1 text-ink"
                >
                  <option value="ON_APPROVAL">On approval</option>
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
                  className="rounded p-1 text-ink-subtle hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </>
            ) : (
              <span className="flex-1 text-ink">
                {stage.label}{' '}
                <span className="text-ink-subtle">
                  · {stage.percent}% · {stage.trigger === 'ON_APPROVAL' ? 'on approval' : 'when reached'}
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
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
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
