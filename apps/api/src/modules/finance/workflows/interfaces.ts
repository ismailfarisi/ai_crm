import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { ExpenseStatus, ExpenseItemDto, JournalLineDto } from '@saas/shared';

export interface ExpenseWorkflowInput {
  expenseId: string;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  category: string;
  amount: number;
  currency?: string;
  autoApproveThreshold?: number;
  slaDuration?: string;
  reimbursementTimeout?: string;
  items?: ExpenseItemDto[];
  merchantName?: string;
}

export interface ExpenseWorkflowResult {
  status: ExpenseStatus | string;
  expenseId: string;
  journalEntryId?: string;
  reimbursementJournalEntryId?: string;
  reason?: string;
  approvedBy?: string;
  paidFromAccountId?: string;
  isAutoApproved?: boolean;
}

export interface ExpenseWorkflowState {
  expenseId: string;
  tenantId: string;
  status: ExpenseStatus | string;
  amount: number;
  category: string;
  employeeId: string;
  approvedBy?: string;
  rejectionReason?: string;
  isAutoApproved: boolean;
  paidFromAccountId?: string;
}

export interface ApproveExpenseSignalPayload {
  approvedBy?: string;
  notes?: string;
}

export interface RejectExpenseSignalPayload {
  rejectedBy?: string;
  reason?: string;
}

export interface ReimburseExpenseSignalPayload {
  accountId?: string;
  reimbursedBy?: string;
  notes?: string;
}

export interface PostJournalEntryParams {
  tenantId: string;
  referenceType: 'EXPENSE' | 'INVOICE' | 'TRANSFER' | 'MANUAL';
  referenceId: string;
  entryDate?: string | Date;
  lines: JournalLineDto[];
  totalAmount: number;
}

export interface PostJournalEntryResult {
  id: string;
  entryNumber: string;
  success: boolean;
  totalAmount: number;
}

export interface UpdateBudgetSpendParams {
  tenantId: string;
  category: string;
  amount: number;
}

export interface UpdateBudgetSpendResult {
  success: boolean;
  category: string;
  amountAdded: number;
  spentAmount?: number;
  budgetExceeded?: boolean;
}

export interface EmitFinanceEventParams {
  tenantId: string;
  event: 'EXPENSE_SUBMITTED' | 'EXPENSE_APPROVED' | 'EXPENSE_REJECTED' | 'EXPENSE_PAID' | 'BUDGET_THRESHOLD_REACHED' | 'CASH_RESERVE_DEFICIT' | string;
  payload: Record<string, any>;
}

export interface EmitFinanceEventResult {
  emitted: boolean;
  event: string;
  timestamp: string;
}

export interface DeductAccountBalanceParams {
  tenantId: string;
  accountId?: string;
  amount: number;
  currency?: string;
  description?: string;
}

export interface DeductAccountBalanceResult {
  success: boolean;
  accountId?: string;
  amountDeducted: number;
  newBalance?: number;
}

export interface UpdateExpenseStatusParams {
  expenseId: string;
  tenantId: string;
  status: ExpenseStatus | string;
  rejectionReason?: string | null;
  approvedById?: string | null;
  approvedAt?: string | Date | null;
  reimbursedAt?: string | Date | null;
}

export interface UpdateExpenseStatusResult {
  success: boolean;
  expenseId: string;
  status: string;
}

export const approveExpenseSignal = defineSignal<[ApproveExpenseSignalPayload | string | void]>('approveExpense');
export const rejectExpenseSignal = defineSignal<[RejectExpenseSignalPayload | string | void]>('rejectExpense');
export const reimburseExpenseSignal = defineSignal<[ReimburseExpenseSignalPayload | string | void]>('reimburseExpense');
export const getExpenseWorkflowStateQuery = defineQuery<ExpenseWorkflowState>('getExpenseWorkflowState');
