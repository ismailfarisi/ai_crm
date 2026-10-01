import { z } from 'zod';
import {
  documentTemplateConfigSchema,
  documentTypeSchema,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  type DocumentTemplateConfig,
  type DocumentType,
} from '@saas/shared';

export const createDocumentTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  isDefault: z.boolean().optional().default(false),
  appliesTo: z.array(documentTypeSchema).optional().default([]),
  config: documentTemplateConfigSchema
    .optional()
    .default(DEFAULT_DOCUMENT_TEMPLATE_CONFIG),
});
export type CreateDocumentTemplateDto = {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  appliesTo?: DocumentType[];
  config?: DocumentTemplateConfig;
};

export const updateDocumentTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  isDefault: z.boolean().optional(),
  appliesTo: z.array(documentTypeSchema).optional(),
  config: documentTemplateConfigSchema.optional(),
});
export type UpdateDocumentTemplateDto = z.infer<
  typeof updateDocumentTemplateSchema
>;

export const setDefaultTemplateSchema = z.object({
  documentTypes: z.array(documentTypeSchema).optional(),
  appliesTo: z.array(documentTypeSchema).optional(),
});
export type SetDefaultTemplateDto = z.infer<typeof setDefaultTemplateSchema>;

export const previewTemplatePdfSchema = z.object({
  config: documentTemplateConfigSchema,
  documentType: documentTypeSchema.optional().default('INVOICE'),
});
export type PreviewTemplatePdfDto = {
  config: DocumentTemplateConfig;
  documentType?: DocumentType;
};
