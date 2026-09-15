'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateBillPayload, RecordBillPaymentPayload } from '@saas/shared';
import { api, queryKeys, type BillListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useBills(params: BillListParams) {
  return useQuery({
    queryKey: queryKeys.bills(params),
    queryFn: () => api.bills.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useBill(id: string | null) {
  return useQuery({
    queryKey: queryKeys.bill(id ?? ''),
    queryFn: () => api.bills.get(id as string),
    enabled: Boolean(id),
  });
}

/** The live three-way match — re-run by the API, not cached from entry. */
export function useBillMatch(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.billMatch(id ?? ''),
    queryFn: () => api.bills.match(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useBillPayments(id: string | null) {
  return useQuery({
    queryKey: queryKeys.billPayments(id ?? ''),
    queryFn: () => api.bills.payments(id as string),
    enabled: Boolean(id),
  });
}

export function useBillAging() {
  return useQuery({ queryKey: queryKeys.billAging, queryFn: () => api.bills.aging() });
}

export function useBillableLines(purchaseOrderId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.billableLines(purchaseOrderId ?? ''),
    queryFn: () => api.bills.billable(purchaseOrderId as string),
    enabled: Boolean(purchaseOrderId) && enabled,
  });
}

/** Approving or paying a bill moves the ledger and cash, so refresh those too. */
function useInvalidateBills() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bills'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
    ]);
}

export function useCreateBill() {
  const invalidate = useInvalidateBills();
  return useMutation({
    mutationFn: (input: CreateBillPayload) => api.bills.create(input),
    onSuccess: async (bill) => {
      await invalidate();
      toast.success(
        bill.matchStatus === 'VARIANCE'
          ? `${bill.billNumber} entered — it does not match the order, so it will need a variance approval`
          : `${bill.billNumber} entered as a draft`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not enter the bill')),
  });
}

export function useBillAction() {
  const invalidate = useInvalidateBills();
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'approve' | 'dispute' | 'reopen' | 'cancel';
      reason?: string | null;
    }) => {
      if (action === 'dispute') return api.bills.dispute(id, { reason: reason ?? null });
      return api.bills[action](id);
    },
    onSuccess: async (bill, { action }) => {
      await invalidate();
      toast.success(
        {
          approve: `${bill.billNumber} approved and posted`,
          dispute: `${bill.billNumber} put on hold`,
          reopen: `${bill.billNumber} back to draft`,
          cancel: `${bill.billNumber} cancelled`,
        }[action],
      );
    },
    // Variance refusals name the prices and quantities; show them verbatim.
    onError: (error) => toast.error(describe(error, 'Could not update the bill')),
  });
}

export function usePayBill() {
  const invalidate = useInvalidateBills();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecordBillPaymentPayload }) =>
      api.bills.pay(id, input),
    onSuccess: async (bill) => {
      await invalidate();
      toast.success(
        bill.status === 'PAID' ? `${bill.billNumber} paid in full` : `Part payment recorded on ${bill.billNumber}`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not record the payment')),
  });
}

export function useReverseBillPayment() {
  const invalidate = useInvalidateBills();
  return useMutation({
    mutationFn: ({ id, paymentId }: { id: string; paymentId: string }) =>
      api.bills.reversePayment(id, paymentId),
    onSuccess: async (bill) => {
      await invalidate();
      toast.success(`Payment on ${bill.billNumber} reversed`);
    },
    onError: (error) => toast.error(describe(error, 'Could not reverse the payment')),
  });
}

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
