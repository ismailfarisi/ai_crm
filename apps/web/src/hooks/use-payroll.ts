'use client';

import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateEmployeePayload,
  CreatePayrollRunPayload,
  CreateSalaryPackagePayload,
  PayPayrollRunPayload,
  PostOpeningGratuityPayload,
  PostOpeningLeavePayload,
  RemitPensionPayload,
  UpdatePayrollLinePayload,
  GratuityAdjustmentPayload,
  CreatePensionSchemePayload,
  LeaveAdjustmentPayload,
  LeaveRecordPayload,
  PayrollSettingsPayload,
  UpdatePensionSchemePayload,
  RecordAdvancePayload,
  UpdateEmployeePayload,
  CreateSettlementPayload,
  PaySettlementPayload,
  UpdateSettlementPayload,
} from '@saas/shared';
import { api, queryKeys, type EmployeeListParams } from '@/lib/api/endpoints';
import { describeServer } from '@/lib/api/describe';

export function useEmployees(params: EmployeeListParams = {}) {
  return useQuery({
    queryKey: queryKeys.employees(params),
    queryFn: () => api.employees.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useEmployee(id: string | null) {
  return useQuery({
    queryKey: queryKeys.employee(id ?? ''),
    queryFn: () => api.employees.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmployeePayload) => api.employees.create(input),
    onSuccess: async (employee) => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.pensionSchemes() });
      toast.success(`${employee.fullName} added as ${employee.employeeNumber}`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not add the employee')),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEmployeePayload }) =>
      api.employees.update(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.pensionSchemes() });
      toast.success('Employee saved');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not save the employee')),
  });
}

export function useSalaryPackages(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.employeePackages(id ?? ''),
    queryFn: () => api.employees.salaryPackages(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useAddSalaryPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateSalaryPackagePayload }) =>
      api.employees.addSalaryPackage(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Salary change recorded');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not record the salary change')),
  });
}

export function useEmployeeGratuity(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.employeeGratuity(id ?? ''),
    queryFn: () => api.employees.gratuity(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useAdjustGratuity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GratuityAdjustmentPayload }) =>
      api.employees.adjustGratuity(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      // The provision is a ledger balance, so the books move with it.
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success('Gratuity provision adjusted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not adjust the provision')),
  });
}

export function useEmployeeAdvances(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.employeeAdvances(id ?? ''),
    queryFn: () => api.employees.advances(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useRecordAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecordAdvancePayload }) =>
      api.employees.recordAdvance(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success('Advance recorded');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not record the advance')),
  });
}

// ── Payroll runs ──────────────────────────────────────────────────────────

export function usePayrollRuns() {
  return useQuery({ queryKey: queryKeys.payrollRuns(), queryFn: () => api.payroll.runs() });
}

export function usePayrollRun(id: string | null) {
  return useQuery({
    queryKey: queryKeys.payrollRun(id ?? ''),
    queryFn: () => api.payroll.run(id as string),
    enabled: Boolean(id),
  });
}

export function usePayslip(runId: string | null, lineId: string | null) {
  return useQuery({
    queryKey: queryKeys.payslip(runId ?? '', lineId ?? ''),
    queryFn: () => api.payroll.payslip(runId as string, lineId as string),
    enabled: Boolean(runId) && Boolean(lineId),
  });
}

/** Run state feeds the books (journals, advances, gratuity) and the jobs its labour reached, so all go stale together. */
async function invalidatePayroll(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['payroll'] });
  await queryClient.invalidateQueries({ queryKey: ['employees'] });
  await queryClient.invalidateQueries({ queryKey: ['finance'] });
  await queryClient.invalidateQueries({ queryKey: ['work-orders'] });
}

export function useCreatePayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePayrollRunPayload) => api.payroll.createRun(input),
    onSuccess: async (run) => {
      await invalidatePayroll(queryClient);
      toast.success(`Payroll run ${run.runNumber} created`);
      if (run.warnings?.length) toast.warning(run.warnings.join('\n'));
    },
    onError: (error) => toast.error(describeServer(error, 'Could not create the payroll run')),
  });
}

const lineKey = (runId: string) => ['payroll', 'line', runId] as const;
/** Line PATCHes in flight per run, so only the last one to settle refetches the run. */
const linesInFlight = new Map<string, number>();

/** True while any line edit on this run is being saved (totals are not final yet). */
export function usePayrollLinesSaving(runId: string): boolean {
  return useIsMutating({ mutationKey: lineKey(runId) }) > 0;
}

