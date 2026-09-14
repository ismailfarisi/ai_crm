/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  CancelPurchaseOrderPayload,
  CreatePurchaseOrderPayload,
  CreateSupplierPayload,
  PurchaseGuardrailViolation,
  PurchaseOrderDto,
  PurchasePolicy,
  SuggestPurchaseOrderPayload,
  UpdatePurchasePolicyPayload,
  PaginatedResult,
  ReplaceSupplierMaterialsPayload,
  SupplierDto,
  SupplierMaterialDto,
  UpdateSupplierPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface SupplierListParams {
  page?: number;
  limit?: number;
  search?: string;
  includeInactive?: boolean;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PurchaseOrderListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  supplierId?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

/** What `/purchase-orders/suggest` hands back: drafts to review, nothing created. */
export interface PurchaseSuggestionDto {
  orders: {
    supplierId: string;
    supplierName: string;
    currency: string;
    leadTimeDays: number | null;
    totalAmount: number;
    lines: {
      materialId: string;
      description: string;
      qtyOrdered: number;
      uom: string;
      unitCost: number;
      lineTotal: number;
      note?: string;
    }[];
  }[];
  unsourced: {
    materialId: string;
    materialName: string;
    uom: string;
    purchaseUnits: number;
    reason: string;
  }[];
}

export const purchasingEndpoints = {
  suppliers: {
    list: (params: SupplierListParams = {}) =>
      apiFetch<PaginatedResult<SupplierDto>>('/suppliers', { query: params }),
    get: (id: string) => apiFetch<SupplierDto>(`/suppliers/${id}`),
    create: (input: CreateSupplierPayload) =>
      apiFetch<SupplierDto>('/suppliers', { method: 'POST', body: input }),
    update: (id: string, input: UpdateSupplierPayload) =>
      apiFetch<SupplierDto>(`/suppliers/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/suppliers/${id}`, { method: 'DELETE' }),
    materials: (id: string) =>
      apiFetch<SupplierMaterialDto[]>(`/suppliers/${id}/materials`),
    replaceMaterials: (id: string, input: ReplaceSupplierMaterialsPayload) =>
      apiFetch<SupplierMaterialDto[]>(`/suppliers/${id}/materials`, {
        method: 'PUT',
        body: input,
      }),
  },

  purchaseOrders: {
    list: (params: PurchaseOrderListParams = {}) =>
      apiFetch<PaginatedResult<PurchaseOrderDto>>('/purchase-orders', { query: params }),
    get: (id: string) => apiFetch<PurchaseOrderDto>(`/purchase-orders/${id}`),
    guardrails: (id: string) =>
      apiFetch<PurchaseGuardrailViolation[]>(`/purchase-orders/${id}/guardrails`),
    create: (input: CreatePurchaseOrderPayload) =>
      apiFetch<PurchaseOrderDto>('/purchase-orders', { method: 'POST', body: input }),
    suggest: (input: SuggestPurchaseOrderPayload) =>
      apiFetch<PurchaseSuggestionDto>('/purchase-orders/suggest', {
        method: 'POST',
        body: input,
      }),
    submit: (id: string) =>
      apiFetch<PurchaseOrderDto>(`/purchase-orders/${id}/submit`, { method: 'POST' }),
    reopen: (id: string) =>
      apiFetch<PurchaseOrderDto>(`/purchase-orders/${id}/reopen`, { method: 'POST' }),
    approve: (id: string) =>
      apiFetch<PurchaseOrderDto>(`/purchase-orders/${id}/approve`, { method: 'POST' }),
    send: (id: string) =>
      apiFetch<PurchaseOrderDto>(`/purchase-orders/${id}/send`, { method: 'POST' }),
    closeShort: (id: string, input: CancelPurchaseOrderPayload) =>
      apiFetch<PurchaseOrderDto>(`/purchase-orders/${id}/close-short`, {
        method: 'POST',
        body: input,
      }),
    cancel: (id: string, input: CancelPurchaseOrderPayload) =>
      apiFetch<PurchaseOrderDto>(`/purchase-orders/${id}/cancel`, {
        method: 'POST',
        body: input,
      }),
  },

  purchasePolicy: {
    get: () => apiFetch<PurchasePolicy>('/purchase-policy'),
    update: (input: UpdatePurchasePolicyPayload) =>
      apiFetch<PurchasePolicy>('/purchase-policy', { method: 'PATCH', body: input }),
  },
};

export const purchasingKeys = {
  suppliers: (params: SupplierListParams = {}) => ['suppliers', params] as const,
  supplier: (id: string) => ['suppliers', id] as const,
  supplierMaterials: (id: string) => ['suppliers', id, 'materials'] as const,
  purchaseOrders: (params: PurchaseOrderListParams = {}) =>
    ['purchase-orders', params] as const,
  purchaseOrder: (id: string) => ['purchase-orders', id] as const,
  purchaseOrderGuardrails: (id: string) => ['purchase-orders', id, 'guardrails'] as const,
  purchasePolicy: ['purchase-policy'] as const,
};
