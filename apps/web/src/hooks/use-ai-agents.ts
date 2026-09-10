'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateAiAgentPayload, UpdateAiAgentPayload } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useAiAgents() {
  return useQuery({
    queryKey: queryKeys.aiAgents,
    queryFn: api.aiAgents.list,
  });
}

function useInvalidateAiAgents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.aiAgents });
}

export function useCreateAiAgent() {
  const invalidate = useInvalidateAiAgents();

  return useMutation({
    mutationFn: (input: CreateAiAgentPayload) => api.aiAgents.create(input),
    onSuccess: async (agent) => {
      await invalidate();
      toast.success(`${agent.name} created`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create the agent')),
  });
}

export function useUpdateAiAgent() {
  const invalidate = useInvalidateAiAgents();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAiAgentPayload }) =>
      api.aiAgents.update(id, input),
    onSuccess: async (agent) => {
      await invalidate();
      toast.success(`${agent.name} updated`);
    },
    onError: (error) => toast.error(describe(error, 'Could not save the agent')),
  });
}

export function useDeleteAiAgent() {
  const invalidate = useInvalidateAiAgents();

  return useMutation({
    mutationFn: (id: string) => api.aiAgents.remove(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Agent deleted');
    },
    onError: (error) => toast.error(describe(error, 'Could not delete the agent')),
  });
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  return fallback;
}
