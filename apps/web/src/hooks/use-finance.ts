'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  FinanceAccountDto,
  CategoryBudgetDto,
  RecurringExpenseDto,
  JournalEntryDto,
  JournalLineDto,
  TreasuryOverviewDto,
  CreateFinanceAccountPayload,
  UpdateFinanceAccountPayload,
  TransferFundsPayload,
  TransferFundsResult,
  CreateCategoryBudgetPayload,
  CreateRecurringExpensePayload,
  UpdateRecurringExpensePayload,
  AccountType,
  BudgetPeriod,
} from '@saas/shared';
import { calculateRunwayMonths } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export type {
  FinanceAccountDto,
  CategoryBudgetDto,
  RecurringExpenseDto,
  JournalEntryDto,
  JournalLineDto,
  TreasuryOverviewDto,
  CreateFinanceAccountPayload,
  UpdateFinanceAccountPayload,
  TransferFundsPayload,
  TransferFundsResult,
  CreateCategoryBudgetPayload,
  CreateRecurringExpensePayload,
  AccountType,
  BudgetPeriod,
};
export { calculateRunwayMonths };

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useInvalidateFinance() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: ['finance'] }),
    invalidateOverview: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.financeOverview }),
    invalidateAccounts: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financeAccounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeOverview });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeJournalEntries });
    },
    invalidateBudgets: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financeBudgets });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeOverview });
    },
    invalidateSubscriptions: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financeSubscriptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeOverview });
    },
    invalidateJournalEntries: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financeJournalEntries });
    },
  };
}

export function useFinanceOverview() {
  return useQuery({
    queryKey: queryKeys.financeOverview,
    queryFn: () => api.finance.getOverview(),
  });
}

export function useFinanceAccounts() {
  return useQuery({
    queryKey: queryKeys.financeAccounts,
    queryFn: () => api.finance.listAccounts(),
  });
}

export function useCreateFinanceAccount() {
  const { invalidateAccounts } = useInvalidateFinance();

  return useMutation({
    mutationFn: (input: CreateFinanceAccountPayload) => api.finance.createAccount(input),
    onSuccess: async (account) => {
      await invalidateAccounts();
      toast.success(`Account "${account.name}" created`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create finance account')),
  });
}

/**
 * Renames an account, or moves the default onto it.
 *
 * The default account is what expense reimbursement pays from when the claim
 * does not name one, so leaving it unset is not cosmetic.
 */
export function useUpdateFinanceAccount() {
  const { invalidateAccounts } = useInvalidateFinance();

  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateFinanceAccountPayload & { id: string }) =>
      api.finance.updateAccount(id, payload),
    onSuccess: async (account) => {
      await invalidateAccounts();
      toast.success(
        account.isDefault
          ? `"${account.name}" is now the default account`
          : `Account "${account.name}" updated`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not update the account')),
  });
}

export function useTransferFunds() {
  const { invalidateAccounts } = useInvalidateFinance();

  return useMutation({
    mutationFn: (input: TransferFundsPayload) => api.finance.transferFunds(input),
    onSuccess: async () => {
      await invalidateAccounts();
      toast.success('Funds transferred successfully');
    },
    onError: (error) => toast.error(describe(error, 'Could not transfer funds')),
  });
}

export function useCategoryBudgets() {
  return useQuery({
    queryKey: queryKeys.financeBudgets,
    queryFn: () => api.finance.listBudgets(),
  });
}

export function useCreateCategoryBudget() {
  const { invalidateBudgets } = useInvalidateFinance();

  return useMutation({
    mutationFn: (input: CreateCategoryBudgetPayload) => api.finance.createBudget(input),
    onSuccess: async (budget) => {
      await invalidateBudgets();
      toast.success(`Budget for "${budget.category}" created`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create budget')),
  });
}

export function useRecurringExpenses() {
  return useQuery({
    queryKey: queryKeys.financeSubscriptions,
    queryFn: () => api.finance.listSubscriptions(),
  });
}

export function useCreateRecurringExpense() {
  const { invalidateSubscriptions } = useInvalidateFinance();

  return useMutation({
    mutationFn: (input: CreateRecurringExpensePayload) => api.finance.createSubscription(input),
    onSuccess: async (sub) => {
      await invalidateSubscriptions();
      toast.success(`Subscription "${sub.vendorName}" registered`);
    },
    onError: (error) => toast.error(describe(error, 'Could not register recurring expense')),
  });
}

/** The server's own words (e.g. "needs bill:approve") beat a generic 403 line here. */
function describeServer(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return describe(error, fallback);
}

export function useUpdateRecurringExpense() {
  const { invalidateSubscriptions } = useInvalidateFinance();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRecurringExpensePayload }) =>
      api.finance.updateSubscription(id, input),
    onSuccess: async (sub) => {
      await invalidateSubscriptions();
      toast.success(`"${sub.vendorName}" updated`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not update recurring expense')),
  });
}

export function usePauseRecurringExpense() {
  const { invalidateSubscriptions } = useInvalidateFinance();

  return useMutation({
    mutationFn: (id: string) => api.finance.pauseSubscription(id),
    onSuccess: async (sub) => {
      await invalidateSubscriptions();
      toast.success(`"${sub.vendorName}" paused`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not pause recurring expense')),
  });
}

export function useResumeRecurringExpense() {
  const { invalidateSubscriptions } = useInvalidateFinance();

  return useMutation({
    mutationFn: (id: string) => api.finance.resumeSubscription(id),
    onSuccess: async (sub) => {
      await invalidateSubscriptions();
      toast.success(`"${sub.vendorName}" resumed`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not resume recurring expense')),
  });
}

export function useCancelRecurringExpense() {
  const { invalidateSubscriptions } = useInvalidateFinance();

  return useMutation({
    mutationFn: (id: string) => api.finance.cancelSubscription(id),
    onSuccess: async (sub) => {
      await invalidateSubscriptions();
      toast.success(`"${sub.vendorName}" cancelled`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not cancel recurring expense')),
  });
}

export function useRecurringOccurrences(id: string | null) {
  return useQuery({
    queryKey: queryKeys.financeOccurrences(id ?? ''),
    queryFn: () => api.finance.listOccurrences(id!),
    enabled: Boolean(id),
  });
}

export function useCashForecast(months = 6) {
  return useQuery({
    queryKey: queryKeys.financeCashForecast(months),
    queryFn: () => api.finance.cashForecast(months),
  });
}

export function usePrepaidSchedules(billId: string | null) {
  return useQuery({
    queryKey: queryKeys.prepaidSchedules(billId ?? ''),
    queryFn: () => api.finance.listPrepaidSchedules(billId!),
    enabled: Boolean(billId),
  });
}

export function useEndPrepaidEarly() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.finance.endPrepaidEarly(id),
    onSuccess: async (schedule) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.prepaidSchedules(schedule.billId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bill(schedule.billId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.financeOverview }),
      ]);
      toast.success('Prepaid schedule ended early');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not end the prepaid schedule')),
  });
}

export function useJournalEntries() {
  return useQuery({
    queryKey: queryKeys.financeJournalEntries,
    queryFn: () => api.finance.listJournalEntries(),
  });
}
