/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  QuoteDto,
  CreateQuotePayload,
  UpdateQuotePayload,
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
  ProductTemplateDto,
  CostingPolicy,
  UpdateCostingPolicyPayload,
  ResolveLinesPayload,
  ResolvedLinesDto,
  PriceBreaksPayload,
  TemplatePriceBreaksDto,
  QuoteGuardrailsDto,
  InvoiceDto,
  InvoicePaymentDto,
  RecordInvoicePaymentPayload,
  VoidInvoicePayload,
} from '@saas/shared';
import { apiFetch, apiFetchBlob } from '../client';
import { API_PUBLIC_URL } from '../config';

export const salesEndpoints = {
  quotes: {
    list: () => apiFetch<QuoteDto[]>('/quotes'),
    get: (id: string) => apiFetch<QuoteDto>(`/quotes/${id}`),
    getNextNumber: () => apiFetch<{ nextNumber: string }>('/quotes/next-number'),
    create: (payload: CreateQuotePayload) =>
      apiFetch<QuoteDto>('/quotes', { method: 'POST', body: payload }),
    update: (id: string, payload: UpdateQuotePayload) =>
      apiFetch<QuoteDto>(`/quotes/${id}`, { method: 'PATCH', body: payload }),
    signal: (id: string, payload: { action: 'APPROVE' | 'REJECT' | 'OVERRIDE'; payload?: unknown }) =>
      apiFetch<QuoteDto>(`/quotes/${id}/signal`, { method: 'POST', body: payload }),
    guardrails: (id: string) => apiFetch<QuoteGuardrailsDto>(`/quotes/${id}/guardrails`),
  },
  catalog: {
    searchItems: (q?: string, limit = 25) =>
      apiFetch<CatalogItemDto[]>('/catalog/items', { query: { q, limit } }),

    /* The maintenance half of the catalog. The API has had full CRUD here
     * since the costing engine landed; only the read calls were ever wired up,
     * so a tenant could not put anything in the catalog the picker reads. */
    listItems: () => apiFetch<CatalogItemDto[]>('/catalog/items', { query: { limit: 500 } }),
    createItem: (payload: CreateCatalogItemPayload) =>
      apiFetch<CatalogItemDto>('/catalog/items', { method: 'POST', body: payload }),
    updateItem: (id: string, payload: UpdateCatalogItemPayload) =>
      apiFetch<CatalogItemDto>(`/catalog/items/${id}`, { method: 'PATCH', body: payload }),
    deleteItem: (id: string) =>
      apiFetch<{ success: true }>(`/catalog/items/${id}`, { method: 'DELETE' }),

    listMaterials: (includeInactive = true) =>
      apiFetch<MaterialDto[]>('/catalog/materials', {
        query: { includeInactive: String(includeInactive) },
      }),
    createMaterial: (payload: CreateMaterialPayload) =>
      apiFetch<MaterialDto>('/catalog/materials', { method: 'POST', body: payload }),
    updateMaterial: (id: string, payload: UpdateMaterialPayload) =>
      apiFetch<MaterialDto>(`/catalog/materials/${id}`, { method: 'PATCH', body: payload }),
    deleteMaterial: (id: string) =>
      apiFetch<{ success: true }>(`/catalog/materials/${id}`, { method: 'DELETE' }),

    listWorkCenters: (includeInactive = true) =>
      apiFetch<WorkCenterDto[]>('/catalog/work-centers', {
        query: { includeInactive: String(includeInactive) },
      }),
    createWorkCenter: (payload: CreateWorkCenterPayload) =>
      apiFetch<WorkCenterDto>('/catalog/work-centers', { method: 'POST', body: payload }),
    updateWorkCenter: (id: string, payload: UpdateWorkCenterPayload) =>
      apiFetch<WorkCenterDto>(`/catalog/work-centers/${id}`, { method: 'PATCH', body: payload }),
    deleteWorkCenter: (id: string) =>
      apiFetch<{ success: true }>(`/catalog/work-centers/${id}`, { method: 'DELETE' }),

    listTooling: (includeInactive = true) =>
      apiFetch<ToolingDto[]>('/catalog/tooling', {
        query: { includeInactive: String(includeInactive) },
      }),
    createTooling: (payload: CreateToolingPayload) =>
      apiFetch<ToolingDto>('/catalog/tooling', { method: 'POST', body: payload }),
    updateTooling: (id: string, payload: UpdateToolingPayload) =>
      apiFetch<ToolingDto>(`/catalog/tooling/${id}`, { method: 'PATCH', body: payload }),
    deleteTooling: (id: string) =>
      apiFetch<{ success: true }>(`/catalog/tooling/${id}`, { method: 'DELETE' }),

    listTemplates: () => apiFetch<ProductTemplateDto[]>('/catalog/templates'),
    getTemplate: (id: string) => apiFetch<ProductTemplateDto>(`/catalog/templates/${id}`),
    /**
     * Prices are decided server-side. The browser sends ids, quantities and
     * template parameters and gets finished lines back — it never computes a
     * price itself.
     */
    resolveLines: (payload: ResolveLinesPayload) =>
      apiFetch<ResolvedLinesDto>('/catalog/resolve-lines', { method: 'POST', body: payload }),
    priceBreaks: (templateId: string, payload: PriceBreaksPayload) =>
      apiFetch<TemplatePriceBreaksDto>(`/catalog/templates/${templateId}/price-breaks`, {
        method: 'POST',
        body: payload,
      }),
    getPolicy: () => apiFetch<CostingPolicy>('/catalog/policy'),
    updatePolicy: (payload: UpdateCostingPolicyPayload) =>
      apiFetch<CostingPolicy>('/catalog/policy', { method: 'PATCH', body: payload }),
  },
  invoices: {
    list: () => apiFetch<InvoiceDto[]>('/invoices'),
    get: (id: string) => apiFetch<InvoiceDto>(`/invoices/${id}`),
    recordPayment: (id: string, payload: RecordInvoicePaymentPayload) =>
      apiFetch<InvoiceDto>(`/invoices/${id}/payments`, {
        method: 'POST',
        body: payload,
      }),
    payments: (id: string) => apiFetch<InvoicePaymentDto[]>(`/invoices/${id}/payments`),
    void: (id: string, payload: VoidInvoicePayload) =>
      apiFetch<InvoiceDto>(`/invoices/${id}/void`, { method: 'POST', body: payload }),
    send: (id: string) =>
      apiFetch<InvoiceDto>(`/invoices/${id}/send`, { method: 'POST' }),
    downloadPdf: (id: string) => apiFetchBlob(`/invoices/${id}/pdf`),
    /** Absolute URL, for reference only — never navigate to it directly (cookie auth). */
    pdfUrl: (id: string) => `${API_PUBLIC_URL}/invoices/${id}/pdf`,
  },
};

export const salesKeys = {
  quotes: ['quotes'] as const,  quote: (id: string) => ['quotes', id] as const,  invoices: ['invoices'] as const,  invoice: (id: string) => ['invoices', id] as const,  invoicePayments: (id: string) => ['invoices', id, 'payments'] as const,  catalogItems: (q?: string) => ['catalog', 'items', q ?? ''] as const,  catalogItemsAll: ['catalog', 'items', 'all'] as const,
  catalogMaterials: ['catalog', 'materials'] as const,
  catalogWorkCenters: ['catalog', 'work-centers'] as const,
  catalogTooling: ['catalog', 'tooling'] as const,
  catalogTemplates: ['catalog', 'templates'] as const,  catalogTemplate: (id: string) => ['catalog', 'templates', id] as const,  costingPolicy: ['catalog', 'policy'] as const,  quoteGuardrails: (id: string) => ['quotes', id, 'guardrails'] as const,};
