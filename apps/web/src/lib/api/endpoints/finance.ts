/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  FinanceAccountDto,
  ExpenseClaimDto,
  CategoryBudgetDto,
  RecurringExpenseDto,
  JournalEntryDto,
  TreasuryOverviewDto,
  CreateFinanceAccountPayload,
  TransferFundsPayload,
  TransferFundsResult,
  CreateCategoryBudgetPayload,
  CreateRecurringExpensePayload,
  CreateExpenseClaimPayload,
  UpdateExpenseClaimPayload,
  ScanReceiptPayload,
  ScannedReceiptResult,
  SignalExpenseClaimPayload,
  ExpenseListParams,
} from '@saas/shared';
import { apiFetch } from '../client';

export const financeEndpoints = {
  finance: {
    getOverview: () => apiFetch<TreasuryOverviewDto>('/finance/overview'),
    listAccounts: () => apiFetch<FinanceAccountDto[]>('/finance/accounts'),
    createAccount: (payload: CreateFinanceAccountPayload) =>
      apiFetch<FinanceAccountDto>('/finance/accounts', { method: 'POST', body: payload }),
    transferFunds: (payload: TransferFundsPayload) =>
      apiFetch<TransferFundsResult>('/finance/accounts/transfer', { method: 'POST', body: payload }),
    listBudgets: () => apiFetch<CategoryBudgetDto[]>('/finance/budgets'),
    createBudget: (payload: CreateCategoryBudgetPayload) =>
      apiFetch<CategoryBudgetDto>('/finance/budgets', { method: 'POST', body: payload }),
    listSubscriptions: () => apiFetch<RecurringExpenseDto[]>('/finance/subscriptions'),
    createSubscription: (payload: CreateRecurringExpensePayload) =>
      apiFetch<RecurringExpenseDto>('/finance/subscriptions', { method: 'POST', body: payload }),
    listJournalEntries: () => apiFetch<JournalEntryDto[]>('/finance/journal-entries'),
  },
  expenses: {
    list: (params: ExpenseListParams = {}) =>
      apiFetch<ExpenseClaimDto[]>('/finance/expenses', { query: params }),
    get: (id: string) => apiFetch<ExpenseClaimDto>(`/finance/expenses/${id}`),
    create: (payload: CreateExpenseClaimPayload) =>
      apiFetch<ExpenseClaimDto>('/finance/expenses', { method: 'POST', body: payload }),
    update: (id: string, payload: UpdateExpenseClaimPayload) =>
      apiFetch<ExpenseClaimDto>(`/finance/expenses/${id}`, { method: 'PATCH', body: payload }),
    scanReceipt: (payload: ScanReceiptPayload) =>
      apiFetch<ScannedReceiptResult>('/finance/expenses/scan-receipt', {
        method: 'POST',
        body: payload,
      }),
    signal: (id: string, payload: SignalExpenseClaimPayload) =>
      apiFetch<ExpenseClaimDto>(`/finance/expenses/${id}/signal`, {
        method: 'POST',
        body: payload,
      }),
  },
};

export const financeKeys = {
  // Finance & Treasury
  financeOverview: ['finance', 'overview'] as const,  financeAccounts: ['finance', 'accounts'] as const,  financeBudgets: ['finance', 'budgets'] as const,  financeSubscriptions: ['finance', 'subscriptions'] as const,  financeJournalEntries: ['finance', 'journal-entries'] as const,  // Expenses
  expenses: (params: ExpenseListParams = {}) => ['finance', 'expenses', params] as const,  expense: (id: string) => ['finance', 'expenses', id] as const,};
