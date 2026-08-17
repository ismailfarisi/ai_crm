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

export interface CreateFinanceAccountPayload {
  name: string;
  accountType: AccountType;
  currency?: string;
  balance?: number;
  accountNumber?: string | null;
  isDefault?: boolean;
}

export interface TransferFundsPayload {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
}

export interface TransferFundsResult {
  fromAccount: FinanceAccountDto;
  toAccount: FinanceAccountDto;
  journalEntry: JournalEntryDto;
}

export interface CreateCategoryBudgetPayload {
  category: string;
  period: BudgetPeriod;
  budgetAmount: number;
  spentAmount?: number;
  alertThresholdPercent?: number;
  startDate: string;
  endDate: string;
}

export interface CreateRecurringExpensePayload {
  vendorName: string;
  category: string;
  amount: number;
  billingInterval: 'MONTHLY' | 'ANNUAL';
  nextBillingDate: string;
  financeAccountId?: string | null;
  status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
}

export interface CreateExpenseClaimPayload {
  claimNumber?: string;
  employeeId?: string;
  employeeName?: string;
  category: string;
  amount: number;
  currency?: string;
  merchantName?: string | null;
  expenseDate?: string;
  receiptUrl?: string | null;
  items?: ExpenseItemDto[];
  status?: ExpenseStatus;
}

export interface UpdateExpenseClaimPayload {
  employeeId?: string;
  employeeName?: string;
  category?: string;
  amount?: number;
  currency?: string;
  merchantName?: string | null;
  expenseDate?: string;
  receiptUrl?: string | null;
  rejectionReason?: string | null;
  items?: ExpenseItemDto[];
  status?: ExpenseStatus;
}

export interface ScanReceiptPayload {
  imageUrl?: string;
  base64?: string;
  mimeType?: string;
  rawText?: string;
}

export interface ScannedReceiptResult {
  merchantName: string;
  amount: number;
  currency: string;
  expenseDate: string;
  category: string;
  taxAmount?: number;
  confidence: number;
  items: ExpenseItemDto[];
  rawText?: string;
}

export interface SignalExpenseClaimPayload {
  action: 'APPROVE' | 'REJECT' | 'REIMBURSE';
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  accountId?: string;
  reimbursedBy?: string;
  notes?: string;
}

export interface ExpenseListParams {
  page?: number;
  limit?: number;
  status?: ExpenseStatus;
  category?: string;
  employeeId?: string;
  search?: string;
}

