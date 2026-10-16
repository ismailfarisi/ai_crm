'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BulkTimesheetInput } from '@saas/shared';
import { api, queryKeys, type CrewTimesheetParams, type TimesheetListParams } from '@/lib/api/endpoints';
import { describeServer } from '@/lib/api/describe';

export function useTimesheets(q: TimesheetListParams & { enabled?: boolean }) {
  const { enabled = true, ...params } = q;
  return useQuery({
    queryKey: queryKeys.timesheets(params),
    queryFn: () => api.timesheets.list(params),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useCrewTimesheets(q: Partial<CrewTimesheetParams>) {
  const params = q as CrewTimesheetParams;
  return useQuery({
    queryKey: queryKeys.crewTimesheets(params),
    queryFn: () => api.timesheets.crew(params),
    enabled: Boolean(q.workDate && q.workOrderId),
  });
}

export function useTimesheetEmployees() {
  return useQuery({ queryKey: queryKeys.timesheetEmployees(), queryFn: () => api.timesheets.employees() });
}

export function useTimesheetOperations() {
  return useQuery({ queryKey: queryKeys.timesheetOperations(), queryFn: () => api.timesheets.operations() });
}

/** Saves a grid or crew day in one transaction. A 409/422 toasts the server's message; the caller keeps its edits. */
export function useSaveTimesheets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkTimesheetInput) => api.timesheets.bulk(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
        queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['payroll'] }),
        // Unposted hours move the provisional labour utilisation report.
        queryClient.invalidateQueries({ queryKey: ['finance'] }),
      ]);
      toast.success('Timesheet saved');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not save the timesheet')),
  });
}

export function useDeleteTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.timesheets.remove(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
        queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['payroll'] }),
        // Unposted hours move the provisional labour utilisation report.
        queryClient.invalidateQueries({ queryKey: ['finance'] }),
      ]);
      toast.success('Entry deleted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not delete the entry')),
  });
}
