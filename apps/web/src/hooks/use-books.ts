'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateBankMatchPayload,
  CreateLedgerAccountPayload,
  CreateManualJournalPayload,
  ImportStatementPayload,
  JournalEntryListParams,
  PostStatementLinePayload,
  UpdateLedgerAccountPayload,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

const describe = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.message ? error.message : fallback;

/** Anything that posts moves balances, reports and the reconciliation at once. */
function useInvalidateFinance() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['finance'] });
}

/* ---------------- period lock ---------------- */

export function usePeriodLock() {
  return useQuery({ queryKey: queryKeys.periodLock, queryFn: () => api.books.periodLock() });
}

export function useSetPeriodLock() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (lockedThrough: string | null) => api.books.setPeriodLock(lockedThrough),
    onSuccess: async (lock) => {
      await invalidate();
      toast.success(lock.lockedThrough ? `Books locked through ${lock.lockedThrough}` : 'Books reopened');
    },
    onError: (error) => toast.error(describe(error, 'Could not change the lock')),
  });
}

/* ---------------- journal ---------------- */

export function useJournals(params: JournalEntryListParams) {
  return useQuery({ queryKey: queryKeys.journals(params), queryFn: () => api.books.journals(params) });
}

export function usePostJournal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (payload: CreateManualJournalPayload) => api.books.postJournal(payload),
    onSuccess: async (entry) => {
      await invalidate();
      toast.success(`${entry.entryNumber} posted`);
    },
    onError: (error) => toast.error(describe(error, 'The journal was not posted')),
  });
}

export function useReverseJournal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, entryDate }: { id: string; entryDate?: string }) =>
      api.books.reverseJournal(id, entryDate ? { entryDate } : {}),
    onSuccess: async (entry) => {
      await invalidate();
      toast.success(`Reversed by ${entry.entryNumber}`);
    },
    onError: (error) => toast.error(describe(error, 'The journal was not reversed')),
  });
}

/* ---------------- chart of accounts ---------------- */

export function useLedgerAccounts() {
  return useQuery({ queryKey: queryKeys.ledgerAccounts, queryFn: () => api.books.ledgerAccounts() });
}

export function useTrialBalance() {
  return useQuery({ queryKey: queryKeys.trialBalance, queryFn: () => api.books.trialBalance() });
}

export function useLedgerAccountAction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'create'; payload: CreateLedgerAccountPayload }
        | { kind: 'update'; id: string; payload: UpdateLedgerAccountPayload }
        | { kind: 'delete'; id: string },
    ) => {
      switch (action.kind) {
        case 'create':
          return api.books.createAccount(action.payload);
        case 'update':
          return api.books.updateAccount(action.id, action.payload);
        case 'delete':
          return api.books.deleteAccount(action.id);
      }
    },
    onSuccess: async (_result, action) => {
      await invalidate();
      toast.success(action.kind === 'create' ? 'Account added' : action.kind === 'delete' ? 'Account deleted' : 'Saved');
    },
    onError: (error) => toast.error(describe(error, 'That did not go through')),
  });
}

/* ---------------- bank reconciliation ---------------- */

export function useReconciliation(financeAccountId: string) {
  return useQuery({
    queryKey: queryKeys.reconciliation(financeAccountId),
    queryFn: () => api.books.reconciliation(financeAccountId),
  });
}

export function useImportStatement() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (payload: ImportStatementPayload) => api.books.importStatement(payload),
    onSuccess: async (result) => {
      await invalidate();
      toast.success(
        `${result.imported} line(s) imported${result.skipped ? `, ${result.skipped} already there` : ''}`,
      );
    },
    onError: (error) => toast.error(describe(error, 'The statement was not imported')),
  });
}

export function useStatementLineAction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'match'; lineId: string; journalEntryId: string }
        | { kind: 'unmatch'; lineId: string }
        | { kind: 'exclude'; lineId: string }
        | { kind: 'post'; lineId: string; payload: PostStatementLinePayload },
    ) => {
      switch (action.kind) {
        case 'match':
          return api.books.matchLine(action.lineId, action.journalEntryId);
        case 'unmatch':
          return api.books.unmatchLine(action.lineId);
        case 'exclude':
          return api.books.excludeLine(action.lineId);
        case 'post':
          return api.books.postLine(action.lineId, action.payload);
      }
    },
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(describe(error, 'That did not go through')),
  });
}

/** Several statement lines and/or several entries, matched as one. */
export function useCreateBankMatch() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (payload: CreateBankMatchPayload) => api.books.createMatch(payload),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(describe(error, 'That match did not go through')),
  });
}

/** Applies every certain suggestion, and says how many. */
export function useAutoMatch() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (financeAccountId: string) => api.books.autoMatch(financeAccountId),
    onSuccess: async (result) => {
      await invalidate();
      toast.success(result.matched ? `${result.matched} line(s) matched` : 'Nothing was certain enough to match');
    },
    onError: (error) => toast.error(describe(error, 'Auto-match did not go through')),
  });
}

/* ---------------- VAT return ---------------- */

export function useVatReturn(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.vatReturn(from, to),
    // Same bounds as the tax report on the same page, so the two agree.
    queryFn: () => api.books.vatReturn(from, to),
    enabled: enabled && Boolean(from && to),
    retry: false,
  });
}
