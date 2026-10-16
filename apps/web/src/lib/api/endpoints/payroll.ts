/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  CreateEmployeePayload,
  CreateSalaryPackagePayload,
  EmployeeAdvanceDto,
  EmployeeAdvancesDto,
  EmployeeDto,
  EmployeeGratuityDto,
  EmployeeLeaveDto,
  EmployeeStatus,
  LeaveAdjustmentPayload,
  LeaveRecordDto,
  LeaveRecordPayload,
  PayrollSettingsDto,
  PayrollSettingsPayload,
  PensionSchemeDto,
  CreatePensionSchemePayload,
  UpdatePensionSchemePayload,
  GratuityAdjustmentPayload,
  GratuityLedgerEntryDto,
  OpeningGratuityPreviewDto,
  PayPayrollRunPayload,
  PayrollRunDto,
  PayrollRunsListDto,
  PayslipDto,
  PostOpeningGratuityPayload,
  OpeningLeavePreviewDto,
  PensionPeriodDto,
  PensionRemittanceDto,
  PostOpeningLeavePayload,
  RemitPensionPayload,
  WpsSifDto,
  UpdatePayrollLinePayload,
  CreatePayrollRunPayload,
  RecordAdvancePayload,
  SalaryPackageDto,
  UpdateEmployeePayload,
  CreateSettlementPayload,
  PaySettlementPayload,
  SettlementDto,
  SettlementStatementDto,
  UpdateSettlementPayload,
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
    deleteRun: (id: string) => apiFetch<void>(`/payroll-runs/${id}`, { method: 'DELETE' }),
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
    runSif: (id: string) => apiFetch<WpsSifDto>(`/payroll-runs/${id}/wps-sif`, { method: 'POST' }),
    pensionPeriod: (period: string) => apiFetch<PensionPeriodDto>(`/payroll/pension/${period}`),
    remitPension: (period: string, input: RemitPensionPayload) =>
      apiFetch<PensionRemittanceDto>(`/payroll/pension/${period}/remit`, { method: 'POST', body: input }),
    voidPension: (period: string) =>
      apiFetch<PensionRemittanceDto>(`/payroll/pension/${period}/void`, { method: 'POST' }),
    previewOpeningLeave: (cutoverDate?: string) =>
      apiFetch<OpeningLeavePreviewDto>('/payroll/opening-leave/preview', {
        method: 'POST',
        body: cutoverDate ? { cutoverDate } : {},
      }),
    postOpeningLeave: (input: PostOpeningLeavePayload) =>
      apiFetch<unknown>('/payroll/opening-leave', { method: 'POST', body: input }),
    settings: () => apiFetch<PayrollSettingsDto>('/payroll/settings'),
    saveSettings: (input: PayrollSettingsPayload) =>
      apiFetch<PayrollSettingsDto>('/payroll/settings', { method: 'PUT', body: input }),
    pensionSchemes: () => apiFetch<PensionSchemeDto[]>('/payroll/pension-schemes'),
    createPensionScheme: (input: CreatePensionSchemePayload) =>
      apiFetch<PensionSchemeDto>('/payroll/pension-schemes', { method: 'POST', body: input }),
    updatePensionScheme: (id: string, input: UpdatePensionSchemePayload) =>
      apiFetch<PensionSchemeDto>(`/payroll/pension-schemes/${id}`, { method: 'PATCH', body: input }),
    deletePensionScheme: (id: string) => apiFetch<void>(`/payroll/pension-schemes/${id}`, { method: 'DELETE' }),
    postOpeningGratuity: (input: PostOpeningGratuityPayload) =>
      apiFetch<unknown>('/payroll/opening-gratuity', { method: 'POST', body: input }),
  },
  settlements: {
    list: () => apiFetch<SettlementDto[]>('/settlements'),
    get: (id: string) => apiFetch<SettlementDto>(`/settlements/${id}`),
    statement: (id: string) => apiFetch<SettlementStatementDto>(`/settlements/${id}/statement`),
    create: (input: CreateSettlementPayload) =>
      apiFetch<SettlementDto>('/settlements', { method: 'POST', body: input }),
    update: (id: string, input: UpdateSettlementPayload) =>
      apiFetch<SettlementDto>(`/settlements/${id}`, { method: 'PATCH', body: input }),
    refresh: (id: string) => apiFetch<SettlementDto>(`/settlements/${id}/refresh`, { method: 'POST' }),
    remove: (id: string) => apiFetch<void>(`/settlements/${id}`, { method: 'DELETE' }),
    approve: (id: string) => apiFetch<SettlementDto>(`/settlements/${id}/approve`, { method: 'POST' }),
    void: (id: string) => apiFetch<SettlementDto>(`/settlements/${id}/void`, { method: 'POST' }),
    pay: (id: string, input: PaySettlementPayload) =>
      apiFetch<SettlementDto>(`/settlements/${id}/pay`, { method: 'POST', body: input }),
    sif: (id: string) => apiFetch<WpsSifDto>(`/settlements/${id}/wps-sif`, { method: 'POST' }),
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
    leave: (id: string) => apiFetch<EmployeeLeaveDto>(`/employees/${id}/leave`),
    createLeaveRecord: (id: string, input: LeaveRecordPayload) =>
      apiFetch<LeaveRecordDto>(`/employees/${id}/leave-records`, { method: 'POST', body: input }),
    updateLeaveRecord: (id: string, recordId: string, input: LeaveRecordPayload) =>
      apiFetch<LeaveRecordDto>(`/employees/${id}/leave-records/${recordId}`, { method: 'PATCH', body: input }),
    deleteLeaveRecord: (id: string, recordId: string) =>
      apiFetch<void>(`/employees/${id}/leave-records/${recordId}`, { method: 'DELETE' }),
    adjustLeave: (id: string, input: LeaveAdjustmentPayload) =>
      apiFetch<unknown>(`/employees/${id}/leave-adjustments`, { method: 'POST', body: input }),
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
  employeeLeave: (id: string) => ['employees', id, 'leave'] as const,
  settlements: () => ['settlements', 'list'] as const,
  settlement: (id: string) => ['settlements', id] as const,
  settlementStatement: (id: string) => ['settlements', id, 'statement'] as const,
  payrollSettings: () => ['payroll', 'settings'] as const,
  pensionSchemes: () => ['payroll', 'pension-schemes'] as const,
  payrollRuns: () => ['payroll', 'runs'] as const,
  payrollRun: (id: string) => ['payroll', 'run', id] as const,
  payslip: (runId: string, lineId: string) => ['payroll', 'payslip', runId, lineId] as const,
  pensionPeriod: (period: string) => ['payroll', 'pension', period] as const,
  openingLeavePreview: (cutover?: string) => ['payroll', 'opening-leave', cutover ?? ''] as const,
  openingGratuityPreview: (cutover?: string) => ['payroll', 'opening-gratuity', cutover ?? ''] as const,
};
