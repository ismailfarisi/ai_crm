/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  SavedViewDto,
  CreateSavedViewInput,
  CreateSavedViewPayload,
  UpdateSavedViewInput,
  UpdateSavedViewPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export const savedViewsEndpoints = {
  savedViews: {
    list: (entityType: string) =>
      apiFetch<SavedViewDto[]>('/saved-views', { query: { entityType } }),
    create: (data: CreateSavedViewInput | CreateSavedViewPayload) =>
      apiFetch<SavedViewDto>('/saved-views', { method: 'POST', body: data }),
    update: (id: string, data: UpdateSavedViewInput | UpdateSavedViewPayload) =>
      apiFetch<SavedViewDto>(`/saved-views/${id}`, { method: 'PATCH', body: data }),
    delete: (id: string) =>
      apiFetch<void>(`/saved-views/${id}`, { method: 'DELETE' }),
  },
};

export const savedViewsKeys = {
  savedViews: (entityType?: string) =>
    entityType ? (['saved-views', entityType] as const) : (['saved-views'] as const),
  savedView: (id: string) => ['saved-views', 'detail', id] as const,
};
