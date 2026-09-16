/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  AttachmentDto,
  AttachmentLinkDto,
  AttachmentOwnerType,
  AuditLogDto,
  AuditPageDto,
  BalanceSheetDto,
  CurrencySettingsDto,
  FxRateDto,
  MarginReportDto,
  NotificationDto,
  PlanDto,
  ProfitAndLossDto,
  ReceivablesAgingDto,
  RevaluationResultDto,
  SubscriptionDto,
  TrialBalanceDto,
} from '@saas/shared';
import { apiFetch, apiFetchBlob, apiUpload } from '../client';

export type FinancialReport = 'trial-balance' | 'profit-and-loss' | 'balance-sheet' | 'receivables-aging' | 'margins';

export interface ReportParams {
  from?: string;
  to?: string;
  asOf?: string;
  by?: 'customer' | 'template';
}

export interface AuditFilters {
  subjectType?: string;
  actorId?: string;
  action?: string;
  origin?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const platformEndpoints = {
  audit: {
    list: (filters: AuditFilters) => apiFetch<AuditPageDto>('/audit', { query: filters }),
    forSubject: (subjectType: string, subjectId: string) =>
      apiFetch<AuditLogDto[]>(`/audit/${subjectType}/${subjectId}`),
  },
  attachments: {
    list: (ownerType: AttachmentOwnerType, ownerId: string) =>
      apiFetch<AttachmentDto[]>('/attachments', { query: { ownerType, ownerId } }),
    upload: (ownerType: AttachmentOwnerType, ownerId: string, file: File) =>
      apiUpload<AttachmentDto>('/attachments', file, { query: { ownerType, ownerId } }),
    link: (id: string) => apiFetch<AttachmentLinkDto>(`/attachments/${id}/link`),
    remove: (id: string) => apiFetch<void>(`/attachments/${id}`, { method: 'DELETE' }),
  },
  notifications: {
    list: () => apiFetch<{ items: NotificationDto[]; unread: number }>('/notifications'),
    read: (id: string) => apiFetch<void>(`/notifications/${id}/read`, { method: 'POST' }),
    readAll: () => apiFetch<void>('/notifications/read-all', { method: 'POST' }),
  },
  billing: {
    plans: () => apiFetch<PlanDto[]>('/billing/plans'),
    subscription: () => apiFetch<SubscriptionDto>('/billing/subscription'),
    checkout: (planCode: string) =>
      apiFetch<{ url: string }>('/billing/checkout', { method: 'POST', body: { planCode } }),
    cancel: () => apiFetch<SubscriptionDto>('/billing/cancel', { method: 'POST' }),
    fakeComplete: (session: string) =>
      apiFetch<SubscriptionDto>('/billing/fake/complete', { method: 'POST', body: { session } }),
    fakeFail: () => apiFetch<SubscriptionDto>('/billing/fake/fail-payment', { method: 'POST' }),
  },
  currencies: {
    settings: () => apiFetch<CurrencySettingsDto>('/finance/currencies'),
    setBase: (baseCurrency: string) =>
      apiFetch<CurrencySettingsDto>('/finance/currencies/base', { method: 'PUT', body: { baseCurrency } }),
    rates: (currency?: string) => apiFetch<FxRateDto[]>('/finance/fx-rates', { query: { currency } }),
    upsertRate: (input: { currency: string; rateDate: string; rate: number }) =>
      apiFetch<FxRateDto>('/finance/fx-rates', { method: 'POST', body: input }),
    deleteRate: (id: string) => apiFetch<void>(`/finance/fx-rates/${id}`, { method: 'DELETE' }),
    revalue: (period: string) =>
      apiFetch<RevaluationResultDto>('/finance/fx/revaluation', { method: 'POST', body: { period } }),
  },
  reports: {
    trialBalance: (p: ReportParams) => apiFetch<TrialBalanceDto>('/finance/reports/trial-balance', { query: p }),
    profitAndLoss: (p: ReportParams) => apiFetch<ProfitAndLossDto>('/finance/reports/profit-and-loss', { query: p }),
    balanceSheet: (p: ReportParams) => apiFetch<BalanceSheetDto>('/finance/reports/balance-sheet', { query: p }),
    receivablesAging: (p: ReportParams) =>
      apiFetch<ReceivablesAgingDto>('/finance/reports/receivables-aging', { query: p }),
    margins: (p: ReportParams) => apiFetch<MarginReportDto>('/finance/reports/margins', { query: p }),
    csv: (report: FinancialReport, p: ReportParams) =>
      apiFetchBlob(`/finance/reports/${report}`, { query: { ...p, format: 'csv' } }),
  },
};

export const platformKeys = {
  audit: (filters: AuditFilters) => ['audit', filters] as const,
  auditForSubject: (subjectType: string, subjectId: string) =>
    ['audit', subjectType, subjectId] as const,
  attachments: (ownerType: string, ownerId: string) =>
    ['attachments', ownerType, ownerId] as const,
  notifications: ['notifications'] as const,
  billingPlans: ['billing', 'plans'] as const,
  subscription: ['billing', 'subscription'] as const,
  currencySettings: ['finance', 'currencies'] as const,
  fxRates: ['finance', 'fx-rates'] as const,
  financialReport: (report: FinancialReport, p: ReportParams) => ['finance', 'reports', report, p] as const,
};
