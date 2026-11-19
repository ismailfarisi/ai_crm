'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  SendEmailPayload,
  UpdateEmailThreadPayload,
} from '@saas/shared';
import { api, queryKeys, type EmailThreadListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useEmailAccounts() {
  const query = useQuery({
    queryKey: queryKeys.emailAccounts,
    queryFn: () => api.email.accounts.list(),
  });
  return {
    accounts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}

/** Kicks off the Google consent round trip — navigates the tab to Google. */
export function useConnectGoogle() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await api.email.googleAuthUrl();
      window.location.assign(url);
    },
    onError: (error) =>
      toast.error(describe(error, 'Could not start Google sign-in')),
  });
}

export function useDisconnectAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.email.accounts.disconnect(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email'] });
      toast.success('Mailbox disconnected');
    },
    onError: (error) => toast.error(describe(error, 'Could not disconnect')),
  });
}

export function useSyncAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.email.accounts.syncNow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email'] });
      toast.success('Mailbox synced');
    },
    onError: (error) => toast.error(describe(error, 'Sync failed')),
  });
}

export function useSetAccountShared() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isShared }: { id: string; isShared: boolean }) =>
      api.email.accounts.update(id, { isShared }),
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.emailAccounts });
      toast.success(
        account.isShared
          ? `${account.emailAddress} is now shared with the team`
          : `${account.emailAddress} is private again`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not update sharing')),
  });
}

export function useEmailThreads(params: EmailThreadListParams) {
  return useQuery({
    queryKey: queryKeys.emailThreads(params),
    queryFn: () => api.email.threads.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useEmailThread(threadId: string | null) {
  return useQuery({
    queryKey: queryKeys.emailThread(threadId ?? ''),
    queryFn: () => api.email.threads.get(threadId as string),
    enabled: Boolean(threadId),
  });
}

export function useUpdateEmailThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: { id: string } & UpdateEmailThreadPayload) =>
      api.email.threads.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email'] }),
    onError: (error) => toast.error(describe(error, 'Could not update thread')),
  });
}

export function useSendEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SendEmailPayload) => api.email.send(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email'] });
      toast.success('Email sent');
    },
    onError: (error) => toast.error(describe(error, 'Could not send email')),
  });
}
