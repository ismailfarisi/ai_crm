/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  ContactDto,
  ContactStatsDto,
  CreateContactPayload,
  PaginatedResult,
  UpdateContactPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface ContactListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  source?: string;
  ownerId?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export const contactsEndpoints = {
  contacts: {
    list: (params: ContactListParams = {}) =>
      apiFetch<PaginatedResult<ContactDto>>('/contacts', { query: params }),
    stats: () => apiFetch<ContactStatsDto>('/contacts/stats'),
    get: (id: string) => apiFetch<ContactDto>(`/contacts/${id}`),
    create: (input: CreateContactPayload) =>
      apiFetch<ContactDto>('/contacts', { method: 'POST', body: input }),
    update: (id: string, input: UpdateContactPayload) =>
      apiFetch<ContactDto>(`/contacts/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/contacts/${id}`, { method: 'DELETE' }),
  },
};

export const contactsKeys = {
  contacts: (params: ContactListParams = {}) => ['contacts', params] as const,  contact: (id: string) => ['contacts', id] as const,  contactStats: ['contacts', 'stats'] as const,};