/** No toast: the editor shows the failure on the row it came from. */
export function useUpdatePayrollLine(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: lineKey(runId),
    mutationFn: async ({ lineId, input }: { runId: string; lineId: string; input: UpdatePayrollLinePayload }) => {
      linesInFlight.set(runId, (linesInFlight.get(runId) ?? 0) + 1);
      try {
        return await api.payroll.updateLine(runId, lineId, input);
      } finally {
        linesInFlight.set(runId, (linesInFlight.get(runId) ?? 1) - 1);
      }
    },
    // Responses from different lines can land out of order, so the cache is only trusted
    // once nothing is in flight: then refetch the run for the final totals.
    onSettled: () => {
      if ((linesInFlight.get(runId) ?? 0) === 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.payrollRun(runId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.payrollRuns() });
      }
    },
  });
}

export function useRefreshPayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payroll.refreshRun(id),
    onSuccess: async (run) => {
      await invalidatePayroll(queryClient);
      toast.success('Run refreshed from current salaries');
      if (run.warnings?.length) toast.warning(run.warnings.join('\n'));
    },
    onError: (error) => toast.error(describeServer(error, 'Could not refresh the run')),
  });
}

/** Discards a draft run; it posted nothing, so only the payroll lists go stale. */
export function useDeletePayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payroll.deleteRun(id),
    onSuccess: async (_void, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.payrollRun(id) });
      await invalidatePayroll(queryClient);
      toast.success('Draft payroll run deleted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not delete the draft')),
  });
}

export function useApprovePayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payroll.approveRun(id),
    onSuccess: async (run) => {
      await invalidatePayroll(queryClient);
      toast.success(`${run.runNumber} approved`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not approve the run')),
  });
}

export function useVoidPayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payroll.voidRun(id),
    onSuccess: async (run) => {
      await invalidatePayroll(queryClient);
      toast.success(`${run.runNumber} voided`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not void the run')),
  });
}

export function usePayPayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PayPayrollRunPayload }) => api.payroll.payRun(id, input),
    onSuccess: async (_run, { input }) => {
      await invalidatePayroll(queryClient);
      toast.success(input.method === 'BANK' ? 'Bank payments recorded' : 'Cash payments recorded');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not record the payment')),
  });
}

export function useOpeningGratuityPreview(cutover?: string) {
  return useQuery({
    queryKey: queryKeys.openingGratuityPreview(cutover),
    queryFn: () => api.payroll.previewOpeningGratuity(cutover),
    placeholderData: (previous) => previous,
  });
}

export function usePostOpeningGratuity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PostOpeningGratuityPayload) => api.payroll.postOpeningGratuity(input),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      toast.success('Opening gratuity balances posted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not post the opening balances')),
  });
}

// ── Settings, pension schemes and leave ───────────────────────────────────

export function usePayrollSettings() {
  return useQuery({ queryKey: queryKeys.payrollSettings(), queryFn: () => api.payroll.settings() });
}

export function useSavePayrollSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PayrollSettingsPayload) => api.payroll.saveSettings(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['payroll'] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Payroll settings saved');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not save the settings')),
  });
}

export function usePensionSchemes(enabled = true) {
  return useQuery({ queryKey: queryKeys.pensionSchemes(), queryFn: () => api.payroll.pensionSchemes(), enabled });
}

export function useCreatePensionScheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePensionSchemePayload) => api.payroll.createPensionScheme(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.pensionSchemes() });
      toast.success('Pension scheme added');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not add the scheme')),
  });
}

export function useUpdatePensionScheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePensionSchemePayload }) =>
      api.payroll.updatePensionScheme(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.pensionSchemes() });
      toast.success('Pension scheme saved');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not save the scheme')),
  });
}

export function useDeletePensionScheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payroll.deletePensionScheme(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.pensionSchemes() });
      toast.success('Pension scheme deleted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not delete the scheme')),
  });
}

export function useEmployeeLeave(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.employeeLeave(id ?? ''),
    queryFn: () => api.employees.leave(id as string),
    enabled: Boolean(id) && enabled,
  });
}

/** Leave feeds draft runs (they are re-filled), so employees and payroll both go stale. */
async function invalidateLeave(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['employees'] });
  await queryClient.invalidateQueries({ queryKey: ['payroll'] });
}

/** No toast on failure for create/update: the modal shows the server's reason inline. */
export function useCreateLeaveRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LeaveRecordPayload }) => api.employees.createLeaveRecord(id, input),
    onSuccess: async () => {
      await invalidateLeave(queryClient);
      toast.success('Leave recorded');
    },
  });
}

export function useUpdateLeaveRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, recordId, input }: { id: string; recordId: string; input: LeaveRecordPayload }) =>
      api.employees.updateLeaveRecord(id, recordId, input),
    onSuccess: async () => {
      await invalidateLeave(queryClient);
      toast.success('Leave record saved');
    },
  });
}

export function useDeleteLeaveRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, recordId }: { id: string; recordId: string }) => api.employees.deleteLeaveRecord(id, recordId),
    onSuccess: async () => {
      await invalidateLeave(queryClient);
      toast.success('Leave record deleted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not delete the leave record')),
  });
}

