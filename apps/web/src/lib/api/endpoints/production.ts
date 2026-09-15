/* One slice of the browser's API surface. Composed in ./index.ts. */
import type { VarianceRow, WorkOrderDto, WorkOrderStatus } from '@saas/shared';
import { apiFetch } from '../client';

export interface WorkOrderListParams {
  status?: WorkOrderStatus;
  workCenterId?: string;
  salesOrderId?: string;
  dueBefore?: string;
}

export interface CreateWorkOrdersResultDto {
  created: WorkOrderDto[];
  skipped: { salesOrderLineId: string; description: string; reason: string }[];
}

export interface VarianceReportDto {
  rows: VarianceRow[];
  jobs: number;
  from: string | null;
  to: string | null;
}

export const productionEndpoints = {
  workOrders: {
    list: (params: WorkOrderListParams = {}) => apiFetch<WorkOrderDto[]>('/work-orders', { query: params }),
    get: (id: string) => apiFetch<WorkOrderDto>(`/work-orders/${id}`),
    variance: (params: { from?: string; to?: string } = {}) =>
      apiFetch<VarianceReportDto>('/work-orders/variance', { query: params }),
    createFromSalesOrder: (salesOrderId: string, input: { salesOrderLineIds?: string[] | null; dueDate?: string | null }) =>
      apiFetch<CreateWorkOrdersResultDto>(`/sales-orders/${salesOrderId}/work-orders`, {
        method: 'POST',
        body: input,
      }),
    release: (id: string) => apiFetch<WorkOrderDto>(`/work-orders/${id}/release`, { method: 'POST' }),
    complete: (id: string, qtyCompleted: number | null) =>
      apiFetch<WorkOrderDto>(`/work-orders/${id}/complete`, { method: 'POST', body: { qtyCompleted } }),
    cancel: (id: string, reason: string | null) =>
      apiFetch<WorkOrderDto>(`/work-orders/${id}/cancel`, { method: 'POST', body: { reason } }),
    start: (id: string, operationId: string) =>
      apiFetch<WorkOrderDto>(`/work-orders/${id}/operations/${operationId}/start`, { method: 'POST' }),
    stop: (id: string, operationId: string) =>
      apiFetch<{ workOrder: WorkOrderDto; capped: boolean }>(`/work-orders/${id}/operations/${operationId}/stop`, {
        method: 'POST',
      }),
    finish: (id: string, operationId: string) =>
      apiFetch<{ workOrder: WorkOrderDto; capped: boolean }>(`/work-orders/${id}/operations/${operationId}/finish`, {
        method: 'POST',
      }),
    logTime: (id: string, operationId: string, minutes: number) =>
      apiFetch<WorkOrderDto>(`/work-orders/${id}/operations/${operationId}/time`, {
        method: 'POST',
        body: { minutes },
      }),
    issue: (id: string, workOrderMaterialId: string, qty: number) =>
      apiFetch<WorkOrderDto>(`/work-orders/${id}/materials`, {
        method: 'POST',
        body: { workOrderMaterialId, qty },
      }),
  },
};

export const productionKeys = {
  workOrders: (params: WorkOrderListParams = {}) => ['work-orders', params] as const,
  workOrder: (id: string) => ['work-orders', id] as const,
  workOrderVariance: (params: { from?: string; to?: string } = {}) => ['work-orders', 'variance', params] as const,
};
