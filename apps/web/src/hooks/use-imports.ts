'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportDuplicateMode, ImportEntity, ImportMapping } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';

/** The list a successful import changes, so it shows the new rows straight away. */
const AFFECTED: Record<ImportEntity, readonly string[][]> = {
  customers: [['customers']],
  contacts: [['contacts']],
  products: [['catalog']],
  materials: [['catalog']],
  'work-centres': [['catalog']],
  'opening-stock': [['inventory'], ['finance']],
};

export function useImportRuns(enabled = true) {
  return useQuery({ queryKey: queryKeys.imports, queryFn: () => api.imports.list(), enabled });
}

export function useImportPreview() {
  return useMutation({
    mutationFn: (input: { entity: ImportEntity; file: File; mapping?: ImportMapping }) =>
      api.imports.preview(input.entity, input.file, input.mapping),
  });
}

export function useCommitImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      entity: ImportEntity;
      file: File;
      mapping: ImportMapping;
      onDuplicate: ImportDuplicateMode;
    }) => api.imports.commit(input.entity, input.file, input.mapping, input.onDuplicate),
    onSuccess: (_run, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports });
      for (const queryKey of AFFECTED[input.entity]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
