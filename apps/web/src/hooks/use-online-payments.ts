'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  InvoiceOnlinePaymentDto,
  PayLinkDto,
  PaymentSettingsDto,
  QuoteDepositStatusDto,
  UpdatePaymentSettingsPayload,
} from '@saas/shared';
import { apiFetch } from '@/lib/api/client';

/**
 * Customers paying online. Kept out of `lib/api/endpoints` so this feature
 * does not edit the shared endpoint objects.
 */
export const paymentKeys = {
  settings: ['payments', 'settings'] as const,
  quoteDefaults: ['payments', 'quote-defaults'] as const,
  invoices: ['payments', 'invoices'] as const,
  quoteDeposit: (quoteId: string) => ['payments', 'quotes', quoteId, 'deposit'] as const,
};

export function usePaymentSettings() {
  return useQuery({
    queryKey: paymentKeys.settings,
    queryFn: () => apiFetch<PaymentSettingsDto>('/payments/settings'),
  });
}

export function useSavePaymentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePaymentSettingsPayload) =>
      apiFetch<PaymentSettingsDto>('/payments/settings', { method: 'PUT', body: payload }),
    onSuccess: (dto) => {
      queryClient.setQueryData(paymentKeys.settings, dto);
      void queryClient.invalidateQueries({ queryKey: paymentKeys.quoteDefaults });
    },
  });
}

export function useClearPaymentKeys() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<PaymentSettingsDto>('/payments/settings/clear-keys', { method: 'POST' }),
    onSuccess: (dto) => queryClient.setQueryData(paymentKeys.settings, dto),
  });
}

/** The deposit a new quote starts with; 0 when none is set. */
export function useQuoteDepositDefault(enabled: boolean) {
  return useQuery({
    queryKey: paymentKeys.quoteDefaults,
    queryFn: () => apiFetch<{ defaultDepositPercent: number }>('/payments/quote-defaults'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useInvoiceOnlinePayments(enabled = true) {
  return useQuery({
    queryKey: paymentKeys.invoices,
    queryFn: () => apiFetch<InvoiceOnlinePaymentDto[]>('/payments/invoices'),
    enabled,
  });
}

export function useIssuePayLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) =>
      apiFetch<PayLinkDto>(`/payments/invoices/${invoiceId}/pay-link`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: paymentKeys.invoices }),
  });
}

export function useQuoteDeposit(quoteId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: paymentKeys.quoteDeposit(quoteId ?? ''),
    queryFn: () =>
      apiFetch<{ deposit: QuoteDepositStatusDto | null }>(`/payments/quotes/${quoteId}/deposit`).then(
        (r) => r.deposit,
      ),
    enabled: enabled && Boolean(quoteId),
  });
}
