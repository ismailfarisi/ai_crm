'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AssistantApprovalPayload,
  AssistantConversationDetailDto,
  CreateAssistantConversationPayload,
  SendAssistantMessagePayload,
  UpdateAssistantConversationPayload,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { mergeMessages } from './use-assistant-stream';

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.isForbidden ? "You don't have permission to do that" : error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useAssistantConversations(enabled = true) {
  return useQuery({ queryKey: queryKeys.assistantConversations, queryFn: () => api.assistant.list(), enabled });
}

export function useAssistantConversation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.assistantConversation(id ?? 'none'),
    queryFn: () => api.assistant.get(id!),
    enabled: Boolean(id),
  });
}

export function useCreateAssistantConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAssistantConversationPayload) => api.assistant.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations }),
    onError: (error) => toast.error(describe(error, 'Could not start a chat')),
  });
}

export function useUpdateAssistantConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAssistantConversationPayload }) => api.assistant.update(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations }),
    onError: (error) => toast.error(describe(error, 'Could not update the chat')),
  });
}

export function useSendAssistantMessage(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendAssistantMessagePayload) => api.assistant.send(conversationId!, body),
    onSuccess: ({ message, turn }) => {
      queryClient.setQueryData<AssistantConversationDetailDto>(
        queryKeys.assistantConversation(conversationId!),
        (detail) => (detail ? { ...mergeMessages(detail, [message]), activeTurn: turn.status === 'FAILED' ? null : turn } : detail),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.assistantConversations });
    },
    onError: (error) => toast.error(describe(error, 'Could not send the message')),
  });
}

export function useDecideAssistantTurn(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ turnId, body }: { turnId: string; body: AssistantApprovalPayload }) => api.assistant.decide(turnId, body),
    onSuccess: (turn) =>
      queryClient.setQueryData<AssistantConversationDetailDto>(queryKeys.assistantConversation(conversationId!), (d) =>
        d ? { ...d, activeTurn: turn } : d,
      ),
    onError: (error) => toast.error(describe(error, 'Could not record your decision')),
  });
}

export function useCancelAssistantTurn(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (turnId: string) => api.assistant.cancel(turnId),
    onSuccess: () =>
      queryClient.setQueryData<AssistantConversationDetailDto>(queryKeys.assistantConversation(conversationId!), (d) =>
        d ? { ...d, activeTurn: null } : d,
      ),
    onError: (error) => toast.error(describe(error, 'Could not stop the assistant')),
  });
}
