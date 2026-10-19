'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BranchDto, BranchPayload, OrganizationProfileDto, UpdateOrganizationPayload } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useOrganization() {
  return useQuery<OrganizationProfileDto>({
    queryKey: queryKeys.organization,
    queryFn: () => api.organization.get(),
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateOrganizationPayload) => api.organization.update(payload),
    onSuccess: async (organization) => {
      queryClient.setQueryData(queryKeys.organization, organization);
      // The workspace name shows in the app shell and on documents.
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      toast.success('Company details saved');
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.message
          ? error.message
          : 'Could not save your company details',
      ),
  });
}

/**
 * Uploading and removing the logo.
 *
 * Separate from `useUpdateOrganization` because it is multipart rather than
 * JSON, and because it is the one field on this screen that saves on its own
 * — nobody expects to press "Save changes" after picking an image.
 */
export function useSetOrganizationLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => api.organization.uploadLogo(file),
    onSuccess: (organization) => {
      queryClient.setQueryData(queryKeys.organization, organization);
      toast.success('Logo updated');
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.message
          ? error.message
          : 'Could not upload the logo',
      ),
  });
}

export function useClearOrganizationLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.organization.clearLogo(),
    onSuccess: (organization) => {
      queryClient.setQueryData(queryKeys.organization, organization);
      toast.success('Logo removed');
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.message
          ? error.message
          : 'Could not remove the logo',
      ),
  });
}

export function useBranches() {
  return useQuery<BranchDto[]>({ queryKey: queryKeys.branches, queryFn: () => api.branches.list() });
}

/** Create (no id) or update a branch. It can change whether the organisation is in UAE VAT mode. */
export function useSaveBranch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: BranchPayload }) =>
      id ? api.branches.update(id, payload) : api.branches.create(payload),
    onSuccess: async (_branch, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.branches }),
        queryClient.invalidateQueries({ queryKey: queryKeys.uaeVatStatus }),
      ]);
      toast.success(id ? 'Branch saved' : 'Branch added');
    },
    // The dialog shows the server's message inline, so no toast here.
  });
}
