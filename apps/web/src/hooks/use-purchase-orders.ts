'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CancelPurchaseOrderPayload,
  CreatePurchaseOrderPayload,
  SuggestPurchaseOrderPayload,
} from '@saas/shared';
import { api, queryKeys, type PurchaseOrderListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function usePurchaseOrders(params: PurchaseOrderListParams) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders(params),
    queryFn: () => api.purchaseOrders.list(params),
    placeholderData: (previous) => previous,
  });
}

export function usePurchaseOrder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.purchaseOrder(id ?? ''),
    queryFn: () => api.purchaseOrders.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The same policy evaluation the API enforces on submit, so the editor can
 * warn before anyone clicks it. The browser copy is a convenience; the server
 * copy is the rule.
 */
export function usePurchaseOrderGuardrails(id: string | null) {
  return useQuery({
    queryKey: queryKeys.purchaseOrderGuardrails(id ?? ''),
    queryFn: () => api.purchaseOrders.guardrails(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
}

export function useCreatePurchaseOrder() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: (input: CreatePurchaseOrderPayload) => api.purchaseOrders.create(input),
    onSuccess: async (order) => {
      await invalidate();
      toast.success(`${order.poNumber} created as a draft`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create the order')),
  });
}

/** Proposes orders from a quote's material demand. Creates nothing. */
export function useSuggestPurchaseOrders() {
  return useMutation({
    mutationFn: (input: SuggestPurchaseOrderPayload) => api.purchaseOrders.suggest(input),
    onError: (error) => toast.error(describe(error, 'Could not work out what to order')),
  });
}

/**
 * One hook for every status change.
 *
 * The API's refusals name the limit and the actual figure — "Total is 900.00,
 * above the 500.00 approval threshold" — so they are surfaced verbatim rather
 * than replaced with something vaguer.
 */
export function usePurchaseOrderAction() {
  const invalidate = useInvalidateOrders();

  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'submit' | 'reopen' | 'approve' | 'send' | 'cancel' | 'closeShort';
      reason?: CancelPurchaseOrderPayload['reason'];
    }) => {
      if (action === 'cancel') return api.purchaseOrders.cancel(id, { reason: reason ?? null });
      if (action === 'closeShort') {
        return api.purchaseOrders.closeShort(id, { reason: reason ?? null });
      }
      return api.purchaseOrders[action](id);
    },
    onSuccess: async (order, variables) => {
      await invalidate();
      toast.success(
        {
          submit: `${order.poNumber} sent for approval`,
          reopen: `${order.poNumber} reopened for changes`,
          approve: `${order.poNumber} approved`,
          send: `${order.poNumber} emailed to ${order.supplierName}`,
          cancel: `${order.poNumber} cancelled`,
          closeShort: `${order.poNumber} closed short — the balance is no longer on order`,
        }[variables.action],
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not update the order')),
  });
}

export function usePurchasePolicy() {
  return useQuery({
    queryKey: queryKeys.purchasePolicy,
    queryFn: () => api.purchasePolicy.get(),
  });
}

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
