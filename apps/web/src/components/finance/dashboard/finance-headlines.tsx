'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { AgingReportDto, FinanceAccountDto, ReceivablesAgingDto } from '@saas/shared';
import { Card, Skeleton } from '@/components/ui/primitives';
import { useFinancialReport } from '@/hooks/use-platform';
import { useBillAging } from '@/hooks/use-bills';
import { useVatReturn } from '@/hooks/use-books';
import { useTaxReport, useUaeVatStatus } from '@/hooks/use-credits';
import { formatFinanceCurrency, OtherCurrencies, splitByBase, totalsByCurrency } from '../money';
import { currentTaxRange, formatTaxRange, type TaxRange } from '../tax/vat-period';

const DAY = 24 * 60 * 60 * 1000;
const isoToday = () => new Date().toISOString().slice(0, 10);

/* ---------------- figures ---------------- */

/** Cash held in base currency, with anything in other currencies kept apart. */
export function summariseCash(accounts: readonly FinanceAccountDto[], base: string) {
  const split = splitByBase(
    totalsByCurrency(accounts, (a) => a.balance, (a) => a.currency),
    base,
  );
  return { ...split, baseAccounts: accounts.filter((a) => a.currency === base).length };
}

/** What customers owe, and how much of it is past due, from the receivables aging report. */
export function summariseReceivables(report: ReceivablesAgingDto) {
  const overdueRows = report.rows.filter((r) => r.bucket !== 'CURRENT');
  return {
    total: report.total,
    overdue: Math.round((report.total - (report.buckets.CURRENT ?? 0)) * 100) / 100,
    overdueCount: overdueRows.length,
    invoiceCount: report.rows.length,
  };
}

/**
 * What is owed to suppliers, past due, and falling due in the next week, from
 * the bills aging report. Its totals are in base currency at each bill's
 * booked rate.
 */
export function summarisePayables(report: AgingReportDto, now: Date = new Date()) {
  const weekOut = now.getTime() + 7 * DAY;
  const overdue = report.bills.filter((b) => b.bucket !== 'CURRENT');
  const dueThisWeek = report.bills.filter(
    (b) => b.bucket === 'CURRENT' && b.dueDate !== null && new Date(b.dueDate).getTime() <= weekOut,
  );
  const base = (b: AgingReportDto['bills'][number]) => b.outstandingBase ?? b.outstanding;
  const sum = (rows: AgingReportDto['bills']) => Math.round(rows.reduce((s, b) => s + base(b), 0) * 100) / 100;
  return {
    total: report.total,
    overdue: Math.round((report.total - (report.buckets.CURRENT ?? 0)) * 100) / 100,
    overdueCount: overdue.length,
    dueThisWeek: sum(dueThisWeek),
    dueThisWeekCount: dueThisWeek.length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------------- tile ---------------- */

function Headline({
  id,
  title,
  figure,
  children,
  href,
  linkLabel,
  isLoading,
  error,
}: {
  id: string;
  title: string;
  figure?: string;
  children?: ReactNode;
  href: string;
  linkLabel: string;
  isLoading?: boolean;
  error?: string | null;
}) {
  return (
    <Card data-testid={`headline-${id}`} className="flex flex-col">
      <section aria-labelledby={`headline-${id}-title`} className="flex h-full flex-col gap-1 px-5 py-4">
        <h2 id={`headline-${id}-title`} className="text-sm font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {isLoading ? (
          <div className="space-y-2 py-1" aria-busy="true">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-44" />
          </div>
        ) : error ? (
          <p className="text-sm text-ink-muted">{error}</p>
        ) : (
          <>
            <p data-testid={`headline-${id}-figure`} className="text-xl font-semibold tracking-tight text-ink tabular-nums">
              {figure}
            </p>
            <div className="space-y-0.5 text-xs text-ink-muted">{children}</div>
          </>
        )}
        <Link
          href={href}
          className="mt-auto self-start pt-3 text-sm font-medium text-ink underline underline-offset-2 hover:text-ink-muted"
        >
          {linkLabel}
        </Link>
      </section>
    </Card>
  );
}

/* ---------------- the four ---------------- */

export function CashHeadline({
  accounts,
  base,
  isLoading,
}: {
  accounts: readonly FinanceAccountDto[];
  base: string | undefined;
  isLoading?: boolean;
}) {
  const cash = base ? summariseCash(accounts, base) : null;
  return (
    <Headline
      id="cash"
      title="Cash"
      isLoading={isLoading || !cash}
      figure={cash ? formatFinanceCurrency(cash.base, base!) : undefined}
      href="/finance/accounts"
      linkLabel="See accounts"
    >
      {cash && (
        <>
          <p>
            {accounts.length === 0
              ? 'No bank or cash accounts yet.'
              : `In ${plural(cash.baseAccounts, `${base} account`)}.`}
          </p>
          <OtherCurrencies others={cash.others} className="text-xs text-ink-muted" data-testid="cash-other-currencies" />
        </>
      )}
    </Headline>
  );
}

