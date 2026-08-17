import { condition, proxyActivities, setHandler } from '@temporalio/workflow';
import type * as activities from './activities/expense.activities';
import {
  approveExpenseSignal,
  rejectExpenseSignal,
  reimburseExpenseSignal,
  getExpenseWorkflowStateQuery,
  ExpenseWorkflowInput,
  ExpenseWorkflowResult,
  ExpenseWorkflowState,
  ApproveExpenseSignalPayload,
  RejectExpenseSignalPayload,
  ReimburseExpenseSignalPayload,
} from './interfaces';

const {
  postJournalEntryActivity,
  updateBudgetSpendActivity,
  emitFinanceEventActivity,
  deductAccountBalanceActivity,
  updateExpenseStatusActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Temporal Workflow: Orchestrates the end-to-end lifecycle of an expense claim.
 * - Checks auto-approval threshold ($50 default or custom threshold)
 * - Listens for approve/reject signals with SLA timeout (7 days default)
 * - Auto-posts double-entry JournalEntry on approval
 * - Emits EXPENSE_APPROVED / EXPENSE_REJECTED events to event bridge
 * - Updates CategoryBudget spentAmount
 * - Listens for reimburseExpenseSignal to disburse funds from finance accounts
 */
export async function expenseApprovalWorkflow(
  input: ExpenseWorkflowInput,
): Promise<ExpenseWorkflowResult> {
  let isApproved = false;
  let isRejected = false;
  let isReimbursed = false;
  let isAutoApproved = false;
  let approvedBy: string | undefined;
  let rejectedBy: string | undefined;
  let rejectionReason: string | undefined;
  let reimbursementAccountId: string | undefined;
  let reimbursedBy: string | undefined;
  let status: string = 'SUBMITTED';
  let journalEntryId: string | undefined;
  let reimbursementJournalEntryId: string | undefined;

  // 1. Register signal handlers
  setHandler(approveExpenseSignal, (payload?: ApproveExpenseSignalPayload | string | void) => {
    if (typeof payload === 'string') {
      approvedBy = payload;
    } else if (payload && typeof payload === 'object') {
      approvedBy = payload.approvedBy;
    }
    isApproved = true;
  });

  setHandler(rejectExpenseSignal, (payload?: RejectExpenseSignalPayload | string | void) => {
    if (typeof payload === 'string') {
      rejectionReason = payload;
    } else if (payload && typeof payload === 'object') {
      rejectedBy = payload.rejectedBy;
      rejectionReason = payload.reason || rejectionReason;
    }
    isRejected = true;
  });

  setHandler(reimburseExpenseSignal, (payload?: ReimburseExpenseSignalPayload | string | void) => {
    if (typeof payload === 'string') {
      reimbursementAccountId = payload;
    } else if (payload && typeof payload === 'object') {
      reimbursementAccountId = payload.accountId;
      reimbursedBy = payload.reimbursedBy;
    }
    isReimbursed = true;
  });

  // 2. Register query handler
  setHandler(getExpenseWorkflowStateQuery, (): ExpenseWorkflowState => ({
    expenseId: input.expenseId,
    tenantId: input.tenantId,
    status,
    amount: input.amount,
    category: input.category,
    employeeId: input.employeeId,
    approvedBy: approvedBy || (isAutoApproved ? 'SYSTEM_AUTO_APPROVE' : undefined),
    rejectionReason,
    isAutoApproved,
    paidFromAccountId: reimbursementAccountId,
  }));

  // 3. Auto-approval check
  const threshold = input.autoApproveThreshold ?? 50;
  if (input.amount <= threshold) {
    isAutoApproved = true;
    isApproved = true;
    approvedBy = 'SYSTEM_AUTO_APPROVE';
  } else {
    status = 'SUBMITTED';
    await updateExpenseStatusActivity({
      expenseId: input.expenseId,
      tenantId: input.tenantId,
      status: 'SUBMITTED',
    });

    await emitFinanceEventActivity({
      tenantId: input.tenantId,
      event: 'EXPENSE_SUBMITTED',
      payload: {
        expenseId: input.expenseId,
        amount: input.amount,
        category: input.category,
        employeeId: input.employeeId,
      },
    });

    // Wait for manual approval, rejection, or SLA timeout
    const conditionMet = await condition(
      () => isApproved || isRejected,
      input.slaDuration || '7 days',
    );

    if (!conditionMet && !isApproved && !isRejected) {
      isRejected = true;
      rejectionReason = `Approval timed out after SLA duration (${input.slaDuration || '7 days'})`;
    }
  }

  // 4. Handle Rejection / Timeout
  if (isRejected) {
    status = 'REJECTED';
    await updateExpenseStatusActivity({
      expenseId: input.expenseId,
      tenantId: input.tenantId,
      status: 'REJECTED',
      rejectionReason,
    });

    await emitFinanceEventActivity({
      tenantId: input.tenantId,
      event: 'EXPENSE_REJECTED',
      payload: {
        expenseId: input.expenseId,
        reason: rejectionReason,
        rejectedBy,
      },
    });

    return {
      status: 'REJECTED',
      expenseId: input.expenseId,
      reason: rejectionReason,
      isAutoApproved: false,
    };
  }

  // 5. Handle Approval
  status = 'APPROVED';
  await updateExpenseStatusActivity({
    expenseId: input.expenseId,
    tenantId: input.tenantId,
    status: 'APPROVED',
    approvedById: approvedBy || (isAutoApproved ? 'SYSTEM_AUTO_APPROVE' : undefined),
    approvedAt: new Date(),
  });

  const journalResult = await postJournalEntryActivity({
    tenantId: input.tenantId,
    referenceType: 'EXPENSE',
    referenceId: input.expenseId,
    lines: [
      {
        accountName: input.category || 'Operating Expense',
        debit: input.amount,
        credit: 0,
        description: `Expense claim ${input.expenseId} - ${input.category}`,
      },
      {
        accountName: 'Accounts Payable',
        debit: 0,
        credit: input.amount,
        description: `Payable for expense ${input.expenseId}`,
      },
    ],
    totalAmount: input.amount,
  });
  journalEntryId = journalResult.id;

  await updateBudgetSpendActivity({
    tenantId: input.tenantId,
    category: input.category,
    amount: input.amount,
  });

  await emitFinanceEventActivity({
    tenantId: input.tenantId,
    event: 'EXPENSE_APPROVED',
    payload: {
      expenseId: input.expenseId,
      amount: input.amount,
      category: input.category,
      employeeId: input.employeeId,
      approvedBy: approvedBy || (isAutoApproved ? 'SYSTEM_AUTO_APPROVE' : undefined),
      isAutoApproved,
      journalEntryId,
    },
  });

  // 6. Reimbursement Stage
  const reimbursementTriggered = await condition(
    () => isReimbursed,
    input.reimbursementTimeout || '30 days',
  );

  if (isReimbursed || reimbursementTriggered) {
    status = 'PAID';
    await deductAccountBalanceActivity({
      tenantId: input.tenantId,
      accountId: reimbursementAccountId,
      amount: input.amount,
      currency: input.currency || 'USD',
      description: `Reimbursement payout for expense ${input.expenseId}`,
    });

    const reimburseJournalResult = await postJournalEntryActivity({
      tenantId: input.tenantId,
      referenceType: 'EXPENSE',
      referenceId: input.expenseId,
      lines: [
        {
          accountName: 'Accounts Payable',
          debit: input.amount,
          credit: 0,
          description: `Settlement of payable for expense ${input.expenseId}`,
        },
        {
          accountName: 'Bank Account',
          debit: 0,
          credit: input.amount,
          description: `Cash disbursement for expense ${input.expenseId}`,
        },
      ],
      totalAmount: input.amount,
    });
    reimbursementJournalEntryId = reimburseJournalResult.id;

    await updateExpenseStatusActivity({
      expenseId: input.expenseId,
      tenantId: input.tenantId,
      status: 'PAID',
      reimbursedAt: new Date(),
    });

    await emitFinanceEventActivity({
      tenantId: input.tenantId,
      event: 'EXPENSE_PAID',
      payload: {
        expenseId: input.expenseId,
        amount: input.amount,
        paidFromAccountId: reimbursementAccountId,
        reimbursedBy,
        journalEntryId: reimbursementJournalEntryId,
      },
    });

    return {
      status: 'PAID',
      expenseId: input.expenseId,
      journalEntryId,
      reimbursementJournalEntryId,
      paidFromAccountId: reimbursementAccountId,
      isAutoApproved,
    };
  }

  return {
    status: 'APPROVED',
    expenseId: input.expenseId,
    journalEntryId,
    approvedBy: approvedBy || (isAutoApproved ? 'SYSTEM_AUTO_APPROVE' : undefined),
    isAutoApproved,
  };
}
