'use client';

import type { CashForecastDto } from '@saas/shared';
import { Badge, Card, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { formatFinanceCurrency } from '../money';

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The next few months of cash, month by month: what is expected in, what is
 * committed to go out (open supplier bills, recurring expenses, payroll and
 * pension), and what is left at the end of the month. A month that ends below
 * zero is marked, so a shortfall is seen before it arrives.
 */
export function CashForecastTable({ forecast, isLoading }: { forecast?: CashForecastDto | null; isLoading?: boolean }) {
  const months = forecast?.months ?? [];
  const currency = forecast?.baseCurrency;
  const money = (n: number) => formatFinanceCurrency(n, currency ?? '');
  const hasData = months.some(
    (m) => m.inflows || m.billsOut || m.recurringOut || m.payrollOut || m.pensionOut || m.closing,
  );

  return (
    <Card data-testid="cash-forecast">
      <CardHeader>
        <CardTitle id="cash-forecast-title">Cash over the next {months.length || 6} months</CardTitle>
        <p className="mt-0.5 text-xs text-ink-muted">
          Expected in and out{currency ? `, in ${currency}` : ''}. Closing is what is left at the end of each month.
        </p>
      </CardHeader>
      {isLoading ? (
        <div className="space-y-2 px-6 py-5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      ) : !hasData ? (
        <p data-testid="cash-forecast-empty" className="px-6 py-5 text-sm text-ink-muted">
          Nothing expected in or out over the next months.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby="cash-forecast-title" className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-muted text-xs font-semibold uppercase tracking-wider text-ink-muted">
              <tr>
                <th scope="col" className="px-6 py-2.5 text-start">Month</th>
                <th scope="col" className="px-3 py-2.5 text-end">Coming in</th>
                <th scope="col" className="px-3 py-2.5 text-end">Bills</th>
                <th scope="col" className="px-3 py-2.5 text-end">Recurring</th>
                <th scope="col" className="px-3 py-2.5 text-end">Payroll</th>
                <th scope="col" className="px-3 py-2.5 text-end">Pension</th>
                <th scope="col" className="px-6 py-2.5 text-end">Closing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {months.map((m) => (
                <tr key={m.month} data-testid={`forecast-${m.month}`}>
                  <th scope="row" className="px-6 py-3 text-start font-medium text-ink">
                    {monthLabel(m.month)}
                  </th>
                  <td className="px-3 py-3 text-end text-ink">{money(m.inflows)}</td>
                  <td className="px-3 py-3 text-end text-ink-muted">{money(m.billsOut)}</td>
                  <td className="px-3 py-3 text-end text-ink-muted">{money(m.recurringOut)}</td>
                  <td className="px-3 py-3 text-end text-ink-muted">{money(m.payrollOut)}</td>
                  <td className="px-3 py-3 text-end text-ink-muted">{money(m.pensionOut)}</td>
                  <td className="px-6 py-3 text-end font-semibold">
                    {m.closing < 0 && (
                      <Badge tone="danger" className="me-2">
                        Short
                      </Badge>
                    )}
                    <span className={m.closing < 0 ? 'text-danger' : 'text-ink'}>{money(m.closing)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
