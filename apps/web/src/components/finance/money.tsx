/**
 * Money on the finance screens. Every amount is formatted in its own
 * currency, never a default one, and amounts in different currencies are
 * never added together: a total covers one currency, and anything held in
 * another is listed beside it.
 */

export function formatFinanceCurrency(
  amount: number | null | undefined,
  currency: string,
  options?: { decimals?: boolean; compact?: boolean },
): string {
  const decimals = options?.decimals ?? true;
  const compact = options?.compact ?? false;
  const value = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
  const digits = { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 };
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      ...digits,
    }).format(value);
  } catch {
    // No currency yet (still loading) or one Intl does not know: the figure
    // with its code, and never a stray dollar sign.
    const figure = value.toLocaleString('en-US', digits);
    return currency ? `${currency} ${figure}` : figure;
  }
}

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** One total per currency, in the order each currency first appears. */
export function totalsByCurrency<T>(
  items: readonly T[],
  amountOf: (item: T) => number,
  currencyOf: (item: T) => string,
): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const currency = currencyOf(item);
    totals.set(currency, (totals.get(currency) ?? 0) + (Number(amountOf(item)) || 0));
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount: cents(amount) }));
}

/** The base-currency total, and what is held in other currencies, kept apart. */
export function splitByBase(totals: readonly CurrencyTotal[], base: string) {
  return {
    base: totals.find((t) => t.currency === base)?.amount ?? 0,
    others: totals.filter((t) => t.currency !== base),
  };
}

/** "Not in this total: USD 1,200.00 · EUR 300.00", or nothing when every amount was in base. */
export function OtherCurrencies({
  others,
  className,
  'data-testid': testId,
}: {
  others: readonly CurrencyTotal[];
  className?: string;
  'data-testid'?: string;
}) {
  if (others.length === 0) return null;
  return (
    <p data-testid={testId} className={className ?? 'text-xs text-ink-muted'}>
      Not in this total:{' '}
      <span className="tabular-nums">
        {others.map((o) => formatFinanceCurrency(o.amount, o.currency)).join(' · ')}
      </span>
    </p>
  );
}
