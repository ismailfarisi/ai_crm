'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AiBudgetStatusDto, UpsertAiBudgetPayload, AiUsageLogDto } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export type { AiBudgetStatusDto, UpsertAiBudgetPayload, AiUsageLogDto };

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useAiBudgetStatus() {
  return useQuery({
    queryKey: queryKeys.aiBudget,
    queryFn: () => api.ai.getBudget(),
  });
}

export function useUpsertAiBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpsertAiBudgetPayload) => api.ai.upsertBudget(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiBudget });
      toast.success('AI budget updated');
    },
    onError: (error) => toast.error(describe(error, 'Could not update AI budget')),
  });
}

export function useAiUsage() {
  return useQuery({
    queryKey: queryKeys.aiUsage,
    queryFn: () => api.ai.listUsage(),
  });
}
