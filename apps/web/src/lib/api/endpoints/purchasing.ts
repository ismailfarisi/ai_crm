/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  CreateSupplierPayload,
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
};

export const purchasingKeys = {
  suppliers: (params: SupplierListParams = {}) => ['suppliers', params] as const,
  supplier: (id: string) => ['suppliers', id] as const,
  supplierMaterials: (id: string) => ['suppliers', id, 'materials'] as const,
};
