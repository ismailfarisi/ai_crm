/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  CreateEmployeePayload,
  CreateSalaryPackagePayload,
  EmployeeAdvanceDto,
  EmployeeAdvancesDto,
  EmployeeDto,
  EmployeeGratuityDto,
  EmployeeStatus,
  GratuityAdjustmentPayload,
  GratuityLedgerEntryDto,
  RecordAdvancePayload,
  SalaryPackageDto,
  UpdateEmployeePayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface EmployeeListParams {
  status?: EmployeeStatus;
  search?: string;
}

export const payrollEndpoints = {
  employees: {
    list: (params: EmployeeListParams = {}) => apiFetch<EmployeeDto[]>('/employees', { query: params }),
    get: (id: string) => apiFetch<EmployeeDto>(`/employees/${id}`),
    create: (input: CreateEmployeePayload) =>
      apiFetch<EmployeeDto>('/employees', { method: 'POST', body: input }),
    update: (id: string, input: UpdateEmployeePayload) =>
      apiFetch<EmployeeDto>(`/employees/${id}`, { method: 'PATCH', body: input }),
    salaryPackages: (id: string) => apiFetch<SalaryPackageDto[]>(`/employees/${id}/salary-packages`),
    addSalaryPackage: (id: string, input: CreateSalaryPackagePayload) =>
      apiFetch<SalaryPackageDto>(`/employees/${id}/salary-packages`, { method: 'POST', body: input }),
    advances: (id: string) => apiFetch<EmployeeAdvancesDto>(`/employees/${id}/advances`),
    recordAdvance: (id: string, input: RecordAdvancePayload) =>
      apiFetch<EmployeeAdvanceDto>(`/employees/${id}/advances`, { method: 'POST', body: input }),
    gratuity: (id: string) => apiFetch<EmployeeGratuityDto>(`/employees/${id}/gratuity`),
    adjustGratuity: (id: string, input: GratuityAdjustmentPayload) =>
      apiFetch<GratuityLedgerEntryDto>(`/employees/${id}/gratuity-adjustments`, {
        method: 'POST',
        body: input,
      }),
  },
};

export const payrollKeys = {
  employees: (params: EmployeeListParams = {}) => ['employees', 'list', params] as const,
  employee: (id: string) => ['employees', id] as const,
  employeePackages: (id: string) => ['employees', id, 'packages'] as const,
  employeeAdvances: (id: string) => ['employees', id, 'advances'] as const,
  employeeGratuity: (id: string) => ['employees', id, 'gratuity'] as const,
};
