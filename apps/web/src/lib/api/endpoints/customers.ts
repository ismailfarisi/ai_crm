/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  CreateCustomerPayload,
  CustomerDto,
  CustomerOverviewDto,
  PaginatedResult,
  UpdateCustomerPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface CustomerListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export const customersEndpoints = {
  customers: {
    list: (params: CustomerListParams = {}) =>
      apiFetch<PaginatedResult<CustomerDto>>('/customers', { query: params }),
    get: (id: string) => apiFetch<CustomerDto>(`/customers/${id}`),
    /** Their quotes, orders, invoices and balance, shaped by the API. */
    overview: (id: string) =>
      apiFetch<CustomerOverviewDto>(`/customers/${id}/overview`),
    create: (input: CreateCustomerPayload) =>
      apiFetch<CustomerDto>('/customers', { method: 'POST', body: input }),
    update: (id: string, input: UpdateCustomerPayload) =>
      apiFetch<CustomerDto>(`/customers/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/customers/${id}`, { method: 'DELETE' }),
  },
};

export const customersKeys = {
  customers: (params: CustomerListParams = {}) => ['customers', params] as const,  customer: (id: string) => ['customers', id] as const,  customerOverview: (id: string) => ['customers', id, 'overview'] as const,};
