/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  AssistantApprovalPayload,
  AssistantConversationDetailDto,
  AssistantConversationDto,
  AssistantMessageDto,
  AssistantTurnDto,
  CreateAssistantConversationPayload,
  SendAssistantMessagePayload,
  UpdateAssistantConversationPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export const assistantEndpoints = {
  assistant: {
    list: () => apiFetch<AssistantConversationDto[]>('/assistant/conversations'),
    create: (body: CreateAssistantConversationPayload) =>
      apiFetch<AssistantConversationDto>('/assistant/conversations', { method: 'POST', body }),
    get: (id: string) => apiFetch<AssistantConversationDetailDto>(`/assistant/conversations/${id}`),
    update: (id: string, body: UpdateAssistantConversationPayload) =>
      apiFetch<AssistantConversationDto>(`/assistant/conversations/${id}`, { method: 'PATCH', body }),
    send: (id: string, body: SendAssistantMessagePayload) =>
      apiFetch<{ message: AssistantMessageDto; turn: AssistantTurnDto }>(`/assistant/conversations/${id}/messages`, {
        method: 'POST',
        body,
      }),
    decide: (turnId: string, body: AssistantApprovalPayload) =>
      apiFetch<AssistantTurnDto>(`/assistant/turns/${turnId}/approval`, { method: 'POST', body }),
    cancel: (turnId: string) => apiFetch<AssistantTurnDto>(`/assistant/turns/${turnId}/cancel`, { method: 'POST' }),
  },
};

export const assistantKeys = {
  assistantConversations: ['assistant', 'conversations'] as const,
  assistantConversation: (id: string) => ['assistant', 'conversation', id] as const,
};
