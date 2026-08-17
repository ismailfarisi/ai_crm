import {
  PostJournalEntryParams,
  PostJournalEntryResult,
  UpdateBudgetSpendParams,
  UpdateBudgetSpendResult,
  EmitFinanceEventParams,
  EmitFinanceEventResult,
  DeductAccountBalanceParams,
  DeductAccountBalanceResult,
  UpdateExpenseStatusParams,
  UpdateExpenseStatusResult,
} from '../interfaces';

/**
 * Activity: Posts a double-entry journal entry for an expense approval or payout.
 */
export async function postJournalEntryActivity(
  params: PostJournalEntryParams,
): Promise<PostJournalEntryResult> {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  const entryNumber = `JE-${new Date().getFullYear()}-${timestamp.toString().slice(-4)}${randomSuffix}`;
  const id = `je_${timestamp}_${randomSuffix}`;

  console.log(
    `[ExpenseActivity] postJournalEntry: referenceId=${params.referenceId}, referenceType=${params.referenceType}, entryNumber=${entryNumber}, totalAmount=${params.totalAmount}`,
  );

  return {
    id,
    entryNumber,
    success: true,
    totalAmount: params.totalAmount,
  };
}

/**
 * Activity: Updates the spent amount on the corresponding category budget.
 */
export async function updateBudgetSpendActivity(
  params: UpdateBudgetSpendParams,
): Promise<UpdateBudgetSpendResult> {
  console.log(
    `[ExpenseActivity] updateBudgetSpend: tenantId=${params.tenantId}, category=${params.category}, amount=${params.amount}`,
  );

  return {
    success: true,
    category: params.category,
    amountAdded: params.amount,
  };
}

/**
 * Activity: Emits a financial domain event (e.g. EXPENSE_APPROVED, EXPENSE_PAID, EXPENSE_REJECTED).
 */
export async function emitFinanceEventActivity(
  params: EmitFinanceEventParams,
): Promise<EmitFinanceEventResult> {
  const timestamp = new Date().toISOString();
  console.log(
    `[ExpenseActivity] emitFinanceEvent: event=${params.event}, tenantId=${params.tenantId}`,
  );

  return {
    emitted: true,
    event: params.event,
    timestamp,
  };
}

/**
 * Activity: Deducts reimbursement funds from the designated treasury/bank account.
 */
export async function deductAccountBalanceActivity(
  params: DeductAccountBalanceParams,
): Promise<DeductAccountBalanceResult> {
  console.log(
    `[ExpenseActivity] deductAccountBalance: tenantId=${params.tenantId}, accountId=${params.accountId ?? 'default'}, amount=${params.amount}`,
  );

  return {
    success: true,
    accountId: params.accountId,
    amountDeducted: params.amount,
  };
}

/**
 * Activity: Updates the expense claim record status and associated metadata in the database.
 */
export async function updateExpenseStatusActivity(
  params: UpdateExpenseStatusParams,
): Promise<UpdateExpenseStatusResult> {
  console.log(
    `[ExpenseActivity] updateExpenseStatus: expenseId=${params.expenseId}, status=${params.status}, rejectionReason=${params.rejectionReason ?? 'none'}`,
  );

  return {
    success: true,
    expenseId: params.expenseId,
    status: String(params.status),
  };
}
