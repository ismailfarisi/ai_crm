/* One slice of the browser's API surface. Composed in ./index.ts.
 * Spreadsheet imports: templates, the dry run, the import and its error file. */
import type {
  ImportDuplicateMode,
  ImportEntity,
  ImportMapping,
  ImportPreviewDto,
  ImportRunDto,
} from '@saas/shared';
import { apiFetch, apiFetchBlob, apiUpload } from '../client';

export type ImportFileFormat = 'csv' | 'xlsx';

export const importsEndpoints = {
  imports: {
    list: () => apiFetch<ImportRunDto[]>('/imports'),
    run: (id: string) => apiFetch<ImportRunDto>(`/imports/runs/${id}`),
    template: (entity: ImportEntity, format: ImportFileFormat) =>
      apiFetchBlob(`/imports/templates/${entity}`, { query: { format } }),
    errors: (id: string, format: ImportFileFormat) =>
      apiFetchBlob(`/imports/runs/${id}/errors`, { query: { format } }),
    /** Checks every row and saves nothing. Without a mapping, the server suggests one. */
    preview: (entity: ImportEntity, file: File, mapping?: ImportMapping) =>
      apiUpload<ImportPreviewDto>(`/import-previews/${entity}`, file, {
        fields: mapping ? { mapping: JSON.stringify(mapping) } : {},
      }),
    commit: (entity: ImportEntity, file: File, mapping: ImportMapping, onDuplicate: ImportDuplicateMode) =>
      apiUpload<ImportRunDto>(`/imports/${entity}`, file, {
        fields: { mapping: JSON.stringify(mapping), onDuplicate },
      }),
  },
};

export const importsKeys = {
  imports: ['imports'] as const,
};
