'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  InvoiceDto,
  InvoicePaymentDto,
  InvoiceStatus,
  RecordInvoicePaymentPayload,
  VoidInvoicePayload,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export type { InvoiceDto, InvoicePaymentDto, InvoiceStatus };

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useInvoices() {
  const query = useQuery({
    queryKey: queryKeys.invoices,
    queryFn: () => api.invoices.list(),
  });

  return {
    invoices: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}

export function useInvoicePayments(invoiceId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoicePayments(invoiceId ?? ''),
    queryFn: () => api.invoices.payments(invoiceId as string),
    enabled: enabled && Boolean(invoiceId),
  });
}

export function useRecordInvoicePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RecordInvoicePaymentPayload }) =>
      api.invoices.recordPayment(id, payload),
    onSuccess: async (invoice) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoicePayments(invoice.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.financeAccounts }),
        queryClient.invalidateQueries({ queryKey: queryKeys.financeJournalEntries }),
      ]);
      toast.success(
        invoice.status === 'PAID'
          ? `Invoice ${invoice.invoiceNumber} fully paid`
          : `Payment recorded for invoice ${invoice.invoiceNumber}`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not record payment')),
  });
}

export function useVoidInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: VoidInvoicePayload }) =>
      api.invoices.void(id, payload),
    onSuccess: async (invoice) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoicePayments(invoice.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.financeAccounts }),
        queryClient.invalidateQueries({ queryKey: queryKeys.financeJournalEntries }),
      ]);
      toast.success(`Invoice ${invoice.invoiceNumber} voided`);
    },
    onError: (error) => toast.error(describe(error, 'Could not void invoice')),
  });
}

export function useSendInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.invoices.send(id),
    onSuccess: async (invoice) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invoices });
      toast.success(`Invoice ${invoice.invoiceNumber} sent to ${invoice.customerEmail}`);
    },
    onError: (error) => toast.error(describe(error, 'Could not send invoice')),
  });
}

export function useDownloadInvoicePdf() {
  return async (invoice: Pick<InvoiceDto, 'id' | 'invoiceNumber'>) => {
    try {
      const blob = await api.invoices.downloadPdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(describe(error, 'Could not download invoice PDF'));
    }
  };
}
