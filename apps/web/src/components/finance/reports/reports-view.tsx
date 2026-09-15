'use client';

import { useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import {
  PERMISSIONS,
  type BalanceSheetDto,
  type MarginReportDto,
  type ProfitAndLossDto,
  type ReceivablesAgingDto,
  type StatementLineDto,
  type TrialBalanceDto,
} from '@saas/shared';
import { downloadReportCsv, useFinancialReport } from '@/hooks/use-platform';
import type { FinancialReport, ReportParams } from '@/lib/api/endpoints';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/primitives';
import { FinanceNav } from '../finance-nav';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => d.toISOString().slice(0, 10);

const TABS: { key: FinancialReport; label: string; range: 'period' | 'asOf' }[] = [
  { key: 'profit-and-loss', label: 'Profit & loss', range: 'period' },
  { key: 'balance-sheet', label: 'Balance sheet', range: 'asOf' },
  { key: 'trial-balance', label: 'Trial balance', range: 'asOf' },
  { key: 'receivables-aging', label: 'Receivables aging', range: 'asOf' },
  { key: 'margins', label: 'Margins', range: 'period' },
];

export function ReportsView() {
  const [tab, setTab] = useState<FinancialReport>('profit-and-loss');
  const [from, setFrom] = useState(`${new Date().getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [asOf, setAsOf] = useState(iso(new Date()));
  const [by, setBy] = useState<'customer' | 'template'>('customer');
  const canExport = useCan({ permission: PERMISSIONS.FINANCE_EXPORT });
  const canSeeMargins = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });

  const current = TABS.find((t) => t.key === tab)!;
  const params: ReportParams = current.range === 'period' ? { from, to, ...(tab === 'margins' ? { by } : {}) } : { asOf };
  const tabs = TABS.filter((t) => t.key !== 'margins' || canSeeMargins);

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Statements read straight off the ledger, in base currency." />
      <FinanceNav />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded px-3 py-1.5 text-sm ${tab === t.key ? 'bg-ink text-surface' : 'text-ink-muted hover:bg-surface-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {current.range === 'period' ? (
            <>
              <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-ink" />
              <span>to</span>
              <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-ink" />
            </>
          ) : (
            <label className="flex items-center gap-2">
              As at
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-ink" />
            </label>
          )}
          {tab === 'margins' && (
            <select value={by} onChange={(e) => setBy(e.target.value as 'customer' | 'template')} aria-label="Group by" className="rounded border border-line bg-surface px-2 py-1 text-ink">
              <option value="customer">By customer</option>
              <option value="template">By template</option>
            </select>
          )}
          {canExport && (
            <Button size="sm" variant="secondary" onClick={() => downloadReportCsv(tab, params)}>
              <Download className="size-4" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {tab === 'profit-and-loss' && <ProfitAndLoss params={params} />}
      {tab === 'balance-sheet' && <BalanceSheet params={params} />}
      {tab === 'trial-balance' && <TrialBalance params={params} />}
      {tab === 'receivables-aging' && <ReceivablesAging params={params} />}
      {tab === 'margins' && <Margins params={params} />}
    </div>
  );
}

function Loading({ error }: { error: unknown }) {
  return <p className="text-sm text-ink-muted">{error ? (error instanceof Error ? error.message : 'Could not load') : 'Loading…'}</p>;
}

function Section({ title, lines, total, totalLabel }: { title: string; lines: StatementLineDto[]; total: number; totalLabel: string }) {
  return (
    <section className="rounded border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2 text-sm font-medium text-ink">{title}</h2>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {lines.map((l) => (
            <tr key={l.ledgerAccountId}>
              <td className="w-16 px-4 py-1.5 font-mono text-xs text-ink-subtle">{l.code}</td>
              <td className="px-2 py-1.5 text-ink">{l.name}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(l.amount)}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <td />
            <td className="px-2 py-1.5">{totalLabel}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{money(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function ProfitAndLoss({ params }: { params: ReportParams }) {
  const { data, error } = useFinancialReport<ProfitAndLossDto>('profit-and-loss', params);
  if (!data) return <Loading error={error} />;
  return (
    <div className="space-y-4">
      <Section title="Income" lines={data.income} total={data.totalIncome} totalLabel="Total income" />
      <Section title="Expenses" lines={data.expenses} total={data.totalExpenses} totalLabel="Total expenses" />
      <p className="rounded bg-surface-sunk px-4 py-3 text-lg font-semibold tabular-nums text-ink">
        Net {data.netProfit >= 0 ? 'profit' : 'loss'}: {money(Math.abs(data.netProfit))} {data.baseCurrency}
      </p>
    </div>
  );
}

function BalanceSheet({ params }: { params: ReportParams }) {
  const { data, error } = useFinancialReport<BalanceSheetDto>('balance-sheet', params);
  if (!data) return <Loading error={error} />;
  const equity = [...data.equity];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Assets" lines={data.assets} total={data.totalAssets} totalLabel="Total assets" />
      <div className="space-y-4">
        <Section title="Liabilities" lines={data.liabilities} total={data.liabilities.reduce((s, l) => s + l.amount, 0)} totalLabel="Total liabilities" />
        <Section
          title="Equity"
          lines={equity}
          total={data.totalLiabilitiesAndEquity - data.liabilities.reduce((s, l) => s + l.amount, 0)}
          totalLabel={`Total equity (incl. ${money(data.currentEarnings)} current earnings)`}
        />
      </div>
      {data.difference !== 0 && (
        <p className="flex items-center gap-2 text-sm text-danger lg:col-span-2">
          <AlertTriangle className="size-4" />
          Assets and liabilities plus equity differ by {money(data.difference)}.
        </p>
      )}
    </div>
  );
}

function TrialBalance({ params }: { params: ReportParams }) {
  const { data, error } = useFinancialReport<TrialBalanceDto>('trial-balance', params);
  if (!data) return <Loading error={error} />;
  return (
    <section className="overflow-x-auto rounded border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-subtle">
          <tr>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Account</th>
            <th className="px-4 py-2 text-right font-medium">Debit</th>
            <th className="px-4 py-2 text-right font-medium">Credit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.rows.map((r) => (
            <tr key={r.ledgerAccountId}>
              <td className="px-4 py-1.5 font-mono text-xs">{r.code}</td>
              <td className="px-4 py-1.5">{r.name}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(r.debit)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(r.credit)}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <td />
            <td className="px-4 py-1.5">Total{data.difference !== 0 ? ` — out by ${money(data.difference)}` : ''}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{money(data.totalDebit)}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{money(data.totalCredit)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function ReceivablesAging({ params }: { params: ReportParams }) {
  const { data, error } = useFinancialReport<ReceivablesAgingDto>('receivables-aging', params);
  if (!data) return <Loading error={error} />;
  const labels: Record<string, string> = { CURRENT: 'Not yet due', DAYS_1_30: '1–30', DAYS_31_60: '31–60', DAYS_61_90: '61–90', DAYS_OVER_90: 'Over 90' };
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(data.buckets).map(([k, v]) => (
          <div key={k} className="rounded bg-surface-sunk px-3 py-2">
            <dt className="text-xs text-ink-subtle">{labels[k]}</dt>
            <dd className={`text-sm font-medium tabular-nums ${k !== 'CURRENT' && v > 0 ? 'text-danger' : 'text-ink'}`}>{money(v)}</dd>
          </div>
        ))}
      </dl>
      {data.difference !== 0 && (
        <p className="flex items-center gap-2 text-sm text-warning">
          <AlertTriangle className="size-4" />
          Invoices total {money(data.total)} but the receivables account holds {money(data.ledgerBalance)}. A month-end
          revaluation or a pre-ledger payment accounts for a difference like this.
        </p>
      )}
      <section className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-subtle">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 text-right font-medium">Outstanding</th>
              <th className="px-4 py-2 text-right font-medium">{data.baseCurrency}</th>
              <th className="px-4 py-2 text-right font-medium">Days overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((r) => (
              <tr key={r.invoiceId}>
                <td className="px-4 py-1.5 font-mono text-xs">{r.invoiceNumber}</td>
                <td className="px-4 py-1.5">{r.customerName}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {money(r.outstanding)} {r.currency}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">{money(r.outstandingBase)}</td>
                <td className={`px-4 py-1.5 text-right tabular-nums ${r.daysOverdue > 0 ? 'text-danger' : ''}`}>{r.daysOverdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Margins({ params }: { params: ReportParams }) {
  const { data, error } = useFinancialReport<MarginReportDto>('margins', params);
  if (!data) return <Loading error={error} />;
  if (!data.rows.length) return <p className="text-sm text-ink-subtle">No sales orders in this period.</p>;
  return (
    <section className="overflow-x-auto rounded border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-subtle">
          <tr>
            <th className="px-4 py-2 font-medium">{data.by === 'customer' ? 'Customer' : 'Template'}</th>
            <th className="px-4 py-2 text-right font-medium">Orders</th>
            <th className="px-4 py-2 text-right font-medium">Revenue</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
            <th className="px-4 py-2 text-right font-medium">Margin</th>
            <th className="px-4 py-2 text-right font-medium">Measured</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.rows.map((r) => (
            <tr key={r.key}>
              <td className="px-4 py-1.5">{r.label}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{r.orders}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(r.revenue)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(r.cost)}</td>
              <td className={`px-4 py-1.5 text-right tabular-nums ${r.margin < 0 ? 'text-danger' : ''}`}>
                {money(r.margin)}
                {r.marginPct != null && <span className="text-ink-subtle"> ({(r.marginPct * 100).toFixed(1)}%)</span>}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-subtle" title="Share of cost from completed work orders rather than quotes">
                {(r.measuredCostShare * 100).toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
