/**
 * The chart of accounts.
 *
 * Before this existed, `journal_entries.lines` carried account *names* as
 * free text — `'Accounts Receivable'`, `'Bank Account'`, or whatever an
 * expense's category happened to be called. Nothing could be reported off
 * that, nothing reconciled, and two spellings of the same account were two
 * accounts. Every line now resolves to a `ledger_accounts` row.
 */

export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

/**
 * Which side increases the balance.
 *
 * Assets and expenses are debit-normal; liabilities, equity and income are
 * credit-normal. A trial balance is the sum of (debit − credit) across every
 * line, which is zero when the books are consistent regardless of normal
 * balance — but reports need the sign to present a figure the right way up.
 */
export const NORMAL_BALANCE: Record<LedgerAccountType, 'DEBIT' | 'CREDIT'> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
};

/**
 * The accounts the system itself posts to.
 *
 * A role is a stable handle: call sites and Temporal workflows name a role,
 * never a code or an id, so the codes can be renumbered for a tenant's own
 * chart without touching code. Roles are also what the backfill maps the old
 * free-text names onto.
 */
export const LEDGER_ROLES = {
  CASH: 'CASH',
  ACCOUNTS_RECEIVABLE: 'ACCOUNTS_RECEIVABLE',
  INVENTORY: 'INVENTORY',
  GRNI: 'GRNI',
  WIP: 'WIP',
  ACCOUNTS_PAYABLE: 'ACCOUNTS_PAYABLE',
  TAX_PAYABLE: 'TAX_PAYABLE',
  RETAINED_EARNINGS: 'RETAINED_EARNINGS',
  SALES: 'SALES',
  COGS: 'COGS',
  OPERATING_EXPENSE: 'OPERATING_EXPENSE',
} as const;

export type LedgerRole = (typeof LEDGER_ROLES)[keyof typeof LEDGER_ROLES];

export interface SystemLedgerAccount {
  code: string;
  name: string;
  type: LedgerAccountType;
  role: LedgerRole;
  description: string;
}

/**
 * Seeded for every tenant at signup, in this order.
 *
 * Deliberately small. These are the accounts the application posts to on its
 * own; a tenant's accountant can add as many of their own as they like
 * alongside them. Several are unused until later sprints — inventory and
 * GRNI have nothing posting to them until goods receipt exists — and are
 * seeded now so that the chart does not have to be migrated again to
 * introduce them.
 */
export const SYSTEM_LEDGER_ACCOUNTS: SystemLedgerAccount[] = [
  {
    code: '1000',
    name: 'Cash and bank',
    type: 'ASSET',
    role: LEDGER_ROLES.CASH,
    description: 'Parent of the individual bank, cash and card accounts',
  },
  {
    code: '1100',
    name: 'Accounts receivable',
    type: 'ASSET',
    role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
    description: 'Invoiced to customers and not yet paid',
  },
  {
    code: '1200',
    name: 'Inventory',
    type: 'ASSET',
    role: LEDGER_ROLES.INVENTORY,
    description: 'Raw stock on hand, at moving-average cost',
  },
  {
    code: '1250',
    name: 'Goods received not invoiced',
    type: 'LIABILITY',
    role: LEDGER_ROLES.GRNI,
    description: 'Received from a supplier, awaiting their bill',
  },
  {
    code: '1300',
    name: 'Work in progress',
    type: 'ASSET',
    role: LEDGER_ROLES.WIP,
    description: 'Materials and labour issued to jobs not yet complete',
  },
  {
    code: '2100',
    name: 'Accounts payable',
    type: 'LIABILITY',
    role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
    description: 'Owed to suppliers and employees',
  },
  {
    code: '2200',
    name: 'Tax payable',
    type: 'LIABILITY',
    role: LEDGER_ROLES.TAX_PAYABLE,
    description: 'Sales tax collected and not yet remitted',
  },
  {
    code: '3000',
    name: 'Retained earnings',
    type: 'EQUITY',
    role: LEDGER_ROLES.RETAINED_EARNINGS,
    description: 'Accumulated result of prior periods',
  },
  {
    code: '4000',
    name: 'Sales',
    type: 'INCOME',
    role: LEDGER_ROLES.SALES,
    description: 'Revenue from invoiced work',
  },
  {
    code: '5000',
    name: 'Cost of goods sold',
    type: 'EXPENSE',
    role: LEDGER_ROLES.COGS,
    description: 'Materials and labour consumed by completed work',
  },
  {
    code: '6000',
    name: 'Operating expense',
    type: 'EXPENSE',
    role: LEDGER_ROLES.OPERATING_EXPENSE,
    description: 'Overheads and employee expense claims',
  },
];

/** The code a cash account's own ledger account is numbered from. */
export const CASH_ACCOUNT_CODE_PREFIX = '10';

export interface LedgerAccountDto {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  role: LedgerRole | null;
  parentId: string | null;
  /** System accounts cannot be renamed away from their role or deleted. */
  isSystem: boolean;
  isActive: boolean;
  description: string | null;
}

/* ------------------------------------------------------------------ *
 * Journal lines
 * ------------------------------------------------------------------ */

/**
 * A line as a caller states it.
 *
 * Callers name a `role`, or a `financeAccountId` when the line moves a
 * specific bank balance. They never name a ledger account id, because the
 * Temporal workflows that post the expense entries are deterministic and
 * cannot read the database — resolution happens in the service.
 */
export interface JournalLineInput {
  role?: LedgerRole;
  financeAccountId?: string;
  /** Human label, kept verbatim — an expense category, a bank's name. */
  accountName: string;
  debit: number;
  credit: number;
  description: string;
}

/** A line as it is stored, after resolution. */
export interface JournalLineDto {
  ledgerAccountId: string;
  ledgerAccountCode: string;
  financeAccountId?: string | null;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
}

export interface TrialBalanceRowDto {
  ledgerAccountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  debit: number;
  credit: number;
  /** Signed so that a debit-normal account with a debit balance reads positive. */
  balance: number;
}

export interface TrialBalanceDto {
  rows: TrialBalanceRowDto[];
  totalDebit: number;
  totalCredit: number;
  /** `totalDebit - totalCredit`. Anything other than zero is a bug, not a rounding. */
  difference: number;
}

/** Sums a set of lines the way a trial balance does, for tests and guards. */
export function journalDifference(lines: Pick<JournalLineDto, 'debit' | 'credit'>[]): number {
  const total = lines.reduce((sum, l) => sum + (l.debit ?? 0) - (l.credit ?? 0), 0);
  // Lines are stored at 2dp; fold the float error rather than exposing it.
  return Math.round(total * 100) / 100;
}

export function isBalanced(lines: Pick<JournalLineDto, 'debit' | 'credit'>[]): boolean {
  return journalDifference(lines) === 0;
}
