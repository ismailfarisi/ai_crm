/* One slice of the browser's API surface. Composed in ./index.ts. */
import type {
  AdjustStockPayload,
  ReceiveGoodsPayload,
  SetReorderLevelsPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface StockItemDto {
  id: string;
  materialId: string;
  /** Denormalised by the API: displaying an id helps nobody on a stock take. */
  materialName: string;
  materialSku: string | null;
  uom: string;
  locationId: string;
  locationName: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyOnOrder: number;
  avgUnitCost: number;
  reorderPoint: number | null;
  reorderQty: number | null;
}

export interface StockLocationDto {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface ReorderSuggestionDto {
  item: StockItemDto;
  shortfall: number;
  suggestedQty: number;
}

export interface GoodsReceiptDto {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  receivedAt: string;
  supplierReference: string | null;
  totalValue: number;
  journalEntryId: string | null;
  lines: {
    id: string;
    purchaseOrderLineId: string;
    materialId: string | null;
    description: string;
    qtyReceived: number;
    qtyRejected: number;
    unitCost: number;
  }[];
}

/** A cached position against a replay of the ledger. Should always be empty. */
export interface StockDivergenceDto {
  materialId: string;
  locationId: string;
  cached: number;
  replayed: number;
}

export const inventoryEndpoints = {
  inventory: {
    stock: () => apiFetch<StockItemDto[]>('/inventory/stock'),
    locations: () => apiFetch<StockLocationDto[]>('/inventory/locations'),
    reorderSuggestions: () =>
      apiFetch<ReorderSuggestionDto[]>('/inventory/reorder-suggestions'),
    reconcile: () => apiFetch<StockDivergenceDto[]>('/inventory/reconcile'),
    adjust: (input: AdjustStockPayload) =>
      apiFetch<unknown>('/inventory/adjustments', { method: 'POST', body: input }),
    setReorderLevels: (input: SetReorderLevelsPayload) =>
      apiFetch<StockItemDto>('/inventory/reorder-levels', { method: 'POST', body: input }),
  },

  goodsReceipts: {
    list: (purchaseOrderId?: string) =>
      apiFetch<GoodsReceiptDto[]>('/goods-receipts', {
        query: purchaseOrderId ? { purchaseOrderId } : {},
      }),
    receive: (purchaseOrderId: string, input: ReceiveGoodsPayload) =>
      apiFetch<GoodsReceiptDto>(`/purchase-orders/${purchaseOrderId}/receipts`, {
        method: 'POST',
        body: input,
      }),
  },
};

export const inventoryKeys = {
  stock: ['inventory', 'stock'] as const,
  stockLocations: ['inventory', 'locations'] as const,
  reorderSuggestions: ['inventory', 'reorder'] as const,
  stockReconcile: ['inventory', 'reconcile'] as const,
  goodsReceipts: (purchaseOrderId?: string) =>
    ['goods-receipts', purchaseOrderId ?? 'all'] as const,
};
