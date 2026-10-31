import type { ExpenseClaimDto, FinanceAccountDto } from '@saas/shared';

/**
 * An amount in the currency it was spent in. There is no default currency:
 * a claim always carries its own, and guessing one would put the wrong symbol
 * on real money. Without a currency the figure is shown bare.
 */
export function formatExpenseCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  const value = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  const bare = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  if (!currency) return bare;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // A code Intl does not know still says what the money is.
    return `${currency} ${bare}`;
  }
}

export interface BaseCurrencyTotal {
  /** Every claim in the group, whatever its currency. */
  count: number;
  /** The sum of the claims in the base currency only. */
  amount: number;
  /** Claims in other currencies, left out of `amount` rather than added at face value. */
  excluded: { currency: string; count: number }[];
}

/**
 * Totals claims in the base currency. A claim carries no converted amount
 * until it posts, so one in another currency is counted but not added: adding
 * USD 100 to AED 100 as 200 of anything would be a wrong number.
 */
export function totalInBaseCurrency(
  claims: readonly ExpenseClaimDto[],
  baseCurrency: string,
): BaseCurrencyTotal {
  let amount = 0;
  const other = new Map<string, number>();
  for (const claim of claims) {
    const currency = claim.currency || baseCurrency;
    if (currency === baseCurrency) {
      amount += Number(claim.amount) || 0;
    } else {
      other.set(currency, (other.get(currency) ?? 0) + 1);
    }
  }
  return {
    count: claims.length,
    amount: Math.round(amount * 100) / 100,
    excluded: [...other.entries()]
      .map(([currency, count]) => ({ currency, count }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/** "Leaves out 1 in USD, 2 in EUR", or null when nothing was left out. */
export function describeExcluded(total: BaseCurrencyTotal): string | null {
  if (total.excluded.length === 0) return null;
  return `Leaves out ${total.excluded.map((e) => `${e.count} in ${e.currency}`).join(', ')}`;
}

export interface ClaimSummary {
  pending: BaseCurrencyTotal;
  approvedUnpaid: BaseCurrencyTotal;
  paidThisMonth: BaseCurrencyTotal;
}

/** What is waiting for review, what is owed, and what went out this month. */
export function summariseClaims(
  claims: readonly ExpenseClaimDto[],
  baseCurrency: string,
  now: Date = new Date(),
): ClaimSummary {
  const paidThisMonth = claims.filter((claim) => {
    if (claim.status !== 'PAID') return false;
    const paidOn = new Date(claim.reimbursedAt || claim.updatedAt);
    return paidOn.getFullYear() === now.getFullYear() && paidOn.getMonth() === now.getMonth();
  });
  return {
    pending: totalInBaseCurrency(
      claims.filter((c) => c.status === 'SUBMITTED'),
      baseCurrency,
    ),
    approvedUnpaid: totalInBaseCurrency(
      claims.filter((c) => c.status === 'APPROVED'),
      baseCurrency,
    ),
    paidThisMonth: totalInBaseCurrency(paidThisMonth, baseCurrency),
  };
}

/**
 * The account a reimbursement is paid from when none is named: the default,
 * else the oldest. The same choice the API makes, so the confirmation names
 * the account the money will actually leave.
 */
export function reimbursementAccount(
  accounts: readonly FinanceAccountDto[] | null | undefined,
): FinanceAccountDto | null {
  if (!accounts || accounts.length === 0) return null;
  return (
    [...accounts].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })[0] ?? null
  );
}
