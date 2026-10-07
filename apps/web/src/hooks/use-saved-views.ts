'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/api/endpoints';
import type {
  SavedViewDto,
  CreateSavedViewInput,
  CreateSavedViewPayload,
  UpdateSavedViewInput,
  UpdateSavedViewPayload,
} from '@saas/shared';
import { toast } from 'sonner';

export function useSavedViews(entityType: string) {
  const queryClient = useQueryClient();
  const qKey = queryKeys.savedViews ? queryKeys.savedViews(entityType) : ['saved-views', entityType];

  const { data: views = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => api.savedViews.list(entityType),
  });

  const defaultView = useMemo(
    () => views.find((v) => v.isDefault) || views[0] || null,
    [views],
  );

  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const activeView = useMemo(() => {
    if (activeViewId) {
      const match = views.find((v) => v.id === activeViewId);
      if (match) return match;
    }
    return defaultView;
  }, [views, activeViewId, defaultView]);

  const createView = useMutation({
    mutationFn: (payload: CreateSavedViewInput | CreateSavedViewPayload) =>
      api.savedViews.create(payload),
    onSuccess: (newView) => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setActiveViewId(newView.id);
      toast.success(`View "${newView.name}" created`);
    },
    onError: () => toast.error('Failed to create view'),
  });

  const updateView = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: UpdateSavedViewInput | UpdateSavedViewPayload;
    }) => api.savedViews.update(id, payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: qKey });
      toast.success(`View "${updated.name}" updated`);
    },
    onError: () => toast.error('Failed to update view'),
  });

  const deleteView = useMutation({
    mutationFn: (id: string) => api.savedViews.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setActiveViewId(null);
      toast.success('View deleted');
    },
    onError: () => toast.error('Failed to delete view'),
  });

  return {
    views,
    activeView,
    setActiveViewId,
    isLoading,
    createView: createView.mutateAsync,
    updateView: (
      arg1: string | { id: string; payload: UpdateSavedViewInput | UpdateSavedViewPayload },
      arg2?: UpdateSavedViewInput | UpdateSavedViewPayload,
    ) => {
      if (typeof arg1 === 'string') {
        return updateView.mutateAsync({ id: arg1, payload: arg2 ?? {} });
      }
      return updateView.mutateAsync(arg1);
    },
    deleteView: deleteView.mutateAsync,
  };
}
