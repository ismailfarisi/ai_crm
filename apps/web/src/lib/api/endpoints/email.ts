/* Per-user connected mailboxes (Gmail OAuth) and their synced mail. */
import type {
  ConnectImapAccountPayload,
  EmailAccountDto,
  EmailFolder,
  EmailThreadDetailDto,
  EmailThreadDto,
  GoogleOAuthStartDto,
  PaginatedResult,
  SendEmailPayload,
  UpdateEmailAccountPayload,
  UpdateEmailThreadPayload,
} from '@saas/shared';
import { apiFetch } from '../client';
import { API_PUBLIC_URL } from '../config';

export interface EmailThreadListParams {
  folder?: EmailFolder;
  accountId?: string;
  contactId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const emailEndpoints = {
  email: {
    accounts: {
      list: () => apiFetch<EmailAccountDto[]>('/email/accounts'),
      update: (id: string, input: UpdateEmailAccountPayload) =>
        apiFetch<EmailAccountDto>(`/email/accounts/${id}`, {
          method: 'PATCH',
          body: input,
        }),
      syncNow: (id: string) =>
        apiFetch<{ ok: boolean }>(`/email/accounts/${id}/sync`, {
          method: 'POST',
        }),
      disconnect: (id: string) =>
        apiFetch<void>(`/email/accounts/${id}`, { method: 'DELETE' }),
      connectImap: (input: ConnectImapAccountPayload) =>
        apiFetch<EmailAccountDto>('/email/accounts/imap', {
          method: 'POST',
          body: input,
        }),
    },
    googleAuthUrl: () =>
      apiFetch<GoogleOAuthStartDto>('/email/oauth/google/start'),
    threads: {
      list: (params: EmailThreadListParams = {}) =>
        apiFetch<PaginatedResult<EmailThreadDto>>('/email/threads', {
          query: params,
        }),
      get: (id: string) =>
        apiFetch<EmailThreadDetailDto>(`/email/threads/${id}`),
      update: (id: string, input: UpdateEmailThreadPayload) =>
        apiFetch<EmailThreadDto>(`/email/threads/${id}`, {
          method: 'PATCH',
          body: input,
        }),
    },
    send: (input: SendEmailPayload) =>
      apiFetch<{ threadId: string; message: unknown }>(
        '/email/messages/send',
        { method: 'POST', body: input },
      ),
    /** Browser downloads go through the cookie-authed URL directly. */
    attachmentUrl: (messageId: string, attachmentId: string) =>
      `${API_PUBLIC_URL}/email/messages/${messageId}/attachments/${attachmentId}`,
  },
};

export const emailKeys = {
  emailAccounts: ['email', 'accounts'] as const,
  emailThreads: (params: EmailThreadListParams = {}) =>
    ['email', 'threads', params] as const,
  emailThread: (id: string) => ['email', 'threads', id] as const,
};
