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
  OpeningGratuityPreviewDto,
  PayPayrollRunPayload,
  PayrollRunDto,
  PayrollRunsListDto,
  PayslipDto,
  PostOpeningGratuityPayload,
  UpdatePayrollLinePayload,
  CreatePayrollRunPayload,
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
  payroll: {
    runs: () => apiFetch<PayrollRunsListDto>('/payroll-runs'),
    run: (id: string) => apiFetch<PayrollRunDto>(`/payroll-runs/${id}`),
    payslip: (runId: string, lineId: string) =>
      apiFetch<PayslipDto>(`/payroll-runs/${runId}/lines/${lineId}`),
    createRun: (input: CreatePayrollRunPayload) =>
      apiFetch<PayrollRunDto>('/payroll-runs', { method: 'POST', body: input }),
    updateLine: (runId: string, lineId: string, input: UpdatePayrollLinePayload) =>
      apiFetch<PayrollRunDto>(`/payroll-runs/${runId}/lines/${lineId}`, { method: 'PATCH', body: input }),
    refreshRun: (id: string) => apiFetch<PayrollRunDto>(`/payroll-runs/${id}/refresh`, { method: 'POST' }),
    approveRun: (id: string) => apiFetch<PayrollRunDto>(`/payroll-runs/${id}/approve`, { method: 'POST' }),
    voidRun: (id: string) => apiFetch<PayrollRunDto>(`/payroll-runs/${id}/void`, { method: 'POST' }),
    payRun: (id: string, input: PayPayrollRunPayload) =>
      apiFetch<PayrollRunDto>(`/payroll-runs/${id}/pay`, { method: 'POST', body: input }),
    previewOpeningGratuity: (cutoverDate?: string) =>
      apiFetch<OpeningGratuityPreviewDto>('/payroll/opening-gratuity/preview', {
        method: 'POST',
        body: cutoverDate ? { cutoverDate } : {},
      }),
    postOpeningGratuity: (input: PostOpeningGratuityPayload) =>
      apiFetch<unknown>('/payroll/opening-gratuity', { method: 'POST', body: input }),
  },
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
  payrollRuns: () => ['payroll', 'runs'] as const,
  payrollRun: (id: string) => ['payroll', 'run', id] as const,
  payslip: (runId: string, lineId: string) => ['payroll', 'payslip', runId, lineId] as const,
  openingGratuityPreview: (cutover?: string) => ['payroll', 'opening-gratuity', cutover ?? ''] as const,
};
