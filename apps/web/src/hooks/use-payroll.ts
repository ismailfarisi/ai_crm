'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateEmployeePayload,
  CreateSalaryPackagePayload,
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
