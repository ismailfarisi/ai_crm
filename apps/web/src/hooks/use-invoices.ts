'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  InvoiceDto,
  InvoicePaymentDto,
  InvoiceStatus,
  QuoteLineItem,
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

export function useInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.invoice(invoiceId ?? ''),
    queryFn: () => api.invoices.get(invoiceId as string),
    enabled: Boolean(invoiceId),
  });
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

/**
 * A voided invoice's lines as new draft-quote lines: fresh ids and no cost,
 * template or catalog links, so the recosting on create treats every line as
 * hand-entered and never re-prices it from the catalog.
 */
function cloneItemsForReissue(invoice: InvoiceDto): QuoteLineItem[] {
  return (invoice.items || []).map((item) => ({
    id: crypto.randomUUID(),
    type: item.type ?? 'product',
    description: item.description,
    descriptionAr: item.descriptionAr ?? null,
    sku: item.sku ?? null,
    quantity: item.quantity,
    uom: item.uom,
    unitPrice: item.unitPrice,
    discount: item.discount,
    taxRate: item.taxRate,
    taxReverseCharge: item.taxReverseCharge,
    subtotal: item.subtotal,
  }));
}

/**
 * Replace an issued invoice: voids it (reversing payments and freeing the
 * billing stage) and clones its lines into a fresh draft quote, which the user
 * corrects and approves; accepting it raises the corrected invoice. Issued invoices are
 * never edited in place — the books keep both documents.
 */
export function useReplaceInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ invoice, reason }: { invoice: InvoiceDto; reason?: string }) => {
      await api.invoices.void(invoice.id, { reason });
      try {
        return await api.quotes.create({
          title: `Reissue of ${invoice.invoiceNumber} — ${invoice.customerName}`,
          customerId: invoice.customerId ?? null,
          customerName: invoice.customerName,
          customerEmail: invoice.customerEmail ?? null,
          currency: invoice.currency,
          paymentTerms: invoice.paymentTerms || 'immediate',
          items: cloneItemsForReissue(invoice),
          notes:
            `Replaces voided invoice ${invoice.invoiceNumber}` +
            (reason ? ` — ${reason}` : '') +
            '.',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        throw new Error(
          `Invoice ${invoice.invoiceNumber} was voided, but the replacement draft quote could not be created: ${msg}`,
        );
      }
    },
    onSuccess: async (quote, { invoice }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoice(invoice.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quotes }),
      ]);
      toast.success(
        `Draft quote ${quote.quoteNumber ?? ''} created — correct it and approve to re-issue invoice ${invoice.invoiceNumber}`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not replace invoice')),
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
