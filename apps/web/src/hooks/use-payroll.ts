'use client';

import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateEmployeePayload,
  CreatePayrollRunPayload,
  CreateSalaryPackagePayload,
  PayPayrollRunPayload,
  PostOpeningGratuityPayload,
  UpdatePayrollLinePayload,
  GratuityAdjustmentPayload,
  RecordAdvancePayload,
  UpdateEmployeePayload,
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

/** Run state feeds the books (journals, advances, gratuity), so all three go stale together. */
async function invalidatePayroll(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['payroll'] });
  await queryClient.invalidateQueries({ queryKey: ['employees'] });
  await queryClient.invalidateQueries({ queryKey: ['finance'] });
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
