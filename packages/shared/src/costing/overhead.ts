/**
 * One overhead rate for the whole shop, worked out from the books.
 *
 * A template's overhead used to be a percentage someone typed and nobody
 * checked. The books already know both halves of it: what the shop spent on
 * running itself (rent, utilities, salaries not charged to jobs, insurance…)
 * and what it spent directly on jobs (cost of sales). Overhead ÷ direct cost
 * over the last few full months is the rate that would have recovered those
 * overheads, and that is what is suggested. Nothing changes until a person
 * accepts it, types their own, or ignores it.
 *
 * Pure, so the arithmetic is tested here and the API only gathers figures.
 */

/** Fewer full months than this and a rate would mostly be noise. */
export const OVERHEAD_MIN_MONTHS = 3;
export const OVERHEAD_MAX_MONTHS = 12;
export const OVERHEAD_DEFAULT_MONTHS = 6;

export type OverheadSuggestionStatus =
  /** A rate can be suggested. */
  | 'READY'
  /** Fewer than three full months on the books. */
  | 'NOT_ENOUGH_HISTORY'
  /** Nothing reached cost of sales, so there is nothing to divide by. */
  | 'NO_DIRECT_COST'
  /** No running costs were booked (or all were unticked). */
  | 'NO_OVERHEAD'
  /** Overheads exceed direct cost — almost always job costs not reaching cost of sales. */
  | 'ABOVE_100';

export interface OverheadLedgerAccount {
  code: string;
  name: string;
  /** Running cost of the shop, or direct cost of jobs. */
  kind: 'OVERHEAD' | 'DIRECT';
  role: string | null;
  /** Debit minus credit per `YYYY-MM`, in base currency. */
  byMonth: Record<string, number>;
}

export interface OverheadAccountLine {
  code: string;
  name: string;
  role: string | null;
  amount: number;
  /** False when the owner unticked it. Direct accounts are always included. */
  included: boolean;
}

export interface OverheadMonth {
  /** `YYYY-MM`. */
  month: string;
  overhead: number;
  direct: number;
}

export interface OverheadSuggestion {
  status: OverheadSuggestionStatus;
  monthsAsked: number;
  /** The full months the figures cover, oldest first. */
  monthsCounted: string[];
  /** First and last day covered (`YYYY-MM-DD`), or null when no month counts. */
  from: string | null;
  to: string | null;
  /** Day of the first posting on the books, or null for an empty ledger. */
  booksStart: string | null;
  /** When `NOT_ENOUGH_HISTORY`: the first day a suggestion becomes possible. */
  availableFrom: string | null;
  overheadAccounts: OverheadAccountLine[];
  directAccounts: OverheadAccountLine[];
  overheadTotal: number;
  directTotal: number;
  /** Overhead ÷ direct cost, 4dp, or null when it cannot be worked out. */
  ratePct: number | null;
  /** `ratePct` rounded to a tenth of a percent; null unless `READY`. */
  suggestedPct: number | null;
  byMonth: OverheadMonth[];
  /** Plain-words caveats the owner should read before accepting. */
  notes: string[];
}

/** What was accepted, kept on the policy so the rate can explain itself later. */
export interface OverheadRateBasis {
  from: string;
  to: string;
  months: string[];
  overheadTotal: number;
  directTotal: number;
  excludedAccountCodes: string[];
  currency: string;
}

export interface OverheadSuggestionInput {
  /** Today; only months that have fully ended count. */
  today: Date;
  months: number;
  /** Earliest posting on the books, or null if there is none. */
  firstPosting: Date | null;
  accounts: OverheadLedgerAccount[];
  excludeAccountCodes?: string[];
}

const LABOUR_ABSORBED_ROLE = 'LABOUR_ABSORBED';
const SALARIES_ROLE = 'SALARIES';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** `YYYY-MM` of a UTC date. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function addMonths(year: number, monthIndex: number, delta: number): Date {
  return new Date(Date.UTC(year, monthIndex + delta, 1));
}

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The full months on the books the suggestion may use, oldest first. */
export function overheadWindow(
  today: Date,
  months: number,
  firstPosting: Date | null,
): { counted: string[]; firstFullMonth: string | null } {
  const asked = Math.min(OVERHEAD_MAX_MONTHS, Math.max(1, Math.floor(months)));
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const window: string[] = [];
  for (let back = asked; back >= 1; back--) window.push(monthKey(addMonths(y, m, -back)));

  if (!firstPosting) return { counted: [], firstFullMonth: null };
  // A month the books start part-way through would be missing its rent or
  // its payroll, so it is left out.
  const fy = firstPosting.getUTCFullYear();
  const fm = firstPosting.getUTCMonth();
  const firstFullMonth = monthKey(addMonths(fy, fm, firstPosting.getUTCDate() === 1 ? 0 : 1));
  return { counted: window.filter((month) => month >= firstFullMonth), firstFullMonth };
}

