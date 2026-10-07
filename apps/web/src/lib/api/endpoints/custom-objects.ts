/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  CustomObjectDefinitionDto,
  CustomAttributeDefinitionDto,
  CustomRecordDto,
  CustomRecordLinkDto,
  CreateCustomObjectPayload,
  UpdateCustomObjectPayload,
  CreateCustomAttributePayload,
  CreateCustomRecordPayload,
  UpdateCustomRecordPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface RecordListParams {
  page?: number;
  limit?: number;
  search?: string;
  filters?: Record<string, any>;
  [key: string]: unknown;
}

export interface CustomRecordListResponse {
  items: CustomRecordDto[];
  total: number;
  page: number;
  limit: number;
  object?: CustomObjectDefinitionDto;
}

export const customObjectsEndpoints = {
  customObjects: {
    list: () => apiFetch<CustomObjectDefinitionDto[]>('/custom-objects'),
    getBySlug: (slug: string) =>
      apiFetch<CustomObjectDefinitionDto>(`/custom-objects/${slug}`),
    create: (data: CreateCustomObjectPayload) =>
      apiFetch<CustomObjectDefinitionDto>('/custom-objects', {
        method: 'POST',
        body: data,
      }),
    update: (slug: string, data: UpdateCustomObjectPayload) =>
      apiFetch<CustomObjectDefinitionDto>(`/custom-objects/${slug}`, {
        method: 'PATCH',
        body: data,
      }),
    archive: (slug: string) =>
      apiFetch<void>(`/custom-objects/${slug}`, { method: 'DELETE' }),
    addAttribute: (slug: string, data: CreateCustomAttributePayload) =>
      apiFetch<CustomAttributeDefinitionDto>(`/custom-objects/${slug}/attributes`, {
        method: 'POST',
        body: data,
      }),
    deleteAttribute: (slug: string, attrSlug: string) =>
      apiFetch<void>(`/custom-objects/${slug}/attributes/${attrSlug}`, {
        method: 'DELETE',
      }),
    listRecords: (slug: string, params?: RecordListParams) =>
      apiFetch<CustomRecordListResponse>(`/objects/${slug}/records`, {
        query: params,
      }),
    getRecord: (slug: string, id: string) =>
      apiFetch<CustomRecordDto>(`/objects/${slug}/records/${id}`),
    createRecord: (slug: string, data: CreateCustomRecordPayload) =>
      apiFetch<CustomRecordDto>(`/objects/${slug}/records`, {
        method: 'POST',
        body: data,
      }),
    updateRecord: (slug: string, id: string, data: UpdateCustomRecordPayload) =>
      apiFetch<CustomRecordDto>(`/objects/${slug}/records/${id}`, {
        method: 'PATCH',
        body: data,
      }),
    deleteRecord: (slug: string, id: string) =>
      apiFetch<void>(`/objects/${slug}/records/${id}`, { method: 'DELETE' }),
    getReverseLinks: (targetType: string, targetId: string) =>
      apiFetch<CustomRecordLinkDto[]>('/objects/links/reverse', {
        query: { targetType, targetId },
      }),
  },
};

const customObjectsQueryKey = Object.assign(
  (slug?: string) =>
    slug ? (['custom-objects', slug] as const) : (['custom-objects'] as const),
  {
    all: ['custom-objects'] as const,
    bySlug: (slug: string) => ['custom-objects', slug] as const,
    records: (slug: string, params?: RecordListParams) =>
      params !== undefined
        ? (['custom-objects', slug, 'records', params] as const)
        : (['custom-objects', slug, 'records'] as const),
    record: (slug: string, id: string) =>
      ['custom-objects', slug, 'records', id] as const,
    reverseLinks: (targetType: string, targetId: string) =>
      ['custom-objects', 'reverse-links', targetType, targetId] as const,
  },
);

export const customObjectsKeys = {
  customObjects: customObjectsQueryKey,
};

export const customObjectsApi = customObjectsEndpoints.customObjects;
