'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DocumentTemplateConfig, DocumentType } from '@saas/shared';
import {
  api,
  queryKeys,
  type DocumentTemplateDto,
  type CreateDocumentTemplateInput,
  type UpdateDocumentTemplateInput,
} from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export type { DocumentTemplateDto, CreateDocumentTemplateInput, UpdateDocumentTemplateInput };

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export interface UseDocumentTemplatesOptions {
  id?: string;
  enabled?: boolean;
}

export function useDocumentTemplates(options?: UseDocumentTemplatesOptions) {
  const queryClient = useQueryClient();
  const id = options?.id;

  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // List query
  const listQuery = useQuery({
    queryKey: queryKeys.documentTemplates,
    queryFn: () => api.documentTemplates.list(),
    enabled: options?.enabled !== false,
  });

  // Single template query (if id is provided and not 'new')
  const singleQuery = useQuery({
    queryKey: queryKeys.documentTemplate(id ?? ''),
    queryFn: () => api.documentTemplates.get(id as string),
    enabled: Boolean(id && id !== 'new' && options?.enabled !== false),
  });

  const fetchTemplates = useCallback(async () => {
    return await api.documentTemplates.list();
  }, []);

  const getTemplate = useCallback(async (templateId: string) => {
    return await api.documentTemplates.get(templateId);
  }, []);

  const saveTemplate = useCallback(
    async (input: CreateDocumentTemplateInput & { id?: string }) => {
      setIsSaving(true);
      try {
        if (input.id && input.id !== 'new') {
          const updated = await api.documentTemplates.update(input.id, input);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.documentTemplates }),
            queryClient.invalidateQueries({ queryKey: queryKeys.documentTemplate(input.id) }),
          ]);
          toast.success(`Template "${updated.name}" updated successfully`);
          return updated;
        } else {
          const { id: _, ...payload } = input;
          const created = await api.documentTemplates.create(payload);
          await queryClient.invalidateQueries({ queryKey: queryKeys.documentTemplates });
          toast.success(`Template "${created.name}" created successfully`);
          return created;
        }
      } catch (err) {
        toast.error(describe(err, 'Failed to save template'));
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [queryClient],
  );

  const deleteTemplate = useCallback(
    async (templateId: string) => {
      try {
        await api.documentTemplates.delete(templateId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.documentTemplates });
        toast.success('Template deleted successfully');
      } catch (err) {
        toast.error(describe(err, 'Failed to delete template'));
        throw err;
      }
    },
    [queryClient],
  );

  const setDefaultTemplate = useCallback(
    async (templateId: string, documentTypes: DocumentType[]) => {
      try {
        const updated = await api.documentTemplates.setDefault(templateId, { documentTypes });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.documentTemplates }),
          queryClient.invalidateQueries({ queryKey: queryKeys.documentTemplate(templateId) }),
        ]);
        toast.success(`Set as default template for ${documentTypes.join(', ')}`);
        return updated;
      } catch (err) {
        toast.error(describe(err, 'Failed to set default template'));
        throw err;
      }
    },
    [queryClient],
  );

  const generateWithAi = useCallback(
    async (prompt: string, baseConfig?: DocumentTemplateConfig) => {
      setIsGenerating(true);
      try {
        const config = await api.documentTemplates.generateAi({ prompt, baseConfig });
        toast.success('AI successfully updated the template styling');
        return config;
      } catch (err) {
        toast.error(describe(err, 'Failed to generate template configuration with AI'));
        throw err;
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  const previewPdf = useCallback(
    async (config: DocumentTemplateConfig, documentType?: DocumentType) => {
      try {
        return await api.documentTemplates.previewPdf({ config, documentType });
      } catch (err) {
        toast.error(describe(err, 'Failed to generate PDF preview'));
        throw err;
      }
    },
    [],
  );

  return {
    templates: listQuery.data ?? [],
    template: singleQuery.data ?? null,
    isLoading: listQuery.isLoading || (Boolean(id && id !== 'new') && singleQuery.isLoading),
    isSaving,
    isGenerating,
    error: listQuery.error || singleQuery.error,
    refetch: listQuery.refetch,
    fetchTemplates,
    getTemplate,
    saveTemplate,
    deleteTemplate,
    setDefaultTemplate,
    generateWithAi,
    previewPdf,
  };
}
