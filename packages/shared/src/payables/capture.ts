/**
 * Reading a supplier's invoice into a bill.
 *
 * Capture only *proposes*. It reads the document, finds the supplier, the
 * order and the order lines it thinks the invoice is for, and says what it is
 * unsure of. Nothing is saved: the bill is entered through the ordinary route,
 * so the three-way match, the duplicate check and approval all run exactly as
 * they do for a bill typed in by hand.
 */

export const BILL_CAPTURE_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type BillCaptureContentType = (typeof BILL_CAPTURE_CONTENT_TYPES)[number];

/** 20 MB. Base64 adds a third, and the model's request ceiling is 32 MB. */
export const BILL_CAPTURE_MAX_BYTES = 20 * 1024 * 1024;

export const isBillCaptureContentType = (v: string): v is BillCaptureContentType =>
  (BILL_CAPTURE_CONTENT_TYPES as readonly string[]).includes(v);

/** The fields capture can say it is unsure of, so a form can highlight them. */
export type CapturedField =
  | 'supplier'
  | 'supplierInvoiceNumber'
  | 'purchaseOrderReference'
  | 'billDate'
  | 'dueDate'
  | 'currency'
  | 'taxAmount'
  | 'totalAmount'
  | 'lines';

export interface CapturedInvoiceLine {
  description: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

/** What is printed on the document, as read. Nothing here is resolved yet. */
export interface CapturedInvoice {
  /** False when the document is not a supplier invoice at all — a quote, a statement, a delivery note. */
  isInvoice: boolean;
  supplierName: string | null;
  /** TRN or other tax registration, as printed. */
  supplierTaxId: string | null;
  supplierInvoiceNumber: string | null;
  /** Our PO number as the supplier quoted it, if they did. */
  purchaseOrderReference: string | null;
  /** YYYY-MM-DD. */
  billDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  lines: CapturedInvoiceLine[];
  /** 0–1, the model's own estimate for the read as a whole. */
  confidence: number;
  uncertainFields: CapturedField[];
}

export type BillCaptureWarningCode =
  | 'NOT_AN_INVOICE'
  | 'LOW_CONFIDENCE'
  | 'DUPLICATE'
  | 'SUPPLIER_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_OTHER_SUPPLIER'
  | 'CURRENCY_MISMATCH'
  | 'LINES_DO_NOT_ADD_UP'
  | 'TOTAL_DOES_NOT_ADD_UP'
  | 'LINE_NOT_ON_ORDER';

export interface BillCaptureWarning {
  code: BillCaptureWarningCode;
  /** Written for the person checking the bill. */
  message: string;
}

/** Which order line an invoice line was paired with, and how sure the pairing is. */
export interface CapturedLineMatch {
  /** Index into `invoice.lines`. */
  index: number;
  purchaseOrderLineId: string | null;
  /** 0–1. Zero when unpaired. */
  score: number;
}

export interface BillCaptureResult {
  invoice: CapturedInvoice;
  supplier: { id: string; companyName: string; currency: string | null } | null;
  /** Near misses, when no supplier was certain enough to choose. */
  supplierCandidates: { id: string; companyName: string }[];
  purchaseOrder: { id: string; poNumber: string } | null;
  /** The supplier's open orders, when none was certain enough to choose. */
  orderCandidates: { id: string; poNumber: string; totalAmount: number; currency: string }[];
  lines: CapturedLineMatch[];
  /** A live bill already entered for this supplier invoice number. */
  duplicateOf: { id: string; billNumber: string } | null;
  warnings: BillCaptureWarning[];
  model: string;
  promptVersion: string;
}
