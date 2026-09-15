'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { WorkOrderDto } from '@saas/shared';
import { api, queryKeys, type WorkOrderListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useWorkOrders(
  params: WorkOrderListParams,
  options: { refetchInterval?: number; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.workOrders(params),
    queryFn: () => api.workOrders.list(params),
    placeholderData: (previous) => previous,
    refetchInterval: options.refetchInterval,
    enabled: options.enabled ?? true,
  });
}

/** Polls while open: several tablets can be working the same job. */
export function useWorkOrder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.workOrder(id ?? ''),
    queryFn: () => api.workOrders.get(id as string),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
}

export function useWorkOrderVariance(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: queryKeys.workOrderVariance(params),
    queryFn: () => api.workOrders.variance(params),
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (workOrder?: WorkOrderDto) => {
    if (workOrder) queryClient.setQueryData(queryKeys.workOrder(workOrder.id), workOrder);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ]);
  };
}

export function usePlanWorkOrders() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ salesOrderId, dueDate }: { salesOrderId: string; dueDate?: string | null }) =>
      api.workOrders.createFromSalesOrder(salesOrderId, { dueDate: dueDate ?? null }),
    onSuccess: async (result) => {
      await invalidate();
      if (result.created.length) {
        toast.success(
          `Planned ${result.created.map((w) => w.woNumber).join(', ')}${
            result.skipped.length ? ` · ${result.skipped.length} line${result.skipped.length === 1 ? '' : 's'} skipped` : ''
          }`,
        );
      } else {
        toast.message(
          result.skipped.length
            ? `Nothing to plan: ${result.skipped.map((s) => `${s.description} — ${s.reason.toLowerCase()}`).join('; ')}`
            : 'Nothing to plan',
        );
      }
    },
    onError: (error) => toast.error(describe(error, 'Could not plan production')),
  });
}

type FloorAction =
  | { kind: 'release' }
  | { kind: 'complete'; qtyCompleted: number | null }
  | { kind: 'cancel'; reason: string | null }
  | { kind: 'start'; operationId: string }
  | { kind: 'stop'; operationId: string }
  | { kind: 'finish'; operationId: string }
  | { kind: 'logTime'; operationId: string; minutes: number }
  | { kind: 'issue'; workOrderMaterialId: string; qty: number };

/** Every action on a job, so the tablet has one mutation to watch for pending state. */
export function useWorkOrderAction(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (action: FloorAction): Promise<{ workOrder: WorkOrderDto; capped?: boolean }> => {
      switch (action.kind) {
        case 'release':
          return { workOrder: await api.workOrders.release(id) };
        case 'complete':
          return { workOrder: await api.workOrders.complete(id, action.qtyCompleted) };
        case 'cancel':
          return { workOrder: await api.workOrders.cancel(id, action.reason) };
        case 'start':
          return { workOrder: await api.workOrders.start(id, action.operationId) };
        case 'stop':
          return api.workOrders.stop(id, action.operationId);
        case 'finish':
          return api.workOrders.finish(id, action.operationId);
        case 'logTime':
          return { workOrder: await api.workOrders.logTime(id, action.operationId, action.minutes) };
        case 'issue':
          return { workOrder: await api.workOrders.issue(id, action.workOrderMaterialId, action.qty) };
      }
    },
    onSuccess: async ({ workOrder, capped }, action) => {
      await invalidate(workOrder);
      if (capped) {
        toast.warning('That timer ran over 12 hours, so only 12 hours were counted. Log any extra time by hand.');
      }
      const done: Partial<Record<FloorAction['kind'], string>> = {
        release: `${workOrder.woNumber} released to the floor`,
        complete: `${workOrder.woNumber} completed`,
        cancel: `${workOrder.woNumber} cancelled`,
        logTime: 'Time logged',
        issue: action.kind === 'issue' && action.qty < 0 ? 'Returned to stock' : 'Issued to the job',
      };
      if (done[action.kind]) toast.success(done[action.kind]);
    },
    onError: (error) => toast.error(describe(error, 'That did not go through')),
  });
}

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
