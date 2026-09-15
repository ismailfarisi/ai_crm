'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TaxCodePayload, TaxRulePayload } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

const describe = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.message ? error.message : fallback;

/** Credits, deliveries and tax all move invoices, orders, stock or the ledger. */
function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['credit-notes', 'delivery-notes', 'invoices', 'sales-orders', 'finance', 'inventory', 'tax'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useCreditNotes(invoiceId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.creditNotes(invoiceId),
    queryFn: () => api.creditNotes.list(invoiceId),
    enabled,
  });
}

export function useCreditNoteAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'create'; invoiceId: string; reason: string; netAmount?: number; full?: boolean; issue: boolean }
        | { kind: 'issue' | 'cancel'; id: string }
        | { kind: 'refund'; id: string; financeAccountId: string; amount?: number | null; reference?: string | null },
    ) => {
      switch (action.kind) {
        case 'create': {
          const draft = await api.creditNotes.create(action.invoiceId, {
            reason: action.reason,
            ...(action.full ? { full: true } : { netAmount: action.netAmount }),
          });
          return action.issue ? api.creditNotes.issue(draft.id) : draft;
        }
        case 'issue':
          return api.creditNotes.issue(action.id);
        case 'cancel':
          return api.creditNotes.cancel(action.id);
        case 'refund':
          return api.creditNotes.refund(action.id, {
            financeAccountId: action.financeAccountId,
            amount: action.amount ?? null,
            reference: action.reference ?? null,
          });
      }
    },
    onSuccess: async (note, action) => {
      await invalidate();
      toast.success(
        {
          create: note.status === 'ISSUED' ? `${note.creditNoteNumber} issued` : 'Credit note drafted',
          issue: `${note.creditNoteNumber} issued`,
          cancel: 'Draft credit note discarded',
          refund: `Refund recorded against ${note.creditNoteNumber}`,
        }[action.kind],
      );
    },
    onError: (error) => toast.error(describe(error, 'That did not go through')),
  });
}

export function useDeliveryNotes(salesOrderId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.deliveryNotes(salesOrderId),
    queryFn: () => api.deliveryNotes.listForOrder(salesOrderId),
    enabled,
  });
}

export function useDeliveryNoteAction(salesOrderId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'create'; lines: { salesOrderLineId: string; qty: number }[]; carrier?: string; trackingReference?: string; shipTo?: string }
        | { kind: 'dispatch' | 'cancel' | 'invoice'; id: string },
    ) => {
      switch (action.kind) {
        case 'create':
          return { note: await api.deliveryNotes.create(salesOrderId, action) };
        case 'dispatch':
          return { note: await api.deliveryNotes.dispatch(action.id) };
        case 'cancel':
          return { note: await api.deliveryNotes.cancel(action.id) };
        case 'invoice': {
          const result = await api.deliveryNotes.invoice(action.id);
          return { note: result.delivery };
        }
      }
    },
    onSuccess: async ({ note }, action) => {
      await invalidate();
      toast.success(
        {
          create: `${note.deliveryNoteNumber} prepared`,
          dispatch: `${note.deliveryNoteNumber} dispatched`,
          cancel: `${note.deliveryNoteNumber} discarded`,
          invoice: `${note.invoiceNumber ?? 'Invoice'} raised for ${note.deliveryNoteNumber}`,
        }[action.kind],
      );
    },
    onError: (error) => toast.error(describe(error, 'That did not go through')),
  });
}

export async function downloadPackingSlip(id: string, number: string) {
  try {
    const blob = await api.deliveryNotes.packingSlip(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${number}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast.error(describe(error, 'Could not download the packing slip'));
  }
}

export function useTaxCodes() {
  return useQuery({ queryKey: queryKeys.taxCodes, queryFn: () => api.tax.codes() });
}

export function useTaxRules() {
  return useQuery({ queryKey: queryKeys.taxRules, queryFn: () => api.tax.rules() });
}

export function useTaxReport(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.taxReport(from, to),
    queryFn: () => api.tax.report(from, to),
    enabled: Boolean(from && to && to > from),
  });
}

export function useTaxSettingsAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'createCode'; input: TaxCodePayload }
        | { kind: 'updateCode'; id: string; input: TaxCodePayload }
        | { kind: 'createRule'; input: TaxRulePayload }
        | { kind: 'deleteRule'; id: string },
    ) => {
      switch (action.kind) {
        case 'createCode':
          return api.tax.createCode(action.input);
        case 'updateCode':
          return api.tax.updateCode(action.id, action.input);
        case 'createRule':
          return api.tax.createRule(action.input);
        case 'deleteRule':
          return api.tax.deleteRule(action.id);
      }
    },
    onSuccess: async () => {
      await invalidate();
      toast.success('Tax settings saved');
    },
    onError: (error) => toast.error(describe(error, 'Could not save tax settings')),
  });
}
