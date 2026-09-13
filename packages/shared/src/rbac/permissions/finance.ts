import type { PermissionDomain, PermissionValues } from './domain';

export const FINANCE_PERMISSIONS = {
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  EXPENSE_SUBMIT: 'expense:submit',
  EXPENSE_APPROVE: 'expense:approve',
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
      'Manage bank accounts, budgets and financial operations',
    [FINANCE_PERMISSIONS.EXPENSE_SUBMIT]: 'Submit employee expense claims and receipts',
    [FINANCE_PERMISSIONS.EXPENSE_APPROVE]: 'Approve, reject and reimburse expense claims',
  },
  groupPermissions: [
    FINANCE_PERMISSIONS.FINANCE_READ,
    FINANCE_PERMISSIONS.FINANCE_MANAGE,
    FINANCE_PERMISSIONS.EXPENSE_SUBMIT,
    FINANCE_PERMISSIONS.EXPENSE_APPROVE,
  ],
  grants: {
    admin: [
      FINANCE_PERMISSIONS.FINANCE_READ,
      FINANCE_PERMISSIONS.FINANCE_MANAGE,
      FINANCE_PERMISSIONS.EXPENSE_SUBMIT,
      FINANCE_PERMISSIONS.EXPENSE_APPROVE,
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
