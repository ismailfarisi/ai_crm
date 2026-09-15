/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  CreateCreditNotePayload,
  CreateDeliveryNotePayload,
  CreditNoteDto,
  CreditNoteRefundDto,
  DeliveryNoteDto,
  RefundCreditNotePayload,
  TaxCodeDto,
  TaxCodePayload,
  TaxReportDto,
  TaxRuleDto,
  TaxRulePayload,
} from '@saas/shared';
import { apiFetch, apiFetchBlob } from '../client';

type DraftCreditInput = Omit<CreateCreditNotePayload, 'lines' | 'netAmount' | 'full'> & {
  lines?: CreateCreditNotePayload['lines'];
  netAmount?: number | null;
  full?: boolean;
};

export const creditsEndpoints = {
  creditNotes: {
    list: (invoiceId?: string) => apiFetch<CreditNoteDto[]>('/credit-notes', { query: { invoiceId } }),
    get: (id: string) => apiFetch<CreditNoteDto>(`/credit-notes/${id}`),
    refunds: (id: string) => apiFetch<CreditNoteRefundDto[]>(`/credit-notes/${id}/refunds`),
    create: (invoiceId: string, input: DraftCreditInput) =>
      apiFetch<CreditNoteDto>(`/invoices/${invoiceId}/credit-notes`, { method: 'POST', body: input }),
    issue: (id: string) => apiFetch<CreditNoteDto>(`/credit-notes/${id}/issue`, { method: 'POST' }),
    cancel: (id: string) => apiFetch<CreditNoteDto>(`/credit-notes/${id}/cancel`, { method: 'POST' }),
    refund: (id: string, input: Partial<RefundCreditNotePayload> & { financeAccountId: string }) =>
      apiFetch<CreditNoteDto>(`/credit-notes/${id}/refunds`, { method: 'POST', body: input }),
  },
  deliveryNotes: {
    listForOrder: (salesOrderId: string) =>
      apiFetch<DeliveryNoteDto[]>(`/sales-orders/${salesOrderId}/delivery-notes`),
    create: (salesOrderId: string, input: Partial<CreateDeliveryNotePayload> & Pick<CreateDeliveryNotePayload, 'lines'>) =>
      apiFetch<DeliveryNoteDto>(`/sales-orders/${salesOrderId}/delivery-notes`, { method: 'POST', body: input }),
    dispatch: (id: string) => apiFetch<DeliveryNoteDto>(`/delivery-notes/${id}/dispatch`, { method: 'POST' }),
    cancel: (id: string) => apiFetch<DeliveryNoteDto>(`/delivery-notes/${id}/cancel`, { method: 'POST' }),
    invoice: (id: string) =>
      apiFetch<{ delivery: DeliveryNoteDto; invoiceId: string }>(`/delivery-notes/${id}/invoice`, { method: 'POST' }),
    packingSlip: (id: string) => apiFetchBlob(`/delivery-notes/${id}/pdf`),
  },
  tax: {
    codes: () => apiFetch<TaxCodeDto[]>('/finance/tax-codes'),
    createCode: (input: TaxCodePayload) => apiFetch<TaxCodeDto>('/finance/tax-codes', { method: 'POST', body: input }),
    updateCode: (id: string, input: TaxCodePayload) =>
      apiFetch<TaxCodeDto>(`/finance/tax-codes/${id}`, { method: 'PUT', body: input }),
    rules: () => apiFetch<TaxRuleDto[]>('/finance/tax-rules'),
    createRule: (input: TaxRulePayload) => apiFetch<TaxRuleDto>('/finance/tax-rules', { method: 'POST', body: input }),
    deleteRule: (id: string) => apiFetch<void>(`/finance/tax-rules/${id}`, { method: 'DELETE' }),
    report: (from: string, to: string) => apiFetch<TaxReportDto>('/finance/tax-report', { query: { from, to } }),
  },
};

export const creditsKeys = {
  creditNotes: (invoiceId?: string) => ['credit-notes', invoiceId ?? 'all'] as const,
  creditNoteRefunds: (id: string) => ['credit-notes', id, 'refunds'] as const,
  deliveryNotes: (salesOrderId: string) => ['delivery-notes', salesOrderId] as const,
  taxCodes: ['tax', 'codes'] as const,
  taxRules: ['tax', 'rules'] as const,
  taxReport: (from: string, to: string) => ['tax', 'report', from, to] as const,
};
