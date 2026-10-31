'use client';

import Link from 'next/link';
import type { AccountType, FinanceAccountDto } from '@saas/shared';
import { Card, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { formatFinanceCurrency, OtherCurrencies, splitByBase, totalsByCurrency } from '../money';

const TYPE_LABEL: Record<AccountType, string> = {
  BANK: 'Bank',
  CASH: 'Cash',
  CREDIT_CARD: 'Credit card',
  CLEARING: 'Clearing',
};

/**
 * Every bank and cash account with its balance in its own currency. The total
 * row adds only the base-currency accounts; balances in other currencies are
 * listed under it rather than added in, since there is no rate to add them at.
 */
export function CashByAccount({
  accounts,
  base,
  isLoading,
}: {
  accounts: readonly FinanceAccountDto[];
  base: string | undefined;
  isLoading?: boolean;
}) {
  const split = base ? splitByBase(totalsByCurrency(accounts, (a) => a.balance, (a) => a.currency), base) : null;

  return (
    <Card data-testid="cash-by-account">
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle id="cash-by-account-title">Cash by account</CardTitle>
        <Link href="/finance/accounts" className="text-sm font-medium text-ink underline underline-offset-2 hover:text-ink-muted">
          Manage accounts
        </Link>
      </CardHeader>
      {isLoading || !split ? (
        <div className="space-y-2 px-6 py-5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      ) : accounts.length === 0 ? (
        <p className="px-6 py-5 text-sm text-ink-muted">
          No accounts yet.{' '}
          <Link href="/finance/accounts" className="font-medium text-ink underline underline-offset-2">
            Add your bank and petty cash
          </Link>{' '}
          to see what you hold.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby="cash-by-account-title" className="w-full text-sm">
            <thead className="bg-surface-muted text-xs font-semibold uppercase tracking-wider text-ink-muted">
              <tr>
                <th scope="col" className="px-6 py-2.5 text-start">Account</th>
                <th scope="col" className="px-3 py-2.5 text-start">Type</th>
                <th scope="col" className="px-6 py-2.5 text-end">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((a) => (
                <tr key={a.id} data-testid={`cash-row-${a.id}`}>
                  <td className="px-6 py-3 text-ink">
                    {a.name}
                    {a.isDefault && <span className="ms-2 text-xs text-ink-subtle">default</span>}
                  </td>
                  <td className="px-3 py-3 text-ink-muted">{TYPE_LABEL[a.accountType] ?? a.accountType}</td>
                  <td className={`px-6 py-3 text-end tabular-nums ${a.balance < 0 ? 'text-danger' : 'text-ink'}`}>
                    {formatFinanceCurrency(a.balance, a.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border-strong">
              <tr>
                <th scope="row" colSpan={2} className="px-6 py-3 text-start font-semibold text-ink">
                  Total in {base}
                </th>
                <td data-testid="cash-total" className="px-6 py-3 text-end font-semibold tabular-nums text-ink">
                  {formatFinanceCurrency(split.base, base!)}
                </td>
              </tr>
            </tfoot>
          </table>
          <OtherCurrencies others={split.others} className="px-6 pb-4 text-xs text-ink-muted" />
        </div>
      )}
    </Card>
  );
}
