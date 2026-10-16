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
  OPENING_BALANCE_EQUITY: 'OPENING_BALANCE_EQUITY',
  SALES: 'SALES',
  COGS: 'COGS',
  OPERATING_EXPENSE: 'OPERATING_EXPENSE',
  PREPAID_EXPENSES: 'PREPAID_EXPENSES',
  RENT: 'RENT',
  UTILITIES: 'UTILITIES',
  SALARIES: 'SALARIES',
  EMPLOYEE_ADVANCES: 'EMPLOYEE_ADVANCES',
  SALARIES_PAYABLE: 'SALARIES_PAYABLE',
  GRATUITY_PROVISION: 'GRATUITY_PROVISION',
  GRATUITY_EXPENSE: 'GRATUITY_EXPENSE',
  REPAIRS: 'REPAIRS',
  INSURANCE: 'INSURANCE',
  TRAVEL: 'TRAVEL',
  SOFTWARE_IT: 'SOFTWARE_IT',
  MARKETING: 'MARKETING',
  PROFESSIONAL_FEES: 'PROFESSIONAL_FEES',
  BANK_CHARGES: 'BANK_CHARGES',
  FX_GAIN_LOSS: 'FX_GAIN_LOSS',
} as const;

export type LedgerRole = (typeof LEDGER_ROLES)[keyof typeof LEDGER_ROLES];

export interface SystemLedgerAccount {
  code: string;
  name: string;
  type: LedgerAccountType;
  role: LedgerRole;
  description: string;
  /** Code of the system account this one rolls up into on the P&L. */
  parentCode?: string;
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
    code: '1400',
    name: 'Prepaid expenses',
    type: 'ASSET',
    role: LEDGER_ROLES.PREPAID_EXPENSES,
    description: 'Paid or billed ahead for a period not yet used — an annual lease, a yearly policy. Released to expense one month at a time.',
  },
  { code: '1450', name: 'Employee advances', type: 'ASSET', role: LEDGER_ROLES.EMPLOYEE_ADVANCES, description: 'Salary advances paid to employees and not yet recovered through payroll' },
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
  { code: '2300', name: 'Salaries payable', type: 'LIABILITY', role: LEDGER_ROLES.SALARIES_PAYABLE, description: 'Net pay from approved payroll runs not yet paid' },
  { code: '2400', name: 'End-of-service provision', type: 'LIABILITY', role: LEDGER_ROLES.GRATUITY_PROVISION, description: 'End-of-service gratuity earned by employees to date' },
  {
    code: '3000',
    name: 'Retained earnings',
    type: 'EQUITY',
    role: LEDGER_ROLES.RETAINED_EARNINGS,
    description: 'Accumulated result of prior periods',
  },
  {
    code: '3100',
    name: 'Opening balance equity',
    type: 'EQUITY',
    role: LEDGER_ROLES.OPENING_BALANCE_EQUITY,
    description:
      'Contra for balances a tenant brought in from their previous system. A cash account opened with a starting figure debits the bank and credits this, so the books balance without inventing a transaction that never happened. An accountant clears it to retained earnings or capital once the opening position is agreed.',
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
    name: 'Other operating expense',
    type: 'EXPENSE',
    role: LEDGER_ROLES.OPERATING_EXPENSE,
    description: 'Overheads with no account of their own. Parent of the overhead accounts below.',
  },
  { code: '6100', name: 'Rent & premises', type: 'EXPENSE', role: LEDGER_ROLES.RENT, parentCode: '6000', description: 'Rent, service charges and premises costs' },
  { code: '6200', name: 'Utilities & telecom', type: 'EXPENSE', role: LEDGER_ROLES.UTILITIES, parentCode: '6000', description: 'Electricity, water, cooling, internet and phones' },
  { code: '6300', name: 'Salaries & wages', type: 'EXPENSE', role: LEDGER_ROLES.SALARIES, parentCode: '6000', description: 'Payroll, allowances and contractors' },
  { code: '6310', name: 'End-of-service gratuity', type: 'EXPENSE', role: LEDGER_ROLES.GRATUITY_EXPENSE, parentCode: '6000', description: 'Monthly change in the end-of-service provision' },
  { code: '6400', name: 'Repairs & maintenance', type: 'EXPENSE', role: LEDGER_ROLES.REPAIRS, parentCode: '6000', description: 'Upkeep of premises, plant and machinery' },
  { code: '6450', name: 'Insurance', type: 'EXPENSE', role: LEDGER_ROLES.INSURANCE, parentCode: '6000', description: 'Insurance premiums' },
  { code: '6500', name: 'Travel & entertainment', type: 'EXPENSE', role: LEDGER_ROLES.TRAVEL, parentCode: '6000', description: 'Travel, lodging, meals and entertainment' },
  { code: '6600', name: 'Software & IT', type: 'EXPENSE', role: LEDGER_ROLES.SOFTWARE_IT, parentCode: '6000', description: 'Software subscriptions, hosting and IT equipment below the capitalisation threshold' },
  { code: '6700', name: 'Marketing', type: 'EXPENSE', role: LEDGER_ROLES.MARKETING, parentCode: '6000', description: 'Advertising and marketing' },
  { code: '6800', name: 'Professional fees', type: 'EXPENSE', role: LEDGER_ROLES.PROFESSIONAL_FEES, parentCode: '6000', description: 'Accounting, legal and consulting fees' },
  { code: '6900', name: 'Bank charges', type: 'EXPENSE', role: LEDGER_ROLES.BANK_CHARGES, parentCode: '6000', description: 'Bank and payment processing fees' },
  {
    code: '7000',
    name: 'Exchange gains and losses',
    type: 'EXPENSE',
    role: LEDGER_ROLES.FX_GAIN_LOSS,
    description: 'Differences between the rate a document was booked at and the rate it settled or was revalued at. A credit balance is a net gain.',
  },
];

/** The overhead roles that roll up into 6000 Other operating expense. */
export const OPERATING_EXPENSE_CHILD_ROLES: LedgerRole[] = SYSTEM_LEDGER_ACCOUNTS
  .filter((a) => a.parentCode === '6000')
  .map((a) => a.role);

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
  /** A specific account from the chart, e.g. the one a tax code posts to. */
  ledgerAccountId?: string | null;
  /**
   * Base currency per unit of the entry's currency, for this line only —
   * when a receivable is cleared at the rate it was raised at while the cash
   * arrives at today's. Defaults to the entry's rate.
   */
  fxRate?: number | null;
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

/**
 * What a journal entry was caused by.
 *
 * Declared in full ahead of use: 'BILL', 'WORK_ORDER' and 'CREDIT_NOTE' have
 * nothing posting to them until later sprints, but the database enum carries
 * them already so those sprints need not alter the type again.
 */
export type JournalReferenceType =
  | 'EXPENSE'
  | 'INVOICE'
  | 'TRANSFER'
  | 'MANUAL'
  | 'STOCK'
  | 'BILL'
  | 'WORK_ORDER'
  | 'CREDIT_NOTE'
  | 'PREPAID'
  | 'PAYROLL';

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
