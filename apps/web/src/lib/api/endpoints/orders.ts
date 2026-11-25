/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  SendOnWhatsAppPayload,
  WhatsAppSendResultDto,
  QuoteDto,
  QuoteProofsSummaryDto,
  SendQuoteInput,
  OrderJobCostDto,
  SalesOrderDto,
  SalesOrderStatus,
  WorkOrderProofDto,
} from '@saas/shared';
import { apiFetch, apiUpload } from '../client';

export interface SalesOrderListParams {
  status?: SalesOrderStatus;
}

export const ordersEndpoints = {
  salesOrders: {
    list: (params: SalesOrderListParams = {}) =>
      apiFetch<SalesOrderDto[]>('/sales-orders', { query: params }),
    get: (id: string) => apiFetch<SalesOrderDto>(`/sales-orders/${id}`),
    /** Quoted against actual cost. Needs quote:view_cost as well as order read. */
    costs: (id: string) => apiFetch<OrderJobCostDto>(`/sales-orders/${id}/costs`),
    forQuote: (quoteId: string) =>
      apiFetch<{ order: SalesOrderDto | null }>(`/quotes/${quoteId}/sales-order`),
    invoiceStage: (id: string, stageId: string) =>
      apiFetch<{ order: SalesOrderDto; invoiceId: string; isNew: boolean }>(
        `/sales-orders/${id}/stages/${stageId}/invoice`,
        { method: 'POST' },
      ),
    setStatus: (id: string, status: Exclude<SalesOrderStatus, 'CANCELLED'>) =>
      apiFetch<SalesOrderDto>(`/sales-orders/${id}/status`, { method: 'POST', body: { status } }),
    cancel: (id: string, reason: string | null) =>
      apiFetch<SalesOrderDto>(`/sales-orders/${id}/cancel`, { method: 'POST', body: { reason } }),
  },
  quoteAcceptance: {
    createLink: (quoteId: string) =>
      apiFetch<{ url: string; expiresAt: string }>(`/quotes/${quoteId}/acceptance-link`, {
        method: 'POST',
      }),
    /** Issues a link and emails it, rather than handing the sender a URL to paste. */
    send: (quoteId: string, body: SendQuoteInput = {}) =>
      apiFetch<{ sentTo: string; url: string; expiresAt: string }>(
        `/quotes/${quoteId}/send`,
        { method: 'POST', body },
      ),
    revise: (quoteId: string) => apiFetch<QuoteDto>(`/quotes/${quoteId}/revise`, { method: 'POST' }),
    /** For a customer who said yes some other way; raises the order like accepting the link does. */
    markAccepted: (quoteId: string, body: { name: string }) =>
      apiFetch<QuoteDto>(`/quotes/${quoteId}/mark-accepted`, { method: 'POST', body }),
    /** Through the business WhatsApp when it can send, otherwise a ready click-to-chat link. */
    sendOnWhatsApp: (quoteId: string, body: SendOnWhatsAppPayload) =>
      apiFetch<WhatsAppSendResultDto>(`/quotes/${quoteId}/whatsapp`, { method: 'POST', body }),
    sendProofOnWhatsApp: (quoteId: string, body: SendOnWhatsAppPayload) =>
      apiFetch<WhatsAppSendResultDto>(`/quotes/${quoteId}/proofs/whatsapp`, { method: 'POST', body }),
    proofs: (quoteId: string) => apiFetch<QuoteProofsSummaryDto>(`/quotes/${quoteId}/proofs`),
    uploadProof: (quoteId: string, file: File) =>
      apiUpload<QuoteProofsSummaryDto>(`/quotes/${quoteId}/proofs`, file),
    setProofRequired: (quoteId: string, required: boolean) =>
      apiFetch<{ proofRequired: boolean }>(`/quotes/${quoteId}/proof-requirement`, {
        method: 'PUT',
        body: { required },
      }),
    /** The approved artwork behind a work order, for the floor. */
    workOrderProof: (workOrderId: string) =>
      apiFetch<WorkOrderProofDto | null>(`/work-orders/${workOrderId}/proof`),
  },
};

export const ordersKeys = {
  salesOrders: (params: SalesOrderListParams = {}) => ['sales-orders', params] as const,
  salesOrder: (id: string) => ['sales-orders', id] as const,
  salesOrderCosts: (id: string) => ['sales-orders', id, 'costs'] as const,
  quoteSalesOrder: (quoteId: string) => ['sales-orders', 'quote', quoteId] as const,
};
