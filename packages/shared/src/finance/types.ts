export const FINANCE_PERMISSIONS = {
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  EXPENSE_SUBMIT: 'expense:submit',
  EXPENSE_APPROVE: 'expense:approve',
} as const;

export type FinancePermission = (typeof FINANCE_PERMISSIONS)[keyof typeof FINANCE_PERMISSIONS];

export type AccountType = 'BANK' | 'CASH' | 'CREDIT_CARD' | 'CLEARING';
export type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID' | 'REJECTED';
export type BudgetPeriod = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface FinanceAccountDto {
  id: string;
  tenantId: string;
  name: string;
  accountType: AccountType;
  currency: string;
  balance: number;
  accountNumber?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseItemDto {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface ExpenseClaimDto {
  id: string;
  tenantId: string;
  claimNumber: string;
  employeeId: string;
  employeeName: string;
  category: string;
  amount: number;
  currency: string;
  status: ExpenseStatus;
  merchantName?: string | null;
  expenseDate: string;
  receiptUrl?: string | null;
  rejectionReason?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  reimbursedAt?: string | null;
  temporalWorkflowId?: string | null;
  items: ExpenseItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryBudgetDto {
  id: string;
  tenantId: string;
  category: string;
  period: BudgetPeriod;
  budgetAmount: number;
  spentAmount: number;
  alertThresholdPercent: number;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpenseDto {
  id: string;
  tenantId: string;
  vendorName: string;
  category: string;
  amount: number;
  billingInterval: 'MONTHLY' | 'ANNUAL';
  nextBillingDate: string;
  financeAccountId?: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export interface JournalLineDto {
  accountId?: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
}

export interface JournalEntryDto {
  id: string;
  tenantId: string;
  entryNumber: string;
  referenceType: 'EXPENSE' | 'INVOICE' | 'TRANSFER' | 'MANUAL';
  referenceId: string;
  entryDate: string;
  lines: JournalLineDto[];
  totalAmount: number;
  createdAt: string;
}

export interface TreasuryOverviewDto {
  totalCash: number;
  currency: string;
  monthlyInflow: number;
  monthlyOutflow: number;
  netCashflow: number;
  monthlyBurnRate: number;
  runwayMonths: number;
  accounts: FinanceAccountDto[];
  recentCashflowSeries: Array<{
    date: string;
    inflow: number;
    outflow: number;
    net: number;
  }>;
}

export function calculateRunwayMonths(totalCash: number, monthlyBurnRate: number): number {
  if (monthlyBurnRate <= 0) return Infinity;
  return Math.round((totalCash / monthlyBurnRate) * 10) / 10;
}
