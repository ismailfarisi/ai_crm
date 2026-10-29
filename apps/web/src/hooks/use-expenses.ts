'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ExpenseClaimDto,
  ExpenseItemDto,
  ExpenseStatus,
  CreateExpenseClaimPayload,
  UpdateExpenseClaimPayload,
  ScanReceiptPayload,
  ScannedReceiptResult,
  SignalExpenseClaimPayload,
  ExpenseListParams,
} from '@saas/shared';
import { receiptAttachmentId } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { isFileInput, type ReceiptScanInput } from '@/lib/receipt-scan-input';

export type {
  ExpenseClaimDto,
  ExpenseItemDto,
  ExpenseStatus,
  CreateExpenseClaimPayload,
  UpdateExpenseClaimPayload,
  ScanReceiptPayload,
  ScannedReceiptResult,
  SignalExpenseClaimPayload,
  ExpenseListParams,
};

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useInvalidateExpenses() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'expenses'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeOverview });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeBudgets });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeAccounts });
    },
    invalidateExpense: (id: string) => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'expenses'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.expense(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeOverview });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeBudgets });
      queryClient.invalidateQueries({ queryKey: queryKeys.financeAccounts });
    },
  };
}

export function useCreateExpenseClaim() {
  const { invalidateAll } = useInvalidateExpenses();

  return useMutation({
    mutationFn: (input: CreateExpenseClaimPayload) => api.expenses.create(input),
    onSuccess: async (claim) => {
      await invalidateAll();
      toast.success(`Expense claim #${claim.claimNumber || claim.id.slice(0, 8)} submitted`);
    },
    onError: (error) => toast.error(describe(error, 'Could not submit expense claim')),
  });
}

export function useUpdateExpenseClaim() {
  const { invalidateExpense } = useInvalidateExpenses();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateExpenseClaimPayload }) =>
      api.expenses.update(id, payload),
    onSuccess: async (claim) => {
      await invalidateExpense(claim.id);
      toast.success(`Expense claim #${claim.claimNumber || claim.id.slice(0, 8)} updated`);
    },
    onError: (error) => toast.error(describe(error, 'Could not update expense claim')),
  });
}

export function useScanReceipt() {
  return useMutation({
    mutationFn: (input: ReceiptScanInput) =>
      isFileInput(input) ? api.expenses.scanReceiptFile(input.file) : api.expenses.scanReceipt(input),
    onSuccess: (result) => {
      toast.success(`Receipt scanned: ${result.merchantName || 'Extracted'}`);
    },
    onError: (error) => toast.error(describe(error, 'Could not scan receipt')),
  });
}

export function useSignalExpenseClaim() {
  const { invalidateExpense } = useInvalidateExpenses();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SignalExpenseClaimPayload }) =>
      api.expenses.signal(id, payload),
    onSuccess: async (claim, variables) => {
      await invalidateExpense(variables.id);
      const actionLabel =
        variables.payload.action === 'APPROVE'
          ? 'approved'
          : variables.payload.action === 'REJECT'
            ? 'rejected'
            : 'reimbursed';
      toast.success(`Expense claim ${actionLabel} successfully`);
    },
    onError: (error) => toast.error(describe(error, 'Failed to process expense claim action')),
  });
}

export function useExpenses(filters: ExpenseListParams = {}) {
  const query = useQuery({
    queryKey: queryKeys.expenses(filters),
    queryFn: () => api.expenses.list(filters),
    placeholderData: (previous) => previous,
  });

  const createMutation = useCreateExpenseClaim();
  const updateMutation = useUpdateExpenseClaim();
  const signalMutation = useSignalExpenseClaim();

  const { invalidateExpense } = useInvalidateExpenses();

  /**
   * Files the claim, then uploads its receipt onto it. The receipt goes up
   * as a file after the claim exists: inline in the claim it would hit the
   * API's body limit. A failed upload leaves the claim filed, and says so.
   */
  const createClaim = async (payload: CreateExpenseClaimPayload, receipt?: File | null) => {
    const claim = await createMutation.mutateAsync(payload);
    if (!receipt) return claim;
    try {
      const withReceipt = await api.expenses.uploadReceipt(claim.id, receipt);
      invalidateExpense(claim.id);
      return withReceipt;
    } catch (error) {
      toast.warning(
        `Claim #${claim.claimNumber || claim.id.slice(0, 8)} is filed, but the receipt could not be attached: ${describe(error, 'upload failed')}`,
      );
      return claim;
    }
  };

  const updateClaim = async (id: string, payload: UpdateExpenseClaimPayload) => {
    return updateMutation.mutateAsync({ id, payload });
  };

  const signalClaim = async (id: string, payload: SignalExpenseClaimPayload) => {
    return signalMutation.mutateAsync({ id, payload });
  };

  return {
    ...query,
    expenses: query.data ?? [],
    claims: query.data ?? [],
    createClaim,
    updateClaim,
    signalClaim,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSignaling: signalMutation.isPending,
  };
}

export function useExpense(id: string | null | undefined) {
  const query = useQuery({
    queryKey: id ? queryKeys.expense(id) : ['finance', 'expenses', 'none'],
    queryFn: () => (id ? api.expenses.get(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  });

  const updateMutation = useUpdateExpenseClaim();
  const signalMutation = useSignalExpenseClaim();

  const updateClaim = async (payload: UpdateExpenseClaimPayload) => {
    if (!id) throw new Error('No expense claim ID provided');
    return updateMutation.mutateAsync({ id, payload });
  };

  const signalClaim = async (payload: SignalExpenseClaimPayload) => {
    if (!id) throw new Error('No expense claim ID provided');
    return signalMutation.mutateAsync({ id, payload });
  };

  return {
    ...query,
    expense: query.data ?? null,
    claim: query.data ?? null,
    updateClaim,
    signalClaim,
    isUpdating: updateMutation.isPending,
    isSignaling: signalMutation.isPending,
  };
}

export interface ReceiptSource {
  /** What an <img> or a link can point at, or null while a stored file's link loads. */
  src: string | null;
  isPdf: boolean;
  isLoading: boolean;
}

/**
 * The receipt on a claim, as something the browser can show.
 *
 * A stored receipt is an attachment: it is fetched through a short-lived
 * signed link, re-requested shortly before that link expires. Older claims
 * hold a link or an inline data URL, which are shown as they are.
 */
export function useReceiptSource(receiptUrl: string | null | undefined): ReceiptSource {
  const attachmentId = receiptAttachmentId(receiptUrl);
  const link = useQuery({
    queryKey: ['attachments', 'link', attachmentId ?? ''],
    queryFn: () => api.attachments.link(attachmentId as string),
    enabled: Boolean(attachmentId),
    // Fresh until fifteen seconds before the signature stops working.
    staleTime: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now() - 15_000) : 0;
    },
  });

  if (!receiptUrl) return { src: null, isPdf: false, isLoading: false };
  if (!attachmentId) {
    return {
      src: receiptUrl,
      isPdf: receiptUrl.startsWith('data:application/pdf') || /\.pdf(?:$|[?#])/i.test(receiptUrl),
      isLoading: false,
    };
  }
  return {
    src: link.data?.url ?? null,
    isPdf: /\.pdf$/i.test(link.data?.filename ?? ''),
    isLoading: link.isPending,
  };
}
