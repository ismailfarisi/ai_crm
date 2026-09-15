/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  AgingReportDto,
  BillPaymentDto,
  BillableOrderLineDto,
  BillReasonPayload,
  CreateBillPayload,
  LineVariance,
  PaginatedResult,
  RecordBillPaymentPayload,
  SupplierBillDto,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface BillListParams {
  page?: number;
  limit?: number;
  status?: string;
  supplierId?: string;
  purchaseOrderId?: string;
}

export interface BillMatchDto {
  status: string;
  variances: (LineVariance & { lineIndex: number })[];
}

export const payablesEndpoints = {
  bills: {
    list: (params: BillListParams = {}) =>
      apiFetch<PaginatedResult<SupplierBillDto>>('/bills', { query: params }),
    get: (id: string) => apiFetch<SupplierBillDto>(`/bills/${id}`),
    match: (id: string) => apiFetch<BillMatchDto>(`/bills/${id}/match`),
    payments: (id: string) => apiFetch<BillPaymentDto[]>(`/bills/${id}/payments`),
    aging: () => apiFetch<AgingReportDto>('/bills/aging'),
    billable: (purchaseOrderId: string) =>
      apiFetch<BillableOrderLineDto[]>(`/purchase-orders/${purchaseOrderId}/billable`),
    create: (input: CreateBillPayload) =>
      apiFetch<SupplierBillDto>('/bills', { method: 'POST', body: input }),
    approve: (id: string) => apiFetch<SupplierBillDto>(`/bills/${id}/approve`, { method: 'POST' }),
    dispute: (id: string, input: BillReasonPayload) =>
      apiFetch<SupplierBillDto>(`/bills/${id}/dispute`, { method: 'POST', body: input }),
    reopen: (id: string) => apiFetch<SupplierBillDto>(`/bills/${id}/reopen`, { method: 'POST' }),
    cancel: (id: string) => apiFetch<SupplierBillDto>(`/bills/${id}/cancel`, { method: 'POST' }),
    pay: (id: string, input: RecordBillPaymentPayload) =>
      apiFetch<SupplierBillDto>(`/bills/${id}/payments`, { method: 'POST', body: input }),
    reversePayment: (id: string, paymentId: string) =>
      apiFetch<SupplierBillDto>(`/bills/${id}/payments/${paymentId}/reverse`, { method: 'POST' }),
  },
};

export const payablesKeys = {
  bills: (params: BillListParams = {}) => ['bills', params] as const,
  bill: (id: string) => ['bills', id] as const,
  billMatch: (id: string) => ['bills', id, 'match'] as const,
  billPayments: (id: string) => ['bills', id, 'payments'] as const,
  billAging: ['bills', 'aging'] as const,
  billableLines: (purchaseOrderId: string) => ['bills', 'billable', purchaseOrderId] as const,
};
