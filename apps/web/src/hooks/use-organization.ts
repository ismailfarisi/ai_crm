'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OrganizationProfileDto, UpdateOrganizationPayload } from '@saas/shared';
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
