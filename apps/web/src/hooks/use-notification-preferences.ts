'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  NotificationPreferencesView,
  OrgNotificationPreferencesPayload,
  UserNotificationPreferencesPayload,
} from '@saas/shared';
import { apiFetch, ApiError } from '@/lib/api/client';

/* Kept beside the hooks rather than in lib/api/endpoints: a single screen's
 * three calls, and one less shared file for parallel branches to edit. */
export const notificationPreferencesKey = ['notification-preferences', 'me'] as const;

export const notificationPreferencesApi = {
  get: () => apiFetch<NotificationPreferencesView>('/notification-preferences/me'),
  saveOwn: (payload: UserNotificationPreferencesPayload) =>
    apiFetch<NotificationPreferencesView>('/notification-preferences/me', { method: 'PUT', body: payload }),
  resetOwn: () =>
    apiFetch<NotificationPreferencesView>('/notification-preferences/me', { method: 'DELETE' }),
  saveOrgDefault: (payload: OrgNotificationPreferencesPayload) =>
    apiFetch<NotificationPreferencesView>('/notification-preferences/organization', {
      method: 'PUT',
      body: payload,
    }),
};

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

export function useNotificationPreferences() {
  return useQuery({ queryKey: notificationPreferencesKey, queryFn: notificationPreferencesApi.get });
}

function useSave<T>(fn: (input: T) => Promise<NotificationPreferencesView>, done: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => {
      queryClient.setQueryData(notificationPreferencesKey, view);
      toast.success(done);
    },
    onError: (error) => toast.error(describe(error, 'Could not save')),
  });
}

export function useSaveOwnNotificationPreferences() {
  return useSave(notificationPreferencesApi.saveOwn, 'Your notifications are saved');
}

export function useResetOwnNotificationPreferences() {
  return useSave<void>(() => notificationPreferencesApi.resetOwn(), 'Now following the organisation default');
}

export function useSaveOrgNotificationDefault() {
  return useSave(notificationPreferencesApi.saveOrgDefault, 'Organisation default saved');
}
