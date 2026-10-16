export type { JournalLineDto } from './ledger';
import type { JournalLineDto, JournalReferenceType } from './ledger';
import type { RecurringInterval } from './recurring';

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
  supplierId: string | null;
  supplierName: string | null;
  vendorName: string;
  category: string;
  amount: number;
  currency: string | null;
  billingInterval: RecurringInterval;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string;
  taxCodeId: string | null;
  autoApprove: boolean;
  spreadOverPeriod: boolean;
  financeAccountId?: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  /** Status of the most recent occurrence, for the table badge. */
  lastOccurrenceStatus: 'GENERATED' | 'FAILED' | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringOccurrenceDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  billId: string | null;
  billNumber: string | null;
  status: 'GENERATED' | 'FAILED';
  error: string | null;
  attempts: number;
  createdAt: string;
}

export interface PrepaidScheduleDto {
  id: string;
  billId: string;
  billLineId: string;
  expenseRole: string;
  totalBase: number;
  firstMonth: string;
  months: number;
  releasedMonths: number;
  releasedAmount: number;
  remainingAmount: number;
  status: 'ACTIVE' | 'COMPLETED' | 'ENDED_EARLY';
}

export interface CashForecastMonthDto {
  month: string; // YYYY-MM
  opening: number;
  inflows: number;
  billsOut: number;
  recurringOut: number;
  payrollOut: number;
  /** Pension contributions due to the fund. */
  pensionOut: number;
  closing: number;
}

export interface CashForecastDto {
  baseCurrency: string;
  months: CashForecastMonthDto[];
}

export interface JournalEntryDto {
  id: string;
  tenantId: string;
  entryNumber: string;
  referenceType: JournalReferenceType;
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

/** Renaming an account, or moving the default flag onto it. */
export interface UpdateFinanceAccountPayload {
  name?: string;
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