export function useAdjustLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LeaveAdjustmentPayload }) => api.employees.adjustLeave(id, input),
    onSuccess: async () => {
      await invalidateLeave(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success('Leave balance adjusted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not adjust the leave balance')),
  });
}

// ── SIF, pension remittance and opening leave ─────────────────────────────

/** The caller downloads the file; the hook only turns a refusal into a toast. */
export function useRunSif() {
  return useMutation({
    mutationFn: (id: string) => api.payroll.runSif(id),
    onError: (error) => toast.error(describeServer(error, 'Could not build the SIF file')),
  });
}

export function usePensionPeriod(period: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.pensionPeriod(period ?? ''),
    queryFn: () => api.payroll.pensionPeriod(period as string),
    enabled: Boolean(period) && enabled,
  });
}

export function useRemitPension() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ period, input }: { period: string; input: RemitPensionPayload }) =>
      api.payroll.remitPension(period, input),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      toast.success('Pension remittance recorded');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not record the remittance')),
  });
}

export function useVoidPension() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (period: string) => api.payroll.voidPension(period),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      toast.success('Pension remittance voided');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not void the remittance')),
  });
}

export function useOpeningLeavePreview(cutover?: string) {
  return useQuery({
    queryKey: queryKeys.openingLeavePreview(cutover),
    queryFn: () => api.payroll.previewOpeningLeave(cutover),
    placeholderData: (previous) => previous,
  });
}

export function usePostOpeningLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PostOpeningLeavePayload) => api.payroll.postOpeningLeave(input),
    onSuccess: async () => {
      await invalidatePayroll(queryClient);
      toast.success('Opening leave balances posted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not post the opening leave balances')),
  });
}

// ── Final settlements ─────────────────────────────────────────────────────

export function useSettlements() {
  return useQuery({ queryKey: queryKeys.settlements(), queryFn: () => api.settlements.list() });
}

export function useSettlement(id: string | null) {
  return useQuery({
    queryKey: queryKeys.settlement(id ?? ''),
    queryFn: () => api.settlements.get(id as string),
    enabled: Boolean(id),
  });
}

export function useSettlementStatement(id: string | null) {
  return useQuery({
    queryKey: queryKeys.settlementStatement(id ?? ''),
    queryFn: () => api.settlements.statement(id as string),
    enabled: Boolean(id),
  });
}

/** A settlement posts to the books and clears the leaver's balances, so everything goes stale. */
async function invalidateSettlements(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['settlements'] });
  await queryClient.invalidateQueries({ queryKey: ['employees'] });
  await queryClient.invalidateQueries({ queryKey: ['payroll'] });
  await queryClient.invalidateQueries({ queryKey: ['finance'] });
  await queryClient.invalidateQueries({ queryKey: ['work-orders'] });
}

/** No toast on failure: the modal shows the server's reason (e.g. final month not posted) inline. */
export function useCreateSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSettlementPayload) => api.settlements.create(input),
    onSuccess: async (s) => {
      await invalidateSettlements(queryClient);
      toast.success(`${s.settlementNumber} drafted`);
    },
  });
}

/** No toast on failure: the editor shows the server's reason beside the form. */
export function useUpdateSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSettlementPayload }) => api.settlements.update(id, input),
    onSuccess: async () => {
      await invalidateSettlements(queryClient);
      toast.success('Settlement saved');
    },
  });
}

export function useRefreshSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.settlements.refresh(id),
    onSuccess: async () => {
      await invalidateSettlements(queryClient);
      toast.success('Settlement refreshed from current balances');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not refresh the settlement')),
  });
}

export function useDeleteSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.settlements.remove(id),
    onSuccess: async (_void, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.settlement(id) });
      await invalidateSettlements(queryClient);
      toast.success('Draft settlement deleted');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not delete the draft')),
  });
}

/** No toast on failure: a stale draft is refused with "refresh it", which the page turns into an action. */
export function useApproveSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.settlements.approve(id),
    onSuccess: async (s) => {
      await invalidateSettlements(queryClient);
      toast.success(`${s.settlementNumber} approved`);
    },
  });
}

export function useVoidSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.settlements.void(id),
    onSuccess: async (s) => {
      await invalidateSettlements(queryClient);
      toast.success(`${s.settlementNumber} voided`);
    },
    onError: (error) => toast.error(describeServer(error, 'Could not void the settlement')),
  });
}

export function usePaySettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PaySettlementPayload }) => api.settlements.pay(id, input),
    onSuccess: async () => {
      await invalidateSettlements(queryClient);
      toast.success('Settlement payment recorded');
    },
    onError: (error) => toast.error(describeServer(error, 'Could not record the payment')),
  });
}

/** The caller downloads the file; the hook only turns a refusal into a toast. */
export function useSettlementSif() {
  return useMutation({
    mutationFn: (id: string) => api.settlements.sif(id),
    onError: (error) => toast.error(describeServer(error, 'Could not build the SIF file')),
  });
}
