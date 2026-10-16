'use client';

import { AlertTriangle } from 'lucide-react';
import { TIMESHEET_INDIRECT_CATEGORIES, type LabourUtilisationDto, type LabourUtilisationRowDto } from '@saas/shared';
import { useFinancialReport } from '@/hooks/use-platform';
import type { ReportParams } from '@/lib/api/endpoints';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hours = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

type LabourFigures = Omit<LabourUtilisationRowDto, 'employeeId' | 'employeeNumber' | 'employeeName'>;

const indirectTotal = (f: LabourFigures) => TIMESHEET_INDIRECT_CATEGORIES.reduce((s, c) => s + (f.indirectHours[c] ?? 0), 0);
const indirectBreakdown = (f: LabourFigures) =>
  TIMESHEET_INDIRECT_CATEGORIES.map((c) => `${c.charAt(0)}${c.slice(1).toLowerCase()}: ${hours(f.indirectHours[c] ?? 0)} h`).join(', ');

function FigureCells({ f, provisional }: { f: LabourFigures; provisional: boolean }) {
  return (
    <>
      <td className="px-4 py-1.5 text-right tabular-nums">{hours(f.standardHours)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{hours(f.directHours)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums" title={indirectBreakdown(f)}>
        {hours(indirectTotal(f))}
      </td>
      <td className="px-4 py-1.5 text-right tabular-nums">{hours(f.unloggedHours)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums" title={provisional ? 'Estimated cost — payroll not posted' : undefined}>
        {money(f.cost)}
        {provisional && <span className="text-ink-subtle"> est.</span>}
      </td>
      <td className="px-4 py-1.5 text-right tabular-nums">{money(f.absorbed)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{money(f.unabsorbed)}</td>
    </>
  );
}

export function LabourUtilisation({ params }: { params: ReportParams }) {
  // A cleared month input sends no period; the API would refuse it.
  const hasMonth = Boolean(params.period);
  const { data, error } = useFinancialReport<LabourUtilisationDto>('labour-utilisation', params, hasMonth);
  if (!hasMonth) return <p className="text-sm text-ink-muted">Pick a month.</p>;
  if (!data) {
    return <p className="text-sm text-ink-muted">{error ? (error instanceof Error ? error.message : 'Could not load') : 'Loading…'}</p>;
  }
  const provisional = data.status === 'PROVISIONAL';
  return (
    <div className="space-y-4">
      {provisional && (
        <p role="status" className="flex items-center gap-2 text-sm text-warning">
          <AlertTriangle className="size-4" />
          Provisional — payroll not posted. Costs are estimated at each employee&apos;s estimated rate, not actual payroll.
        </p>
      )}
      {!data.rows.length ? (
        <p className="text-sm text-ink-subtle">No labour in this month.</p>
      ) : (
        <section className="overflow-x-auto rounded border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 text-right font-medium">Standard h</th>
                <th className="px-4 py-2 text-right font-medium">Direct h</th>
                <th className="px-4 py-2 text-right font-medium">Indirect h</th>
                <th className="px-4 py-2 text-right font-medium">Unlogged h</th>
                <th className="px-4 py-2 text-right font-medium">{provisional ? 'Est. cost' : 'Cost'}</th>
                <th className="px-4 py-2 text-right font-medium">Absorbed</th>
                <th className="px-4 py-2 text-right font-medium">Unabsorbed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-4 py-1.5">
                    {r.employeeName} <span className="font-mono text-xs text-ink-subtle">{r.employeeNumber}</span>
                  </td>
                  <FigureCells f={r} provisional={provisional} />
                </tr>
              ))}
              <tr className="font-medium">
                <td className="px-4 py-1.5">Total</td>
                <FigureCells f={data.totals} provisional={provisional} />
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
