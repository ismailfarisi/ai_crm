'use client';

import React from 'react';
import type { ExpenseClaimDto } from '@saas/shared';
import {
  describeExcluded,
  formatExpenseCurrency,
  summariseClaims,
  type BaseCurrencyTotal,
} from './expense-money';

function SummaryCell({
  label,
  total,
  baseCurrency,
  'data-testid': testId,
}: {
  label: string;
  total: BaseCurrencyTotal | null;
  baseCurrency: string | undefined;
  'data-testid': string;
}) {
  const excluded = total ? describeExcluded(total) : null;
  return (
    <div data-testid={testId} className="px-5 py-4">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p data-testid={`${testId}-amount`} className="mt-1 text-lg font-semibold tabular-nums text-ink">
        {total && baseCurrency ? formatExpenseCurrency(total.amount, baseCurrency) : '—'}
      </p>
      <p data-testid={`${testId}-caption`} className="mt-0.5 text-xs text-ink-muted tabular-nums">
        {total ? `${total.count} ${total.count === 1 ? 'claim' : 'claims'}` : 'Loading…'}
        {excluded && <span className="block">{excluded}</span>}
      </p>
    </div>
  );
}

/**
 * The one row of figures over the claims list, in the base currency. Claims in
 * another currency are counted but not added in, and the caption says so.
 */
export function ExpenseSummary({
  claims,
  baseCurrency,
  now,
}: {
  claims: readonly ExpenseClaimDto[];
  baseCurrency: string | undefined;
  now?: Date;
}) {
  const summary = baseCurrency ? summariseClaims(claims, baseCurrency, now) : null;
  return (
    <section
      aria-label="Expense claim totals"
      data-testid="expense-summary"
      className="grid grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      <SummaryCell
        label="Waiting for review"
        total={summary?.pending ?? null}
        baseCurrency={baseCurrency}
        data-testid="stat-pending"
      />
      <SummaryCell
        label="Approved, not paid"
        total={summary?.approvedUnpaid ?? null}
        baseCurrency={baseCurrency}
        data-testid="stat-approved-unpaid"
      />
      <SummaryCell
        label="Paid this month"
        total={summary?.paidThisMonth ?? null}
        baseCurrency={baseCurrency}
        data-testid="stat-paid-month"
      />
    </section>
  );
}