export function suggestOverheadRate(input: OverheadSuggestionInput): OverheadSuggestion {
  const monthsAsked = Math.min(OVERHEAD_MAX_MONTHS, Math.max(OVERHEAD_MIN_MONTHS, Math.floor(input.months)));
  const excluded = new Set(input.excludeAccountCodes ?? []);
  const { counted, firstFullMonth } = overheadWindow(input.today, monthsAsked, input.firstPosting);

  const sumOver = (account: OverheadLedgerAccount) =>
    round2(counted.reduce((sum, month) => sum + (account.byMonth[month] ?? 0), 0));

  const line = (account: OverheadLedgerAccount): OverheadAccountLine => ({
    code: account.code,
    name: account.name,
    role: account.role,
    amount: sumOver(account),
    included: account.kind === 'DIRECT' || !excluded.has(account.code),
  });

  const sorted = [...input.accounts].sort((a, b) => a.code.localeCompare(b.code));
  const overheadAccounts = sorted
    .filter((a) => a.kind === 'OVERHEAD')
    .map(line)
    // Keep an unticked account visible even at zero, so it can be ticked back.
    .filter((l) => l.amount !== 0 || !l.included);
  const directAccounts = sorted.filter((a) => a.kind === 'DIRECT').map(line).filter((l) => l.amount !== 0);

  const included = sorted.filter((a) => a.kind === 'DIRECT' || !excluded.has(a.code));
  const byMonth: OverheadMonth[] = counted.map((month) => ({
    month,
    overhead: round2(
      included.filter((a) => a.kind === 'OVERHEAD').reduce((s, a) => s + (a.byMonth[month] ?? 0), 0),
    ),
    direct: round2(
      included.filter((a) => a.kind === 'DIRECT').reduce((s, a) => s + (a.byMonth[month] ?? 0), 0),
    ),
  }));
  const overheadTotal = round2(byMonth.reduce((s, m) => s + m.overhead, 0));
  const directTotal = round2(byMonth.reduce((s, m) => s + m.direct, 0));
  const ratePct = directTotal > 0 && overheadTotal > 0 ? Math.round((overheadTotal / directTotal) * 10_000) / 10_000 : null;

  const notes: string[] = [];
  const booksStart = input.firstPosting ? input.firstPosting.toISOString().slice(0, 10) : null;
  let availableFrom: string | null = null;

  let status: OverheadSuggestionStatus;
  if (counted.length < OVERHEAD_MIN_MONTHS) {
    status = 'NOT_ENOUGH_HISTORY';
    if (firstFullMonth) {
      const [fy, fm] = firstFullMonth.split('-').map(Number);
      availableFrom = addMonths(fy, fm - 1, OVERHEAD_MIN_MONTHS).toISOString().slice(0, 10);
    }
  } else if (directTotal <= 0) {
    status = 'NO_DIRECT_COST';
  } else if (overheadTotal <= 0) {
    status = 'NO_OVERHEAD';
  } else if (overheadTotal > directTotal) {
    status = 'ABOVE_100';
  } else {
    status = 'READY';
  }

  if (counted.length > 0 && counted.length < monthsAsked && firstFullMonth && counted[0] === firstFullMonth) {
    notes.push(
      `Your books only have ${counted.length} full month${counted.length === 1 ? '' : 's'}, so the figures use those.`,
    );
  }
  if (input.firstPosting && input.firstPosting.getUTCDate() !== 1 && counted.length > 0) {
    notes.push(`Your books start part-way through ${monthKey(input.firstPosting)}, so that month is left out.`);
  }

  const salaries = overheadAccounts.find((a) => a.role === SALARIES_ROLE && a.included);
  const absorbed = overheadAccounts.find((a) => a.role === LABOUR_ABSORBED_ROLE && a.included);
  if (salaries && salaries.amount > 0 && (!absorbed || absorbed.amount === 0)) {
    notes.push(
      'No payroll was charged to jobs in these months, so every salary counts as overhead. If your workshop staff are already priced through work-centre hourly rates, untick Salaries & wages or their time is charged twice.',
    );
  }
  if (status === 'ABOVE_100') {
    notes.push(
      'Overheads are more than direct cost. That usually means materials are not being issued to jobs or payroll is not charged to jobs yet, so cost of sales is too small. Check those before setting a rate this high.',
    );
  }

  return {
    status,
    monthsAsked,
    monthsCounted: counted,
    from: counted.length ? `${counted[0]}-01` : null,
    to: counted.length ? lastDayOf(counted[counted.length - 1]) : null,
    booksStart,
    availableFrom,
    overheadAccounts,
    directAccounts,
    overheadTotal,
    directTotal,
    ratePct,
    suggestedPct: status === 'READY' && ratePct !== null ? Math.round(ratePct * 1000) / 1000 : null,
    byMonth,
    notes,
  };
}

/** The suggestion as the Overhead rate screen gets it. */
export interface OverheadSuggestionDto extends OverheadSuggestion {
  currency: string;
  /** The shop rate in force now, 0-1. */
  currentPct: number;
  templates: {
    /** Current templates that follow the shop rate. */
    usingShopRate: Array<{ id: string; name: string }>;
    /** Current templates with a percentage of their own, which the shop rate does not change. */
    ownRate: Array<{ id: string; name: string; overheadPct: number }>;
  };
}
