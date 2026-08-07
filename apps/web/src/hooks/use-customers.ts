'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateCustomerPayload, UpdateCustomerPayload } from '@saas/shared';
import { api, queryKeys, type CustomerListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: queryKeys.customers(params),
    queryFn: () => api.customers.list(params),
    // Keeps the previous page on screen while the next one loads, so the table
    // doesn't collapse to a spinner on every keystroke or page change.
    placeholderData: (previous) => previous,
  });
}

/** Invalidating the `customers` prefix covers every filter/page combination. */
function useInvalidateCustomers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['customers'] });
}

export function useCreateCustomer() {
  const invalidate = useInvalidateCustomers();

  return useMutation({
    mutationFn: (input: CreateCustomerPayload) => api.customers.create(input),
    onSuccess: async (customer) => {
      await invalidate();
      toast.success(`${customer.companyName} added`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create the customer')),
  });
}

export function useUpdateCustomer() {
  const invalidate = useInvalidateCustomers();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCustomerPayload }) =>
      api.customers.update(id, input),
    onSuccess: async (customer) => {
      await invalidate();
      toast.success(`${customer.companyName} updated`);
    },
    onError: (error) => toast.error(describe(error, 'Could not save the customer')),
  });
}

export function useDeleteCustomer() {
  const invalidate = useInvalidateCustomers();

  return useMutation({
    mutationFn: (id: string) => api.customers.remove(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Customer deleted');
    },
    onError: (error) => toast.error(describe(error, 'Could not delete the customer')),
  });
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  return fallback;
}
