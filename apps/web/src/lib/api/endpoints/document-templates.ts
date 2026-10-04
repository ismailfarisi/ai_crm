/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  DocumentTemplateConfig,
  DocumentType,
  GenerateTemplateAiInput,
} from '@saas/shared';
import { apiFetch, apiFetchBlob } from '../client';

export interface DocumentTemplateDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  appliesTo: DocumentType[];
  config: DocumentTemplateConfig;
  createdAt: string;
  updatedAt: string;
  createdById?: string | null;
}

export interface CreateDocumentTemplateInput {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  appliesTo?: DocumentType[];
  config?: DocumentTemplateConfig;
}

export interface UpdateDocumentTemplateInput {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  appliesTo?: DocumentType[];
  config?: DocumentTemplateConfig;
}

export interface SetDefaultTemplateInput {
  documentTypes?: DocumentType[];
  appliesTo?: DocumentType[];
}

export interface PreviewTemplatePdfInput {
  config: DocumentTemplateConfig;
  documentType?: DocumentType;
}

export const documentTemplatesEndpoints = {
  documentTemplates: {
    list: () => apiFetch<DocumentTemplateDto[]>('/settings/document-templates'),
    get: (id: string) => apiFetch<DocumentTemplateDto>(`/settings/document-templates/${id}`),
    create: (input: CreateDocumentTemplateInput) =>
      apiFetch<DocumentTemplateDto>('/settings/document-templates', {
        method: 'POST',
        body: input,
      }),
    update: (id: string, input: UpdateDocumentTemplateInput) =>
      apiFetch<DocumentTemplateDto>(`/settings/document-templates/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    delete: (id: string) =>
      apiFetch<void>(`/settings/document-templates/${id}`, {
        method: 'DELETE',
      }),
    setDefault: (id: string, input: SetDefaultTemplateInput) =>
      apiFetch<DocumentTemplateDto>(`/settings/document-templates/${id}/set-default`, {
        method: 'POST',
        body: input,
      }),
    generateAi: (input: GenerateTemplateAiInput) =>
      apiFetch<DocumentTemplateConfig>('/settings/document-templates/generate-ai', {
        method: 'POST',
        body: input,
      }),
    previewPdf: (input: PreviewTemplatePdfInput) =>
      apiFetchBlob('/settings/document-templates/preview-pdf', {
        method: 'POST',
        body: input,
      }),
    resolve: (docType: DocumentType) =>
      apiFetch<{ template: DocumentTemplateDto | null; config: DocumentTemplateConfig }>(
        `/settings/document-templates/resolve/${docType}`,
      ),
  },
};

export const documentTemplatesKeys = {
  documentTemplates: ['document-templates'] as const,
  documentTemplate: (id: string) => ['document-templates', id] as const,
  resolveTemplate: (docType: DocumentType) => ['document-templates', 'resolve', docType] as const,
};
