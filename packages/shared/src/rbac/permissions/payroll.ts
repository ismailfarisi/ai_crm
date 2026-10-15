import type { PermissionDomain, PermissionValues } from './domain';

export const PAYROLL_PERMISSIONS = {
  EMPLOYEE_READ: 'employee:read',
  EMPLOYEE_MANAGE: 'employee:manage',
  PAYROLL_READ: 'payroll:read',
  PAYROLL_MANAGE: 'payroll:manage',
  PAYROLL_APPROVE: 'payroll:approve',
  PAYROLL_PAY: 'payroll:pay',
} as const;

type PayrollPermission = PermissionValues<typeof PAYROLL_PERMISSIONS>;

export const payrollDomain: PermissionDomain<PayrollPermission> = {
  key: 'payroll',
  label: 'People & payroll',
  permissions: PAYROLL_PERMISSIONS,
  descriptions: {
    [PAYROLL_PERMISSIONS.EMPLOYEE_READ]: 'View the staff directory: names, titles, departments and status — not pay',
    [PAYROLL_PERMISSIONS.EMPLOYEE_MANAGE]: 'Add and edit employees, their documents and bank details',
    [PAYROLL_PERMISSIONS.PAYROLL_READ]: 'View salaries, payroll runs, payslips, gratuity and advances',
    [PAYROLL_PERMISSIONS.PAYROLL_MANAGE]: 'Prepare payroll runs, enter monthly extras and record salary changes',
    [PAYROLL_PERMISSIONS.PAYROLL_APPROVE]: 'Approve or void payroll runs and post gratuity opening balances',
    [PAYROLL_PERMISSIONS.PAYROLL_PAY]: 'Pay approved payroll runs and record salary advances',
  },
  groupPermissions: Object.values(PAYROLL_PERMISSIONS),
  grants: {
    admin: Object.values(PAYROLL_PERMISSIONS),
    // Pay is private: managers see who works here, not what they earn.
    manager: [PAYROLL_PERMISSIONS.EMPLOYEE_READ],
    member: [],
    viewer: [],
  },
};