export function ReceivablesHeadline() {
  const { data, isLoading, isError } = useFinancialReport<ReceivablesAgingDto>('receivables-aging', { asOf: isoToday() });
  const r = data ? summariseReceivables(data) : null;
  return (
    <Headline
      id="receivables"
      title="Customers owe you"
      isLoading={isLoading}
      error={isError ? 'Could not load what customers owe.' : null}
      figure={r && data ? formatFinanceCurrency(r.total, data.baseCurrency) : undefined}
      href="/finance/reports?report=receivables-aging"
      linkLabel="See receivables aging"
    >
      {r && data && (
        <>
          <p>On {plural(r.invoiceCount, 'unpaid invoice')}.</p>
          {r.overdueCount > 0 ? (
            <p data-testid="receivables-overdue" className="font-medium text-danger tabular-nums">
              {formatFinanceCurrency(r.overdue, data.baseCurrency)} overdue on {plural(r.overdueCount, 'invoice')}
            </p>
          ) : (
            r.invoiceCount > 0 && <p>Nothing overdue.</p>
          )}
        </>
      )}
    </Headline>
  );
}

/**
 * VAT for the period today falls in. In UAE VAT mode this is box 14 of the
 * VAT201; otherwise it is the tax report's net figure. Both link to the Tax
 * page opened on the same period, so the figure can be checked line by line.
 */
export function VatHeadline({ base }: { base: string | undefined }) {
  const status = useUaeVatStatus();
  if (status.isLoading) {
    return <Headline id="vat" title="VAT due" isLoading href="/finance/tax" linkLabel="See the VAT return" />;
  }
  const range = currentTaxRange(status.data?.settings);
  return status.data?.enabled === true ? <Vat201Headline range={range} /> : <TaxReportHeadline range={range} base={base} />;
}

const taxHref = (range: TaxRange) => `/finance/tax?from=${range.from}&to=${range.to}`;

function Vat201Headline({ range }: { range: TaxRange }) {
  const vat = useVatReturn(range.from, range.to);
  const payable = vat.data?.payableTax ?? 0;
  return (
    <Headline
      id="vat"
      title={payable < 0 ? 'VAT refund due' : 'VAT due'}
      isLoading={vat.isLoading}
      error={vat.isError ? 'Could not work out the VAT return. The Tax page says why.' : null}
      // The return is always in AED, whatever the base currency.
      figure={vat.data ? formatFinanceCurrency(Math.abs(payable), 'AED') : undefined}
      href={taxHref(range)}
      linkLabel="See the VAT return"
    >
      <p>VAT201 for {formatTaxRange(range)}, so far.</p>
      {vat.data && vat.data.warnings.length > 0 && (
        <p className="font-medium text-warning">{plural(vat.data.warnings.length, 'thing')} to check before filing</p>
      )}
    </Headline>
  );
}

function TaxReportHeadline({ range, base }: { range: TaxRange; base: string | undefined }) {
  const report = useTaxReport(range.from, range.to);
  const net = report.data?.netPayable ?? 0;
  return (
    <Headline
      id="vat"
      title={net < 0 ? 'Tax to reclaim' : 'Tax due'}
      isLoading={report.isLoading || !base}
      error={report.isError ? 'Could not load the tax report.' : null}
      figure={report.data && base ? formatFinanceCurrency(Math.abs(net), base) : undefined}
      href={taxHref(range)}
      linkLabel="See the tax report"
    >
      <p>For {formatTaxRange(range)}, so far.</p>
    </Headline>
  );
}

export function PayablesHeadline({ base }: { base: string | undefined }) {
  const { data, isLoading, isError } = useBillAging();
  const p = data ? summarisePayables(data) : null;
  return (
    <Headline
      id="payables"
      title="Bills to pay"
      isLoading={isLoading || !base}
      error={isError ? 'Could not load supplier bills.' : null}
      figure={p && base ? formatFinanceCurrency(p.total, base) : undefined}
      href="/purchasing/bills"
      linkLabel="See supplier bills"
    >
      {p && base && (
        <>
          {p.overdueCount > 0 && (
            <p data-testid="payables-overdue" className="font-medium text-danger tabular-nums">
              {formatFinanceCurrency(p.overdue, base)} overdue on {plural(p.overdueCount, 'bill')}
            </p>
          )}
          {p.dueThisWeekCount > 0 ? (
            <p className="tabular-nums">
              {formatFinanceCurrency(p.dueThisWeek, base)} due in the next 7 days
            </p>
          ) : (
            p.overdueCount === 0 && <p>Nothing due in the next 7 days.</p>
          )}
        </>
      )}
    </Headline>
  );
}
