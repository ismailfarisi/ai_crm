'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateSupplierPayload, UpdateSupplierPayload } from '@saas/shared';
import { api, queryKeys, type SupplierListParams } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export function useSuppliers(params: SupplierListParams) {
  return useQuery({
    queryKey: queryKeys.suppliers(params),
    queryFn: () => api.suppliers.list(params),
    // Keeps the previous page on screen while the next one loads, so the table
    // doesn't collapse to a spinner on every keystroke or page change.
    placeholderData: (previous) => previous,
  });
}

export function useSupplier(id: string | null) {
  return useQuery({
    queryKey: queryKeys.supplier(id ?? ''),
    queryFn: () => api.suppliers.get(id as string),
    enabled: Boolean(id),
  });
}

export function useSupplierMaterials(id: string | null) {
  return useQuery({
    queryKey: queryKeys.supplierMaterials(id ?? ''),
    queryFn: () => api.suppliers.materials(id as string),
    enabled: Boolean(id),
  });
}

/** Invalidating the `suppliers` prefix covers every filter/page combination. */
function useInvalidateSuppliers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['suppliers'] });
}

export function useCreateSupplier() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: (input: CreateSupplierPayload) => api.suppliers.create(input),
    onSuccess: async (supplier) => {
      await invalidate();
      toast.success(`${supplier.companyName} added`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create the supplier')),
  });
}

export function useUpdateSupplier() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSupplierPayload }) =>
      api.suppliers.update(id, input),
    onSuccess: async (supplier) => {
      await invalidate();
      toast.success(`${supplier.companyName} saved`);
    },
    onError: (error) => toast.error(describe(error, 'Could not save the supplier')),
  });
}

export function useDeleteSupplier() {
  const invalidate = useInvalidateSuppliers();

  return useMutation({
    mutationFn: (id: string) => api.suppliers.remove(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Supplier deleted');
    },
    // The API refuses while open orders exist and says how many; that message
    // is more useful than anything generic, so surface it as-is.
    onError: (error) => toast.error(describe(error, 'Could not delete the supplier')),
  });
}

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
