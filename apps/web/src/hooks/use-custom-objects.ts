'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateCustomRecordPayload,
  UpdateCustomRecordPayload,
} from '@saas/shared';
import { api, queryKeys, type RecordListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useCustomObjects() {
  return useQuery({
    queryKey: queryKeys.customObjects.all,
    queryFn: () => api.customObjects.list(),
  });
}

export function useCustomObject(slug: string) {
  return useQuery({
    queryKey: queryKeys.customObjects.bySlug(slug),
    queryFn: () => api.customObjects.getBySlug(slug),
    enabled: Boolean(slug),
  });
}

export function useCustomRecords(slug: string, params?: RecordListParams) {
  return useQuery({
    queryKey: queryKeys.customObjects.records(slug, params),
    queryFn: () => api.customObjects.listRecords(slug, params),
    enabled: Boolean(slug),
  });
}

export function useCreateCustomRecord(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCustomRecordPayload) =>
      api.customObjects.createRecord(slug, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customObjects.records(slug),
      });
      toast.success('Record created');
    },
    onError: (error) => toast.error(describe(error, 'Failed to create record')),
  });
}

export function useUpdateCustomRecord(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
      ...rest
    }: {
      id: string;
      data?: UpdateCustomRecordPayload;
    } & Partial<UpdateCustomRecordPayload>) => {
      const payload = (data ?? rest) as UpdateCustomRecordPayload;
      return api.customObjects.updateRecord(slug, id, payload);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customObjects.records(slug),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.customObjects.record(slug, variables.id),
      });
      toast.success('Record updated');
    },
    onError: (error) => toast.error(describe(error, 'Failed to update record')),
  });
}

export function useCustomRecord(slug: string, id: string) {
  return useQuery({
    queryKey: queryKeys.customObjects.record(slug, id),
    queryFn: () => api.customObjects.getRecord(slug, id),
    enabled: Boolean(slug && id),
  });
}

export function useDeleteCustomRecord(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.customObjects.deleteRecord(slug, id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customObjects.records(slug),
      });
      toast.success('Record deleted');
    },
    onError: (error) => toast.error(describe(error, 'Failed to delete record')),
  });
}

export function useReverseLinks(targetType: string, targetId: string) {
  return useQuery({
    queryKey: queryKeys.customObjects.reverseLinks(targetType, targetId),
    queryFn: () => api.customObjects.getReverseLinks(targetType, targetId),
    enabled: Boolean(targetType && targetId),
  });
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  return fallback;
}
