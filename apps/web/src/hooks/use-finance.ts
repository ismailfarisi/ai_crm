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
  TransferFundsPayload,
  TransferFundsResult,
  CreateCategoryBudgetPayload,
  CreateRecurringExpensePayload,
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

export function useJournalEntries() {
  return useQuery({
    queryKey: queryKeys.financeJournalEntries,
    queryFn: () => api.finance.listJournalEntries(),
  });
}
