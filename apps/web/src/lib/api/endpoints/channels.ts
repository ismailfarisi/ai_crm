/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  ChannelAgentDto,
  ChannelAgentKind,
  ChannelAgentSkillOptionDto,
  ChannelAgentTestResultDto,
  CreateChannelAgentPayload,
  TestChannelAgentPayload,
  UpdateChannelAgentPayload,
  ChannelThreadDto,
  ChannelAiTestResultDto,
  TestChannelAiPayload,
  ChannelLinkCodeDto,
  StaffChannelIdentityDto,
  ContactDto,
  SendChannelMessagePayload,
  AiAgentDto,
  CreateAiAgentPayload,
  UpdateAiAgentPayload,
  IntentAgentConfigDto,
  UpsertIntentAgentConfigPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface ChannelMessageDto {
  id: string;
  organizationId: string;
  contactId: string | null;
  contact?: ContactDto | null;
  staffUser?: {
    id: string;
    name: string;
    email: string;
    role?: string;
  } | null;
  provider:
    | 'WHATSAPP_META'
    | 'TELEGRAM'
    | 'SLACK'
    | 'EMAIL_SMTP'
    | 'EMAIL_RESEND';
  direction: 'INBOUND' | 'OUTBOUND';
  sender: string;
  recipient: string;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'received';
  /** What the AI read into an inbound message; absent until it has looked. */
  aiIntent?: string | null;
  aiConfidence?: number | null;
  aiSummary?: string | null;
  aiSuggestedReply?: string | null;
  createdAt: string;
}
export interface ChannelConfigDto {
  id: string | null;
  organizationId: string;
  provider:
    | 'WHATSAPP_META'
    | 'TELEGRAM'
    | 'SLACK'
    | 'EMAIL_SMTP'
    | 'EMAIL_RESEND';
  isEnabled: boolean;
  status: 'unconfigured' | 'configured' | 'error';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  credentials: Record<string, any> | null;
  webhookSecret: string | null;
  /** Inbound webhook URL for this provider, as the API server sees it — build this server-side, never on the client. */
  webhookUrl: string;
  /** Present only right after a save that auto-registers the webhook with the provider (currently Telegram). */
  webhookRegistration?: { success: boolean; message: string };
  lastTestedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface SaveChannelConfigInput {
  isEnabled?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  credentials?: Record<string, any>;
}
export interface TestChannelConfigResult {
  success: boolean;
  message: string;
  status: 'unconfigured' | 'configured' | 'error';
}

export const channelsEndpoints = {
  channels: {
    list: () => apiFetch<ChannelConfigDto[]>('/channels/configs'),
    saveConfig: (provider: string, input: SaveChannelConfigInput) =>
      apiFetch<ChannelConfigDto>(`/channels/configs/${provider}`, {
        method: 'POST',
        body: input,
      }),
    testConfig: (provider: string) =>
      apiFetch<TestChannelConfigResult>(`/channels/configs/${provider}/test`, {
        method: 'POST',
      }),
    messages: (params: { contactId?: string; limit?: number } = {}) =>
      apiFetch<ChannelMessageDto[]>('/channels/messages', { query: params }),
    sendMessage: (input: SendChannelMessagePayload) =>
      apiFetch<ChannelMessageDto>('/channels/send', { method: 'POST', body: input }),
    threads: () => apiFetch<ChannelThreadDto[]>('/channels/threads'),
    takeOverThread: (id: string) =>
      apiFetch<unknown>(`/channels/threads/${id}/take-over`, { method: 'POST' }),
    returnThreadToAi: (id: string) =>
      apiFetch<unknown>(`/channels/threads/${id}/return-to-ai`, { method: 'POST' }),
    resolveThread: (id: string) =>
      apiFetch<unknown>(`/channels/threads/${id}/resolve`, { method: 'POST' }),
    identities: {
      list: () => apiFetch<StaffChannelIdentityDto[]>('/channels/identities'),
      createLinkCode: () =>
        apiFetch<ChannelLinkCodeDto>('/channels/identities/link-code', { method: 'POST' }),
      revoke: (id: string) =>
        apiFetch<{ success: true }>(`/channels/identities/${id}`, { method: 'DELETE' }),
    },
  },
  channelAgents: {
    list: () => apiFetch<ChannelAgentDto[]>('/channels/agents'),
    tools: (kind: ChannelAgentKind) =>
      apiFetch<ChannelAgentSkillOptionDto[]>(`/channels/agents/tools?kind=${kind}`),
    create: (input: CreateChannelAgentPayload) =>
      apiFetch<ChannelAgentDto>('/channels/agents', { method: 'POST', body: input }),
    update: (id: string, input: UpdateChannelAgentPayload) =>
      apiFetch<ChannelAgentDto>(`/channels/agents/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) =>
      apiFetch<{ success: true }>(`/channels/agents/${id}`, { method: 'DELETE' }),
    test: (input: TestChannelAgentPayload) =>
      apiFetch<ChannelAgentTestResultDto>('/channels/agents/test', {
        method: 'POST',
        body: input,
      }),
  },
  aiAgents: {
    list: () => apiFetch<AiAgentDto[]>('/channels/ai-agents'),
    get: (id: string) => apiFetch<AiAgentDto>(`/channels/ai-agents/${id}`),
    create: (input: CreateAiAgentPayload) =>
      apiFetch<AiAgentDto>('/channels/ai-agents', { method: 'POST', body: input }),
    update: (id: string, input: UpdateAiAgentPayload) =>
      apiFetch<AiAgentDto>(`/channels/ai-agents/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) =>
      apiFetch<{ success: true }>(`/channels/ai-agents/${id}`, { method: 'DELETE' }),
  },
  intentAgentConfig: {
    get: () => apiFetch<IntentAgentConfigDto>('/channels/intent-agent'),
    update: (input: UpsertIntentAgentConfigPayload) =>
      apiFetch<IntentAgentConfigDto>('/channels/intent-agent', {
        method: 'PATCH',
        body: input,
      }),
    test: (input: TestChannelAiPayload) =>
      apiFetch<ChannelAiTestResultDto>('/channels/intent-agent/test', {
        method: 'POST',
        body: input,
      }),
  },
};

export const channelsKeys = {
  channelThreads: ['channels', 'threads'] as const,
  channelAgents: ['channels', 'agents'] as const,
  channelAgentTools: (kind: string) => ['channels', 'agents', 'tools', kind] as const,
  channels: ['channels', 'configs'] as const,  channelIdentities: ['channels', 'identities'] as const,  channelMessages: (params: { contactId?: string; limit?: number } = {}) =>
    ['channels', 'messages', params] as const,  aiAgents: ['ai', 'agents'] as const,  intentAgentConfig: ['ai', 'intent-agent-config'] as const,};
