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
  UpdateRecurringExpensePayload,
  RecurringOccurrenceDto,
  CashForecastDto,
  PrepaidScheduleDto,
  CreateExpenseClaimPayload,
  UpdateExpenseClaimPayload,
  ScanReceiptPayload,
  ScannedReceiptResult,
  SignalExpenseClaimPayload,
  ExpenseListParams,
  UpdateFinanceAccountPayload,
} from '@saas/shared';
import { apiFetch, apiUpload } from '../client';

export const financeEndpoints = {
  finance: {
    getOverview: () => apiFetch<TreasuryOverviewDto>('/finance/overview'),
    listAccounts: () => apiFetch<FinanceAccountDto[]>('/finance/accounts'),
    createAccount: (payload: CreateFinanceAccountPayload) =>
      apiFetch<FinanceAccountDto>('/finance/accounts', { method: 'POST', body: payload }),
    updateAccount: (id: string, payload: UpdateFinanceAccountPayload) =>
      apiFetch<FinanceAccountDto>(`/finance/accounts/${id}`, { method: 'PATCH', body: payload }),
    transferFunds: (payload: TransferFundsPayload) =>
      apiFetch<TransferFundsResult>('/finance/accounts/transfer', { method: 'POST', body: payload }),
    listBudgets: () => apiFetch<CategoryBudgetDto[]>('/finance/budgets'),
    createBudget: (payload: CreateCategoryBudgetPayload) =>
      apiFetch<CategoryBudgetDto>('/finance/budgets', { method: 'POST', body: payload }),
    listSubscriptions: () => apiFetch<RecurringExpenseDto[]>('/finance/subscriptions'),
    createSubscription: (payload: CreateRecurringExpensePayload) =>
      apiFetch<RecurringExpenseDto>('/finance/subscriptions', { method: 'POST', body: payload }),
    updateSubscription: (id: string, payload: UpdateRecurringExpensePayload) =>
      apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}`, { method: 'PATCH', body: payload }),
    pauseSubscription: (id: string) =>
      apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}/pause`, { method: 'POST' }),
    resumeSubscription: (id: string) =>
      apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}/resume`, { method: 'POST' }),
    cancelSubscription: (id: string) =>
      apiFetch<RecurringExpenseDto>(`/finance/subscriptions/${id}`, { method: 'DELETE' }),
    listOccurrences: (id: string) =>
      apiFetch<RecurringOccurrenceDto[]>(`/finance/subscriptions/${id}/occurrences`),
    cashForecast: (months = 6) =>
      apiFetch<CashForecastDto>('/finance/cash-forecast', { query: { months } }),
    listPrepaidSchedules: (billId: string) =>
      apiFetch<PrepaidScheduleDto[]>('/finance/prepaid-schedules', { query: { billId } }),
    endPrepaidEarly: (id: string) =>
      apiFetch<PrepaidScheduleDto>(`/finance/prepaid-schedules/${id}/end-early`, { method: 'POST' }),
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
    /** Stores the file on the claim as its receipt. */
    uploadReceipt: (id: string, file: File) =>
      apiUpload<ExpenseClaimDto>(`/finance/expenses/${id}/receipt`, file),
    /** The same scan, from the file itself — PDF or photo. */
    scanReceiptFile: (file: File) =>
      apiUpload<ScannedReceiptResult>('/finance/expenses/scan-receipt', file),
    signal: (id: string, payload: SignalExpenseClaimPayload) =>
      apiFetch<ExpenseClaimDto>(`/finance/expenses/${id}/signal`, {
        method: 'POST',
        body: payload,
      }),
  },
};

export const financeKeys = {
  // Finance & Treasury
  financeOverview: ['finance', 'overview'] as const,  financeAccounts: ['finance', 'accounts'] as const,  financeBudgets: ['finance', 'budgets'] as const,  financeSubscriptions: ['finance', 'subscriptions'] as const,
  financeOccurrences: (id: string) => ['finance', 'subscriptions', id, 'occurrences'] as const,
  financeCashForecast: (months: number) => ['finance', 'cash-forecast', months] as const,
  prepaidSchedules: (billId: string) => ['finance', 'prepaid-schedules', billId] as const,
   financeJournalEntries: ['finance', 'journal-entries'] as const,  // Expenses
  expenses: (params: ExpenseListParams = {}) => ['finance', 'expenses', params] as const,  expense: (id: string) => ['finance', 'expenses', id] as const,};
