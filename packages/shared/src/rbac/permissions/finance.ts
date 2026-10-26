import type { PermissionDomain, PermissionValues } from './domain';

export const FINANCE_PERMISSIONS = {
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  FINANCE_EXPORT: 'finance:export',
  EXPENSE_SUBMIT: 'expense:submit',
  EXPENSE_APPROVE: 'expense:approve',
  JOURNAL_POST: 'journal:post',
  BOOKS_LOCK: 'books:lock',
  LEDGER_MANAGE: 'ledger:manage',
  BANK_RECONCILE: 'bank:reconcile',
} as const;

type FinancePermission = PermissionValues<typeof FINANCE_PERMISSIONS>;

export const financeDomain: PermissionDomain<FinancePermission> = {
  key: 'finance',
  label: 'Finance & Expenses',
  permissions: FINANCE_PERMISSIONS,
  descriptions: {
    [FINANCE_PERMISSIONS.FINANCE_READ]:
      'View financial accounts, treasury and expense reports',
    [FINANCE_PERMISSIONS.FINANCE_MANAGE]:
      'Manage bank accounts, budgets, exchange rates and financial operations',
    [FINANCE_PERMISSIONS.FINANCE_EXPORT]:
      'Download financial statements and reports as CSV',
    [FINANCE_PERMISSIONS.EXPENSE_SUBMIT]: 'Submit employee expense claims and receipts',
    [FINANCE_PERMISSIONS.EXPENSE_APPROVE]: 'Approve, reject and reimburse expense claims',
    [FINANCE_PERMISSIONS.JOURNAL_POST]:
      'Post and reverse manual journal entries: accruals, depreciation, corrections',
    [FINANCE_PERMISSIONS.BOOKS_LOCK]:
      'Lock the books through a date, or reopen them, so nothing posts into a closed period',
    [FINANCE_PERMISSIONS.LEDGER_MANAGE]: 'Add, rename and retire accounts in the chart of accounts',
    [FINANCE_PERMISSIONS.BANK_RECONCILE]:
      'Import bank statements and reconcile them against the ledger',
  },
  groupPermissions: [
    FINANCE_PERMISSIONS.FINANCE_READ,
    FINANCE_PERMISSIONS.FINANCE_MANAGE,
    FINANCE_PERMISSIONS.FINANCE_EXPORT,
    FINANCE_PERMISSIONS.EXPENSE_SUBMIT,
    FINANCE_PERMISSIONS.EXPENSE_APPROVE,
    FINANCE_PERMISSIONS.JOURNAL_POST,
    FINANCE_PERMISSIONS.BOOKS_LOCK,
    FINANCE_PERMISSIONS.LEDGER_MANAGE,
    FINANCE_PERMISSIONS.BANK_RECONCILE,
  ],
  grants: {
    // Closing the books and posting journals are an accountant's job, so they
    // stop at admin; a manager approves spending but does not restate it.
    admin: [
      FINANCE_PERMISSIONS.FINANCE_READ,
      FINANCE_PERMISSIONS.FINANCE_MANAGE,
      FINANCE_PERMISSIONS.FINANCE_EXPORT,
      FINANCE_PERMISSIONS.EXPENSE_SUBMIT,
      FINANCE_PERMISSIONS.EXPENSE_APPROVE,
      FINANCE_PERMISSIONS.JOURNAL_POST,
      FINANCE_PERMISSIONS.BOOKS_LOCK,
      FINANCE_PERMISSIONS.LEDGER_MANAGE,
      FINANCE_PERMISSIONS.BANK_RECONCILE,
    ],
    manager: [
      FINANCE_PERMISSIONS.FINANCE_READ,
      FINANCE_PERMISSIONS.EXPENSE_SUBMIT,
      FINANCE_PERMISSIONS.EXPENSE_APPROVE,
    ],
    member: [FINANCE_PERMISSIONS.EXPENSE_SUBMIT],
    viewer: [FINANCE_PERMISSIONS.FINANCE_READ],
  },
};
