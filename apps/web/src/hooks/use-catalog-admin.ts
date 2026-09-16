'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CatalogItemDto,
  CreateCatalogItemPayload,
  UpdateCatalogItemPayload,
  MaterialDto,
  CreateMaterialPayload,
  UpdateMaterialPayload,
  WorkCenterDto,
  CreateWorkCenterPayload,
  UpdateWorkCenterPayload,
  ToolingDto,
  CreateToolingPayload,
  UpdateToolingPayload,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

/**
 * Maintenance of the costing catalog.
 *
 * `use-catalog.ts` is the read side used while writing a quote; this is the
 * write side behind the Catalog screen. The two are kept apart because the
 * quote editor should never pull in mutations it cannot perform.
 */

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

/** Everything the catalog screen shows is derived from `['catalog', …]`. */
function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['catalog'] });
}

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

export function useMaterials() {
  return useQuery<MaterialDto[]>({
    queryKey: queryKeys.catalogMaterials,
    queryFn: () => api.catalog.listMaterials(),
  });
}

export function useSaveMaterial() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (input: { id?: string; payload: CreateMaterialPayload }) =>
      input.id
        ? api.catalog.updateMaterial(input.id, input.payload as UpdateMaterialPayload)
        : api.catalog.createMaterial(input.payload),
    onSuccess: async (material, variables) => {
      await invalidate();
      toast.success(
        variables.id ? `${material.name} updated` : `${material.name} added`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not save the material')),
  });
}

export function useDeleteMaterial() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (id: string) => api.catalog.deleteMaterial(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Material removed');
    },
    onError: (error) => toast.error(describe(error, 'Could not remove the material')),
  });
}

/* ------------------------------------------------------------------ *
 * Work centres
 * ------------------------------------------------------------------ */

export function useWorkCenters() {
  return useQuery<WorkCenterDto[]>({
    queryKey: queryKeys.catalogWorkCenters,
    queryFn: () => api.catalog.listWorkCenters(),
  });
}

export function useSaveWorkCenter() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (input: { id?: string; payload: CreateWorkCenterPayload }) =>
      input.id
        ? api.catalog.updateWorkCenter(input.id, input.payload as UpdateWorkCenterPayload)
        : api.catalog.createWorkCenter(input.payload),
    onSuccess: async (workCenter, variables) => {
      await invalidate();
      toast.success(
        variables.id ? `${workCenter.name} updated` : `${workCenter.name} added`,
      );
    },
    onError: (error) => toast.error(describe(error, 'Could not save the work centre')),
  });
}

export function useDeleteWorkCenter() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (id: string) => api.catalog.deleteWorkCenter(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Work centre removed');
    },
    onError: (error) => toast.error(describe(error, 'Could not remove the work centre')),
  });
}

/* ------------------------------------------------------------------ *
 * Tooling
 * ------------------------------------------------------------------ */

export function useTooling() {
  return useQuery<ToolingDto[]>({
    queryKey: queryKeys.catalogTooling,
    queryFn: () => api.catalog.listTooling(),
  });
}

export function useSaveTooling() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (input: { id?: string; payload: CreateToolingPayload }) =>
      input.id
        ? api.catalog.updateTooling(input.id, input.payload as UpdateToolingPayload)
        : api.catalog.createTooling(input.payload),
    onSuccess: async (tooling, variables) => {
      await invalidate();
      toast.success(variables.id ? `${tooling.name} updated` : `${tooling.name} added`);
    },
    onError: (error) => toast.error(describe(error, 'Could not save the tooling')),
  });
}

export function useDeleteTooling() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (id: string) => api.catalog.deleteTooling(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Tooling removed');
    },
    onError: (error) => toast.error(describe(error, 'Could not remove the tooling')),
  });
}

/* ------------------------------------------------------------------ *
 * Catalog items
 * ------------------------------------------------------------------ */

export function useCatalogItems() {
  return useQuery<CatalogItemDto[]>({
    queryKey: queryKeys.catalogItemsAll,
    queryFn: () => api.catalog.listItems(),
  });
}

export function useSaveCatalogItem() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (input: { id?: string; payload: CreateCatalogItemPayload }) =>
      input.id
        ? api.catalog.updateItem(input.id, input.payload as UpdateCatalogItemPayload)
        : api.catalog.createItem(input.payload),
    onSuccess: async (item, variables) => {
      await invalidate();
      toast.success(variables.id ? `${item.name} updated` : `${item.name} added`);
    },
    onError: (error) => toast.error(describe(error, 'Could not save the product')),
  });
}

export function useDeleteCatalogItem() {
  const invalidate = useInvalidateCatalog();

  return useMutation({
    mutationFn: (id: string) => api.catalog.deleteItem(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('Product removed');
    },
    onError: (error) => toast.error(describe(error, 'Could not remove the product')),
  });
}
