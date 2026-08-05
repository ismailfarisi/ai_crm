'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateContactPayload, UpdateContactPayload } from '@saas/shared';
import { api, queryKeys, type ContactListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useContacts(params: ContactListParams) {
  return useQuery({
    queryKey: queryKeys.contacts(params),
    queryFn: () => api.contacts.list(params),
    // Keeps the previous page on screen while the next one loads, so the table
    // doesn't collapse to a spinner on every keystroke or page change.
    placeholderData: (previous) => previous,
  });
}

export function useContactStats() {
  return useQuery({
    queryKey: queryKeys.contactStats,
    queryFn: api.contacts.stats,
  });
}

/** Invalidating the `contacts` prefix covers every filter/page combination. */
function useInvalidateContacts() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['contacts'] });
}

export function useCreateContact() {
  const invalidate = useInvalidateContacts();

  return useMutation({
    mutationFn: (input: CreateContactPayload) => api.contacts.create(input),
    onSuccess: async (contact) => {
      await invalidate();
      toast.success(`${contact.fullName} added`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create the contact')),
  });
}

export function useUpdateContact() {
  const invalidate = useInvalidateContacts();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContactPayload }) =>
      api.contacts.update(id, input),
    onSuccess: async (contact) => {
      await invalidate();
      toast.success(`${contact.fullName} updated`);
    },
    onError: (error) => toast.error(describe(error, 'Could not save the contact')),
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateContacts();

  return useMutation({
    mutationFn: (id: string) => api.contacts.remove(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Contact deleted');
    },
    onError: (error) => toast.error(describe(error, 'Could not delete the contact')),
  });
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  return fallback;
}
