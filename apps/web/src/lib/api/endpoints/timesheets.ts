/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  BulkTimesheetInput,
  TimesheetEmployeeDto,
  TimesheetEntryDto,
  TimesheetOperationOptionDto,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface TimesheetListParams {
  employeeId?: string;
  from: string;
  to: string;
}

export interface CrewTimesheetParams {
  workDate: string;
  workOrderId: string;
}

export const timesheetsEndpoints = {
  timesheets: {
    list: (params: TimesheetListParams) => apiFetch<TimesheetEntryDto[]>('/timesheets', { query: params }),
    crew: (params: CrewTimesheetParams) => apiFetch<TimesheetEntryDto[]>('/timesheets/crew', { query: params }),
    employees: () => apiFetch<TimesheetEmployeeDto[]>('/timesheets/employees'),
    operations: () => apiFetch<TimesheetOperationOptionDto[]>('/timesheets/operations'),
    bulk: (input: BulkTimesheetInput) =>
      apiFetch<TimesheetEntryDto[]>('/timesheets/bulk', { method: 'POST', body: input }),
    remove: (id: string) => apiFetch<void>(`/timesheets/${id}`, { method: 'DELETE' }),
  },
};

export const timesheetsKeys = {
  timesheets: (params: TimesheetListParams) => ['timesheets', 'list', params] as const,
  crewTimesheets: (params: CrewTimesheetParams) => ['timesheets', 'crew', params] as const,
  timesheetEmployees: () => ['timesheets', 'employees'] as const,
  timesheetOperations: () => ['timesheets', 'operations'] as const,
};
