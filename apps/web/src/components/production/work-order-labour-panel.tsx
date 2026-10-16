import type { LabourStatus, WorkOrderLabourDto } from '@saas/shared';
import { Badge } from '@/components/ui/primitives';

const STATUS_CHIP: Record<LabourStatus, { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' }> = {
  ACTUAL: { label: 'Actual', tone: 'success' },
  PROVISIONAL: { label: 'Provisional — waiting on payroll', tone: 'warning' },
  MIXED: { label: 'Actual + standard', tone: 'info' },
  STANDARD: { label: 'Standard rates', tone: 'neutral' },
};

const ROW_STATUS = { ACTUAL: 'Actual', PROVISIONAL: 'Provisional' } as const;

const MASKED_HINT = 'Needs cost and payroll access';

const hours = (n: number) => String(Math.round(n * 100) / 100);
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A figure the API withheld shows a dash and says why; it is never rendered as 0. */
function Figure({ value, format = money }: { value: number | null; format?: (n: number) => string }) {
  if (value === null) {
    return (
      <span title={MASKED_HINT} aria-label={MASKED_HINT} data-testid="masked">
        —
      </span>
    );
  }
  return <>{format(value)}</>;
}

/**
 * Labour on a job, one row per employee and status (one employee can have actual and
 * provisional hours at once). Hidden when the API sends no labour (list views, no access).
 */
export function WorkOrderLabourPanel({ labour }: { labour: WorkOrderLabourDto | null }) {
  if (!labour) return null;
  const chip = labour.status ? STATUS_CHIP[labour.status] : null;
  const totals: [string, number | null][] = [
    ['Actual', labour.actual],
    ['Provisional', labour.provisional],
    ['Unlinked', labour.unlinked],
    ['Total', labour.total],
  ];

  return (
    <section aria-labelledby="drawer-labour-title" data-testid="labour-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="drawer-labour-title" className="text-sm font-semibold text-ink">
          Labour
        </h3>
        {chip && (
          <Badge tone={chip.tone} data-testid="labour-status">
            {chip.label}
          </Badge>
        )}
      </div>

      {labour.byEmployee.length === 0 && labour.unlinkedHours <= 0 ? (
        <p className="text-xs text-ink-muted">No labour recorded on this job yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-subtle">
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-2 py-2 text-right font-medium">Hours</th>
                <th className="px-2 py-2 text-right font-medium">Rate</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {labour.byEmployee.map((row) => (
                <tr key={`${row.employeeId}:${row.status}`} className="border-t border-line/60" data-testid="labour-row">
                  <td className="px-3 py-2 text-ink">{row.employeeName}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{hours(row.hours)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <Figure value={row.rate} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <Figure value={row.amount} />
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{ROW_STATUS[row.status]}</td>
                </tr>
              ))}
              {labour.unlinkedHours > 0 && (
                <tr className="border-t border-line/60" data-testid="labour-unlinked">
                  <td className="px-3 py-2 text-ink">
                    Unlinked clock time
                    <span className="block text-[11px] text-ink-subtle">
                      Clock time from users not linked to an employee, at the standard rate
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{hours(labour.unlinkedHours)}</td>
                  <td className="px-2 py-2 text-right text-ink-subtle">—</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <Figure value={labour.unlinked} />
                  </td>
                  <td className="px-3 py-2 text-ink-muted">Standard</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {labour.total !== null && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" data-testid="labour-totals">
          {totals.map(([label, value]) => (
            <div key={label}>
              <dt className="text-ink-subtle">{label}</dt>
              <dd className="font-medium tabular-nums text-ink">{value === null ? '—' : money(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
