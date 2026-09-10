'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UpsertIntentAgentConfigPayload } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useIntentAgentConfig() {
  return useQuery({
    queryKey: queryKeys.intentAgentConfig,
    queryFn: api.intentAgentConfig.get,
  });
}

export function useUpdateIntentAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpsertIntentAgentConfigPayload) =>
      api.intentAgentConfig.update(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.intentAgentConfig });
      toast.success('Intent agent settings updated');
    },
    onError: (error) => toast.error(describe(error, 'Could not update intent agent settings')),
  });
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  return fallback;
}
