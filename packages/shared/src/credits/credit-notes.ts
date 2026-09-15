/**
 * Credit notes, refunds and delivery notes.
 *
 * Until now the only way back from an invoice was to void it: cancel the
 * whole document and reverse every payment on it. That is the right tool for
 * an invoice raised in error and the wrong one for everything else — a
 * damaged carton on a paid order, a price agreed down after the fact. A
 * credit note reduces what is owed by part of an invoice and leaves the
 * invoice, and its payments, standing.
 */

import type { TaxBreakdownLine } from '../tax/tax';

export type CreditNoteStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const fromCents = (n: number) => n / 100;

/**
 * Where an invoice stands once credits and refunds are counted.
 *
 * `balance` is what the customer still owes; negative means they have paid
 * more than they now owe and are due money back. `refundable` is that
 * negative balance, as a positive amount, less anything already refunded —
 * refunds are only ever of money actually received.
 */
export function invoicePosition(invoice: {
  amount: number;
  paidAmount: number | null;
  creditedAmount: number;
  refundedAmount: number;
}): { balance: number; creditable: number; refundable: number } {
  const amount = cents(invoice.amount);
  const paid = cents(invoice.paidAmount ?? 0);
  const credited = cents(invoice.creditedAmount);
  const refunded = cents(invoice.refundedAmount);
  const balance = amount - paid - credited + refunded;
  return {
    balance: fromCents(balance),
    creditable: fromCents(Math.max(0, amount - credited)),
    refundable: fromCents(Math.max(0, -balance)),
  };
}

export interface CreditNoteLineInput {
  description: string;
  qty: number;
  unitPrice: number;
  /** Percentage. Taken from the invoice line being credited when omitted. */
  taxRate: number;
  taxCodeId?: string | null;
  taxCode?: string | null;
  reverseCharge?: boolean;
}

export interface CreditNoteDto {
  id: string;
  creditNoteNumber: string;
  status: CreditNoteStatus;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  reason: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  refundedAmount: number;
  taxBreakdown: TaxBreakdownLine[];
  lines: (CreditNoteLineInput & { id: string; net: number })[];
  issuedAt: string | null;
  createdAt: string;
}

export interface CreditNoteRefundDto {
  id: string;
  amount: number;
  financeAccountId: string;
  reference: string | null;
  refundedAt: string;
}

/* ------------------------------------------------------------------ *
 * Delivery notes
 * ------------------------------------------------------------------ */

export type DeliveryNoteStatus = 'DRAFT' | 'DISPATCHED' | 'CANCELLED';

export interface DeliveryNoteLineDto {
  id: string;
  salesOrderLineId: string;
  description: string;
  uom: string | null;
  qty: number;
  /** Set when the line was sold from stock, so dispatch moved it off the shelf. */
  stockMaterialId: string | null;
}

export interface DeliveryNoteDto {
  id: string;
  deliveryNoteNumber: string;
  status: DeliveryNoteStatus;
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  shipTo: string | null;
  carrier: string | null;
  trackingReference: string | null;
  notes: string | null;
  lines: DeliveryNoteLineDto[];
  invoiceId: string | null;
  invoiceNumber: string | null;
  dispatchedAt: string | null;
  createdAt: string;
}

/**
 * Whether a delivery of `qty` fits what is left to ship on an order line.
 *
 * Draft deliveries count against the line: two drafts for the whole quantity
 * would otherwise both look valid until the second one was dispatched.
 */
export function remainingToDeliver(line: {
  qtyOrdered: number;
  qtyFulfilled: number;
  qtyInDraft: number;
}): number {
  return Math.max(0, Math.round((line.qtyOrdered - line.qtyFulfilled - line.qtyInDraft) * 10000) / 10000);
}
