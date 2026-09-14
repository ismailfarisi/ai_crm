'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdjustStockPayload,
  ReceiveGoodsPayload,
  SetReorderLevelsPayload,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useStock() {
  return useQuery({ queryKey: queryKeys.stock, queryFn: () => api.inventory.stock() });
}

export function useStockLocations() {
  return useQuery({
    queryKey: queryKeys.stockLocations,
    queryFn: () => api.inventory.locations(),
  });
}

export function useReorderSuggestions() {
  return useQuery({
    queryKey: queryKeys.reorderSuggestions,
    queryFn: () => api.inventory.reorderSuggestions(),
  });
}

export function useGoodsReceipts(purchaseOrderId?: string) {
  return useQuery({
    queryKey: queryKeys.goodsReceipts(purchaseOrderId),
    queryFn: () => api.goodsReceipts.list(purchaseOrderId),
  });
}

/**
 * Receiving touches stock, the order and the ledger, so it invalidates all
 * three rather than just the list it was called from.
 */
function useInvalidateAfterStockChange() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['goods-receipts'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
    ]);
  };
}

export function useReceiveGoods() {
  const invalidate = useInvalidateAfterStockChange();

  return useMutation({
    mutationFn: ({ purchaseOrderId, input }: { purchaseOrderId: string; input: ReceiveGoodsPayload }) =>
      api.goodsReceipts.receive(purchaseOrderId, input),
    onSuccess: async (receipt) => {
      await invalidate();
      toast.success(`Booked in as ${receipt.receiptNumber}`);
    },
    // The API's refusals name the quantity outstanding and the tolerance, so
    // they are more useful than anything generic.
    onError: (error) => toast.error(describe(error, 'Could not book the delivery in')),
  });
}

export function useAdjustStock() {
  const invalidate = useInvalidateAfterStockChange();

  return useMutation({
    mutationFn: (input: AdjustStockPayload) => api.inventory.adjust(input),
    onSuccess: async () => {
      await invalidate();
      toast.success('Stock adjusted');
    },
    onError: (error) => toast.error(describe(error, 'Could not adjust the stock')),
  });
}

export function useSetReorderLevels() {
  const invalidate = useInvalidateAfterStockChange();

  return useMutation({
    mutationFn: (input: SetReorderLevelsPayload) => api.inventory.setReorderLevels(input),
    onSuccess: async () => {
      await invalidate();
      toast.success('Reorder levels saved');
    },
    onError: (error) => toast.error(describe(error, 'Could not save the reorder levels')),
  });
}

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
