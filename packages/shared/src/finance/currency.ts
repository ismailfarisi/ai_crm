/**
 * Currencies, exchange rates and the arithmetic that keeps the ledger in one.
 *
 * Quotes, invoices, bills, customers and bank accounts have all carried a
 * currency since the start, with no rate anywhere — so a tenant trading in
 * two currencies has been adding pounds to dollars in every total. The ledger
 * is now kept in the organization's base currency. Every document snapshots
 * the rate it was posted at, so a report run next year says what it said
 * today.
 *
 * A rate is always "base per one unit of the foreign currency": with a GBP
 * base, EUR at 0.85 means one euro is 85 pence.
 */

export const RATE_DP = 8;

/** Codes offered in the UI. Any ISO 4217 code is accepted by the API. */
export const COMMON_CURRENCIES = ['GBP', 'EUR', 'USD', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN', 'CAD', 'AUD', 'JPY', 'INR', 'AED'] as const;

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);

export const roundRate = (rate: number): number => Math.round(rate * 10 ** RATE_DP) / 10 ** RATE_DP;

/** An amount in a document currency, in base currency, to the cent. */
export function toBase(amount: number, rate: number): number {
  return cents(amount * rate) / 100;
}

export interface FxConvertibleLine {
  debit: number;
  credit: number;
  /** Overrides the entry's rate for this line: a receivable cleared at the rate it was raised at. */
  fxRate?: number | null;
}

/**
 * Converts journal lines to base currency and says what is left over.
 *
 * Each line is converted at its own rate and rounded to the cent. When every
 * line uses the same rate the leftover is rounding, at most a cent or two.
 * When they do not — a payment received at today's rate against an invoice
 * raised at last month's — the leftover is the exchange gain or loss, and it
 * is real money the business made or lost by waiting.
 *
 * `imbalance` is debits minus credits after conversion. The caller posts it
 * to the exchange gain/loss account so the entry balances.
 */
export function convertLines<T extends FxConvertibleLine>(
  lines: T[],
  entryRate: number,
): { lines: T[]; imbalance: number } {
  let diff = 0;
  const converted = lines.map((line) => {
    const rate = line.fxRate ?? entryRate;
    const debit = toBase(line.debit, rate);
    const credit = toBase(line.credit, rate);
    diff += cents(debit) - cents(credit);
    return { ...line, debit, credit };
  });
  return { lines: converted, imbalance: diff / 100 };
}

/**
 * The line that absorbs an exchange difference.
 *
 * Debits exceeding credits means the entry is short on the credit side: the
 * business received less in base currency than it booked, which is a loss
 * (a debit to the account) — so the balancing line is a credit, and vice versa.
 */
export function fxBalancingLine(imbalance: number): { debit: number; credit: number } | null {
  const c = cents(imbalance);
  if (c === 0) return null;
  return c > 0 ? { debit: 0, credit: c / 100 } : { debit: -c / 100, credit: 0 };
}

/**
 * The adjustment that restates an open foreign balance at a new rate.
 *
 * For a receivable, a higher rate means the customer's debt is worth more in
 * base currency: a gain. For a payable, the same move is a loss. Returns the
 * signed change in the base-currency value of the balance.
 */
export function revaluationDelta(openAmount: number, bookedRate: number, newRate: number): number {
  return toBase(openAmount, newRate) - toBase(openAmount, bookedRate);
}

/** Month-end, as the last calendar day of the month containing `date`, in UTC. */
export function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export interface FxRateDto {
  id: string;
  currency: string;
  rateDate: string;
  rate: number;
  source: string | null;
}

export interface CurrencySettingsDto {
  baseCurrency: string;
  /** False once anything has been posted: changing base would restate every entry. */
  canChangeBaseCurrency: boolean;
  /** Currencies in use on documents or accounts, with the latest rate each has. */
  currencies: { currency: string; latestRate: number | null; latestRateDate: string | null }[];
}

export interface RevaluationResultDto {
  period: string;
  entryNumber: string | null;
  receivables: { documents: number; delta: number };
  payables: { documents: number; delta: number };
  /** Currencies with open balances but no rate on the revaluation date. */
  missingRates: string[];
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export interface StatementLineDto {
  ledgerAccountId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  amount: number;
}

export interface ProfitAndLossDto {
  from: string;
  to: string;
  baseCurrency: string;
  income: StatementLineDto[];
  expenses: StatementLineDto[];
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
}

export interface BalanceSheetDto {
  asOf: string;
  baseCurrency: string;
  assets: StatementLineDto[];
  liabilities: StatementLineDto[];
  equity: StatementLineDto[];
  /** Income less expenses to date, not yet closed into retained earnings. */
  currentEarnings: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  /** Should always be zero. */
  difference: number;
}

export interface ReceivablesAgingRowDto {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  outstanding: number;
  outstandingBase: number;
  dueDate: string | null;
  daysOverdue: number;
  bucket: 'CURRENT' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_OVER_90';
}

export interface ReceivablesAgingDto {
  asOf: string;
  baseCurrency: string;
  rows: ReceivablesAgingRowDto[];
  buckets: Record<ReceivablesAgingRowDto['bucket'], number>;
  total: number;
  /** The receivables account balance, for reconciliation. */
  ledgerBalance: number;
  difference: number;
}

export interface MarginRowDto {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  cost: number;
  margin: number;
  /** Fraction of revenue; null when there is no revenue. */
  marginPct: number | null;
  /** How much of `cost` is measured (completed work orders) rather than quoted. */
  measuredCostShare: number;
}

export interface MarginReportDto {
  from: string;
  to: string;
  baseCurrency: string;
  by: 'customer' | 'template';
  rows: MarginRowDto[];
}
