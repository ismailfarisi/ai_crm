import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import { useDocumentTemplates } from './use-document-templates';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG, type DocumentTemplateConfig } from '@saas/shared';
import type { DocumentTemplateDto } from '@/lib/api/endpoints/document-templates';

vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      documentTemplates: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        setDefault: vi.fn(),
        generateAi: vi.fn(),
        previewPdf: vi.fn(),
      },
    },
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockTemplate: DocumentTemplateDto = {
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Standard Modern',
  description: 'Default company template',
  isDefault: true,
  appliesTo: ['INVOICE', 'QUOTE'],
  config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
  createdById: 'user-1',
};

describe('useDocumentTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches templates list via fetchTemplates', async () => {
    vi.mocked(api.documentTemplates.list).mockResolvedValue([mockTemplate]);

    const { result } = renderHook(() => useDocumentTemplates(), {
      wrapper: createWrapper(),
    });

    let templates: DocumentTemplateDto[] = [];
    await act(async () => {
      templates = await result.current.fetchTemplates();
    });

    expect(api.documentTemplates.list).toHaveBeenCalled();
    expect(templates).toEqual([mockTemplate]);
  });

  it('saves a new template when no id is provided', async () => {
    const createdTemplate: DocumentTemplateDto = {
      ...mockTemplate,
      id: 'tmpl-2',
      name: 'New Custom Template',
    };
    vi.mocked(api.documentTemplates.create).mockResolvedValue(createdTemplate);

    const { result } = renderHook(() => useDocumentTemplates(), {
      wrapper: createWrapper(),
    });

    let saved: DocumentTemplateDto | null = null;
    await act(async () => {
      saved = await result.current.saveTemplate({
        name: 'New Custom Template',
        description: 'A new template',
        isDefault: false,
        appliesTo: ['INVOICE'],
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      });
    });

    expect(api.documentTemplates.create).toHaveBeenCalledWith({
      name: 'New Custom Template',
      description: 'A new template',
      isDefault: false,
      appliesTo: ['INVOICE'],
      config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    });
    expect(saved).toEqual(createdTemplate);
  });

  it('updates an existing template when an id is provided', async () => {
    const updatedTemplate: DocumentTemplateDto = {
      ...mockTemplate,
      name: 'Updated Template',
    };
    vi.mocked(api.documentTemplates.update).mockResolvedValue(updatedTemplate);

    const { result } = renderHook(() => useDocumentTemplates(), {
      wrapper: createWrapper(),
    });

    let saved: DocumentTemplateDto | null = null;
    await act(async () => {
      saved = await result.current.saveTemplate({
        id: 'tmpl-1',
        name: 'Updated Template',
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      });
    });

    expect(api.documentTemplates.update).toHaveBeenCalledWith('tmpl-1', {
      id: 'tmpl-1',
      name: 'Updated Template',
      config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    });
    expect(saved).toEqual(updatedTemplate);
  });

  it('generates template configuration using AI via generateWithAi', async () => {
    const aiConfig: DocumentTemplateConfig = {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      branding: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
        primaryColor: '#0055ff',
      },
    };
    vi.mocked(api.documentTemplates.generateAi).mockResolvedValue(aiConfig);

    const { result } = renderHook(() => useDocumentTemplates(), {
      wrapper: createWrapper(),
    });

    let generated: DocumentTemplateConfig | null = null;
    await act(async () => {
      generated = await result.current.generateWithAi(
        'Make primary color royal blue and layout compact',
        DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      );
    });

    expect(api.documentTemplates.generateAi).toHaveBeenCalledWith({
      prompt: 'Make primary color royal blue and layout compact',
      baseConfig: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    });
    expect(generated).toEqual(aiConfig);
  });

  it('sets a template as default for specified document types', async () => {
    vi.mocked(api.documentTemplates.setDefault).mockResolvedValue({
      ...mockTemplate,
      isDefault: true,
      appliesTo: ['INVOICE', 'STATEMENT'],
    });

    const { result } = renderHook(() => useDocumentTemplates(), {
      wrapper: createWrapper(),
    });

    let updated: DocumentTemplateDto | null = null;
    await act(async () => {
      updated = await result.current.setDefaultTemplate('tmpl-1', ['INVOICE', 'STATEMENT']);
    });

    expect(api.documentTemplates.setDefault).toHaveBeenCalledWith('tmpl-1', {
      documentTypes: ['INVOICE', 'STATEMENT'],
    });
    expect((updated as DocumentTemplateDto | null)?.isDefault).toBe(true);
  });

  it('previews a template PDF', async () => {
    const dummyBlob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
    vi.mocked(api.documentTemplates.previewPdf).mockResolvedValue(dummyBlob);

    const { result } = renderHook(() => useDocumentTemplates(), {
      wrapper: createWrapper(),
    });

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.previewPdf(DEFAULT_DOCUMENT_TEMPLATE_CONFIG, 'QUOTE');
    });

    expect(api.documentTemplates.previewPdf).toHaveBeenCalledWith({
      config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      documentType: 'QUOTE',
    });
    expect(blob).toEqual(dummyBlob);
  });
});
