'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SalesOrderStatus } from '@saas/shared';
import { api, queryKeys, type SalesOrderListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useSalesOrders(params: SalesOrderListParams) {
  return useQuery({
    queryKey: queryKeys.salesOrders(params),
    queryFn: () => api.salesOrders.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useSalesOrder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.salesOrder(id ?? ''),
    queryFn: () => api.salesOrders.get(id as string),
    enabled: Boolean(id),
  });
}

export function useQuoteSalesOrder(quoteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.quoteSalesOrder(quoteId ?? ''),
    queryFn: () => api.salesOrders.forQuote(quoteId as string),
    enabled: Boolean(quoteId) && enabled,
  });
}

/** Raising an invoice moves receivables, so the invoice and finance views go stale too. */
function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
    ]);
}

export function useInvoiceStage() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      api.salesOrders.invoiceStage(id, stageId),
    onSuccess: async ({ order, invoiceId, isNew }) => {
      await invalidate();
      const stage = order.billingSchedule.find((s) => s.invoiceId === invoiceId);
      toast.success(
        isNew
          ? `${stage?.invoiceNumber ?? 'Invoice'} raised for “${stage?.label ?? 'this stage'}”`
          : `“${stage?.label ?? 'This stage'}” was already invoiced`,
      );
    },
    // Refusals say which stage comes first; show them verbatim.
    onError: (error) => toast.error(describe(error, 'Could not raise the invoice')),
  });
}

export function useSalesOrderAction() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({
      id,
      status,
      cancelReason,
    }: {
      id: string;
      status: SalesOrderStatus;
      cancelReason?: string | null;
    }) =>
      status === 'CANCELLED'
        ? api.salesOrders.cancel(id, cancelReason ?? null)
        : api.salesOrders.setStatus(id, status),
    onSuccess: async (order) => {
      await invalidate();
      toast.success(`${order.orderNumber} is now ${order.status.toLowerCase().replace('_', ' ')}`);
    },
    onError: (error) => toast.error(describe(error, 'Could not update the order')),
  });
}

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
