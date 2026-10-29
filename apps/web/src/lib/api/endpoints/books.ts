/* One slice of the browser's API surface. Composed in ./index.ts.
 * Keeping the books: the period lock, manual journals, the chart of accounts,
 * bank reconciliation and the VAT return. */
import type {
  AutoMatchResult,
  BankStatementLineDto,
  CreateBankMatchPayload,
  CreateLedgerAccountPayload,
  CreateManualJournalPayload,
  ImportStatementPayload,
  ImportStatementResult,
  JournalEntryDto,
  JournalEntryListParams,
  LedgerAccountDto,
  PeriodLockDto,
  PostStatementLinePayload,
  ReconciliationDto,
  ReverseJournalPayload,
  TrialBalanceDto,
  UpdateLedgerAccountPayload,
  Vat201Dto,
} from '@saas/shared';
import { apiFetch } from '../client';

export const booksEndpoints = {
  books: {
    periodLock: () => apiFetch<PeriodLockDto>('/finance/period-lock'),
    setPeriodLock: (lockedThrough: string | null) =>
      apiFetch<PeriodLockDto>('/finance/period-lock', { method: 'PUT', body: { lockedThrough } }),

    journals: (params: JournalEntryListParams = {}) =>
      apiFetch<JournalEntryDto[]>('/finance/journal-entries', { query: params }),
    postJournal: (payload: CreateManualJournalPayload) =>
      apiFetch<JournalEntryDto>('/finance/journal-entries', { method: 'POST', body: payload }),
    reverseJournal: (id: string, payload: ReverseJournalPayload = {}) =>
      apiFetch<JournalEntryDto>(`/finance/journal-entries/${id}/reverse`, { method: 'POST', body: payload }),

    ledgerAccounts: () => apiFetch<LedgerAccountDto[]>('/finance/ledger-accounts'),
    trialBalance: () => apiFetch<TrialBalanceDto>('/finance/trial-balance'),
    createAccount: (payload: CreateLedgerAccountPayload) =>
      apiFetch<LedgerAccountDto>('/finance/ledger-accounts', { method: 'POST', body: payload }),
    updateAccount: (id: string, payload: UpdateLedgerAccountPayload) =>
      apiFetch<LedgerAccountDto>(`/finance/ledger-accounts/${id}`, { method: 'PATCH', body: payload }),
    deleteAccount: (id: string) =>
      apiFetch<{ id: string }>(`/finance/ledger-accounts/${id}`, { method: 'DELETE' }),

    reconciliation: (financeAccountId: string) =>
      apiFetch<ReconciliationDto>(`/finance/accounts/${financeAccountId}/reconciliation`),
    importStatement: (payload: ImportStatementPayload) =>
      apiFetch<ImportStatementResult>('/finance/bank-statements', { method: 'POST', body: payload }),
    matchLine: (lineId: string, journalEntryId: string) =>
      apiFetch<BankStatementLineDto>(`/finance/bank-statement-lines/${lineId}/match`, {
        method: 'POST',
        body: { journalEntryId },
      }),
    /** Several lines and/or several entries as one match. */
    createMatch: (payload: CreateBankMatchPayload) =>
      apiFetch<BankStatementLineDto[]>('/finance/bank-matches', { method: 'POST', body: payload }),
    autoMatch: (financeAccountId: string) =>
      apiFetch<AutoMatchResult>(`/finance/accounts/${financeAccountId}/auto-match`, { method: 'POST' }),
    unmatchLine: (lineId: string) =>
      apiFetch<BankStatementLineDto>(`/finance/bank-statement-lines/${lineId}/unmatch`, { method: 'POST' }),
    excludeLine: (lineId: string) =>
      apiFetch<BankStatementLineDto>(`/finance/bank-statement-lines/${lineId}/exclude`, { method: 'POST' }),
    postLine: (lineId: string, payload: PostStatementLinePayload) =>
      apiFetch<BankStatementLineDto>(`/finance/bank-statement-lines/${lineId}/post`, {
        method: 'POST',
        body: payload,
      }),

    vatReturn: (from: string, to: string) =>
      apiFetch<Vat201Dto>('/finance/vat/return', { query: { from, to } }),
  },
};

export const booksKeys = {
  periodLock: ['finance', 'period-lock'] as const,
  journals: (params: JournalEntryListParams = {}) => ['finance', 'journal-entries', params] as const,
  ledgerAccounts: ['finance', 'ledger-accounts'] as const,
  trialBalance: ['finance', 'trial-balance'] as const,
  reconciliation: (financeAccountId: string) => ['finance', 'reconciliation', financeAccountId] as const,
  vatReturn: (from: string, to: string) => ['tax', 'vat-return', from, to] as const,
};
