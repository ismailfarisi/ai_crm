/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  QuoteDto,
  SendQuoteInput,
  SalesOrderDto,
  SalesOrderStatus,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface SalesOrderListParams {
  status?: SalesOrderStatus;
}

export const ordersEndpoints = {
  salesOrders: {
    list: (params: SalesOrderListParams = {}) =>
      apiFetch<SalesOrderDto[]>('/sales-orders', { query: params }),
    get: (id: string) => apiFetch<SalesOrderDto>(`/sales-orders/${id}`),
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
  },
};

export const ordersKeys = {
  salesOrders: (params: SalesOrderListParams = {}) => ['sales-orders', params] as const,
  salesOrder: (id: string) => ['sales-orders', id] as const,
  quoteSalesOrder: (quoteId: string) => ['sales-orders', 'quote', quoteId] as const,
};
