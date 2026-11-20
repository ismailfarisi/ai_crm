'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ChannelAgentKind,
  CreateChannelAgentPayload,
  UpdateChannelAgentPayload,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useChannelAgents() {
  return useQuery({
    queryKey: queryKeys.channelAgents,
    queryFn: api.channelAgents.list,
  });
}

/** The tools an agent of this kind can be given. */
export function useChannelAgentTools(kind: ChannelAgentKind) {
  return useQuery({
    queryKey: queryKeys.channelAgentTools(kind),
    queryFn: () => api.channelAgents.tools(kind),
    staleTime: 5 * 60 * 1000,
  });
}

function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.channelAgents }),
      // The inbox names the agent that holds each conversation.
      queryClient.invalidateQueries({ queryKey: queryKeys.channelThreads }),
    ]);
}

export function useCreateChannelAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (input: CreateChannelAgentPayload) => api.channelAgents.create(input),
    onSuccess: async (agent) => {
      await invalidate();
      toast.success(`${agent.name} created`);
    },
  });
}

export function useUpdateChannelAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateChannelAgentPayload }) =>
      api.channelAgents.update(id, input),
    onSuccess: async (agent) => {
      await invalidate();
      toast.success(`${agent.name} saved`);
    },
  });
}

export function useDeleteChannelAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (id: string) => api.channelAgents.remove(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Agent deleted');
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && !error.isForbidden
          ? error.message
          : "You don't have permission to do that",
      ),
  });
}
