import type { MaterialUom } from '../costing/types';

/**
 * Where a purchase order is in its life.
 *
 * `DRAFT` is deliberately the only state anything can be created in —
 * including from a chat message. Raising an order and authorising it are
 * separate acts, and the threshold check in `assertActorCanApprove` is what
 * separates them.
 */
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
];

/**
 * How a record came to exist. Generalises the `QuoteCreatedBy` pattern so
 * that an AI-drafted document can be told apart from a hand-typed one after
 * the fact — and so the audit trail can say which model produced it.
 */
export type RecordOrigin = 'HUMAN' | 'AI_ASSISTED' | 'AI_DRAFTED';

export interface OriginMetadata {
  origin: RecordOrigin;
  /** Present when the record arrived through a chat channel rather than the web app. */
  originChannel?: 'TELEGRAM' | 'WHATSAPP_META' | 'EMAIL_SMTP' | 'EMAIL_RESEND' | 'WEB';
  /** The inbound message that caused it, for reconstructing what was actually said. */
  originMessageId?: string;
  /** The model that produced the structured parse, as reported by the provider. */
  model?: string;
  /** Which revision of the skill's schema and description was in force. */
  promptVersion?: string;
  /** What the router reported, 0-1. */
  confidence?: number;
}

export interface SupplierDto {
  id: string;
  tenantId: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  taxId: string | null;
  currency: string | null;
  paymentTermsDays: number | null;
  leadTimeDays: number | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierMaterialDto {
  id: string;
  supplierId: string;
  materialId: string;
  supplierSku: string | null;
  /**
   * Held at 4dp to match `Material.costPerUom` — a unit cost gets divided
   * (sheets into pieces, kilos into grams) and rounding to two places there
   * compounds once it is multiplied back up by an order quantity.
   */
  unitCost: number;
  minOrderQty: number | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
}

export interface PurchaseOrderLineDto {
  id: string;
  materialId: string | null;
  description: string;
  qtyOrdered: number;
  qtyReceived: number;
  uom: MaterialUom;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseOrderDto {
  id: string;
  tenantId: string;
  poNumber: string;
  supplierId: string;
  /** Snapshot, the way `invoice.customerName` is — the order is a record of what was agreed. */
  supplierName: string;
  status: PurchaseOrderStatus;
  currency: string;
  orderDate: string;
  expectedDate: string | null;
  subtotalAmount: number;
  totalAmount: number;
  notes: string | null;
  lines: PurchaseOrderLineDto[];
  origin: RecordOrigin;
  createdById: string | null;
  createdAt: string;
}

export interface CreatePurchaseOrderLineInput {
  materialId?: string | null;
  description: string;
  qtyOrdered: number;
  uom: MaterialUom;
  unitCost: number;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  expectedDate?: Date | null;
  notes?: string | null;
  lines: CreatePurchaseOrderLineInput[];
  originMetadata?: OriginMetadata;
}
