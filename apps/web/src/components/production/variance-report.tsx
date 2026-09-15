'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWorkOrderVariance } from '@/hooks/use-work-orders';
import { EmptyState, PageHeader } from '@/components/ui/primitives';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mins = (n: number) => `${Math.round(n)} min`;

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which template rates are wrong, and by how much.
 *
 * Ranked by what the error cost rather than by percentage, so the first row
 * is the estimate most worth fixing. "Multiply by" is the correction to apply
 * to that operation's run-minute formula to match what the floor recorded.
 */
export function VarianceReport() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState('');
  const { data, isPending, isError, error } = useWorkOrderVariance({
    from: from || undefined,
    to: to || undefined,
  });

  return (
    <>
      <PageHeader
        title="Estimate vs actual"
        description="Time on completed jobs against what the template estimated, by template version and work centre."
        actions={
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <label className="flex items-center gap-2">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-line bg-surface px-2 py-1.5 text-ink" />
            </label>
            <label className="flex items-center gap-2">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-line bg-surface px-2 py-1.5 text-ink" />
            </label>
            <Link href="/production" className="rounded border border-line px-3 py-1.5 text-ink hover:bg-surface-sunk">
              Board
            </Link>
          </div>
        }
      />

      {isError ? (
        <EmptyState title="Couldn't load the report" description={error instanceof Error ? error.message : 'Please try again.'} />
      ) : isPending ? (
        <p className="text-ink-muted">Loading…</p>
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          title="Nothing to compare yet"
          description="Rows appear once jobs with recorded time have been completed in this period."
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted">
            {data.jobs} completed {data.jobs === 1 ? 'job' : 'jobs'}. Positive variance means the estimate was optimistic.
          </p>
          <div className="overflow-x-auto rounded border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Template</th>
                  <th className="px-4 py-2 font-medium">Work centre</th>
                  <th className="px-4 py-2 text-right font-medium">Ops</th>
                  <th className="px-4 py-2 text-right font-medium">Estimated</th>
                  <th className="px-4 py-2 text-right font-medium">Actual</th>
                  <th className="px-4 py-2 text-right font-medium">Variance</th>
                  <th className="px-4 py-2 text-right font-medium">Cost of error</th>
                  <th className="px-4 py-2 text-right font-medium">Multiply by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((row, index) => (
                  <tr key={`${row.templateKey}-${row.templateVersion}-${row.workCenterId}`}>
                    <td className="px-4 py-2 text-ink-subtle">{index + 1}</td>
                    <td className="px-4 py-2 text-ink">
                      {row.templateName ?? '—'}
                      {row.templateVersion != null && <span className="text-ink-subtle"> v{row.templateVersion}</span>}
                    </td>
                    <td className="px-4 py-2 text-ink">{row.workCenterName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.samples}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{mins(row.estimatedMinutes)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{mins(row.actualMinutes)}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        row.varianceMinutes > 0 ? 'text-danger' : row.varianceMinutes < 0 ? 'text-success' : ''
                      }`}
                    >
                      {row.varianceMinutes > 0 ? '+' : ''}
                      {mins(row.varianceMinutes)}
                      {row.variancePct != null && ` (${row.variancePct > 0 ? '+' : ''}${(row.variancePct * 100).toFixed(0)}%)`}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{money(row.varianceCost)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.suggestedFactor ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
