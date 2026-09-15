'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, queryKeys, type FinancialReport, type ReportParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

const describe = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.message ? error.message : fallback;

/* ---------------- notifications ---------------- */

/** Polled: nothing pushes to the browser yet, and a minute is soon enough for an approval. */
export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.notifications.list(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: { kind: 'read'; id: string } | { kind: 'readAll' }) =>
      action.kind === 'read' ? api.notifications.read(action.id) : api.notifications.readAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

/* ---------------- billing ---------------- */

export function useSubscription() {
  return useQuery({
    queryKey: queryKeys.subscription,
    queryFn: () => api.billing.subscription(),
    staleTime: 60_000,
  });
}

export function usePlans() {
  return useQuery({ queryKey: queryKeys.billingPlans, queryFn: () => api.billing.plans() });
}

export function useBillingAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'checkout'; planCode: string }
        | { kind: 'cancel' }
        | { kind: 'fakeComplete'; session: string }
        | { kind: 'fakeFail' },
    ) => {
      switch (action.kind) {
        case 'checkout': {
          const { url } = await api.billing.checkout(action.planCode);
          // Off to the provider's page (or the fake one); nothing to refresh here.
          window.location.assign(url);
          return null;
        }
        case 'cancel':
          return api.billing.cancel();
        case 'fakeComplete':
          return api.billing.fakeComplete(action.session);
        case 'fakeFail':
          return api.billing.fakeFail();
      }
    },
    onSuccess: async (_result, action) => {
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      if (action.kind === 'cancel') toast.success('Your subscription will end at the close of this period');
      if (action.kind === 'fakeComplete') toast.success('Payment received — your subscription is active');
      if (action.kind === 'fakeFail') toast.warning('Simulated a failed payment');
    },
    onError: (error) => toast.error(describe(error, 'That did not go through')),
  });
}

/* ---------------- currencies ---------------- */

export function useCurrencySettings() {
  return useQuery({ queryKey: queryKeys.currencySettings, queryFn: () => api.currencies.settings() });
}

export function useFxRates() {
  return useQuery({ queryKey: queryKeys.fxRates, queryFn: () => api.currencies.rates() });
}

export function useCurrencyAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'setBase'; currency: string }
        | { kind: 'rate'; currency: string; rateDate: string; rate: number }
        | { kind: 'deleteRate'; id: string }
        | { kind: 'revalue'; period: string },
    ) => {
      switch (action.kind) {
        case 'setBase':
          return api.currencies.setBase(action.currency);
        case 'rate':
          return api.currencies.upsertRate(action);
        case 'deleteRate':
          return api.currencies.deleteRate(action.id);
        case 'revalue':
          return api.currencies.revalue(action.period);
      }
    },
    onSuccess: async (result, action) => {
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      if (action.kind === 'revalue' && result && typeof result === 'object' && 'period' in result) {
        const r = result;
        toast.success(
          r.entryNumber
            ? `${r.period} revalued: receivables ${r.receivables.delta.toFixed(2)}, payables ${r.payables.delta.toFixed(2)}`
            : `${r.period}: nothing to revalue`,
        );
        if (r.missingRates.length) toast.warning(`No rate at month end for ${r.missingRates.join(', ')}`);
      } else if (action.kind !== 'revalue') {
        toast.success('Saved');
      }
    },
    onError: (error) => toast.error(describe(error, 'That did not go through')),
  });
}

/* ---------------- reports ---------------- */

export function useFinancialReport<T>(report: FinancialReport, params: ReportParams, enabled = true) {
  const fetchers: Record<FinancialReport, (p: ReportParams) => Promise<unknown>> = {
    'trial-balance': api.reports.trialBalance,
    'profit-and-loss': api.reports.profitAndLoss,
    'balance-sheet': api.reports.balanceSheet,
    'receivables-aging': api.reports.receivablesAging,
    margins: api.reports.margins,
  };
  return useQuery({
    queryKey: queryKeys.financialReport(report, params),
    queryFn: () => fetchers[report](params) as Promise<T>,
    enabled,
  });
}

export async function downloadReportCsv(report: FinancialReport, params: ReportParams) {
  try {
    const blob = await api.reports.csv(report, params);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast.error(describe(error, 'Could not download the report'));
  }
}
