export type QuoteLineItemType = 'product' | 'section' | 'note';

export type QuoteStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type QuoteCreatedBy = 'AI' | 'HUMAN';

export interface QuoteLineItem {
  id: string;
  type: QuoteLineItemType;
  description: string;
  quantity?: number;
  uom?: string; // Units, Hours, Days, Licenses, Months, etc.
  unitPrice?: number;
  discount?: number; // 0 - 100 percentage
  taxRate?: number; // 0, 5, 10, 20 etc. percentage
  subtotal?: number; // line untaxed total after discount
}

export interface QuoteTotals {
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export function calculateQuoteTotals(items: QuoteLineItem[]): QuoteTotals {
  let subtotalAmount = 0;
  let discountAmount = 0;
  let taxAmount = 0;

  for (const item of items || []) {
    if (item.type === 'product') {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const discountPercent = Math.min(100, Math.max(0, Number(item.discount) || 0));
      const taxPercent = Math.max(0, Number(item.taxRate) || 0);

      const grossLine = qty * price;
      const discountVal = grossLine * (discountPercent / 100);
      const lineSubtotal = grossLine - discountVal;
      const lineTax = lineSubtotal * (taxPercent / 100);

      subtotalAmount += lineSubtotal;
      discountAmount += discountVal;
      taxAmount += lineTax;
    }
  }

  return {
    subtotalAmount: Number(subtotalAmount.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    totalAmount: Number((subtotalAmount + taxAmount).toFixed(2)),
  };
}

export interface CreateQuotePayload {
  title: string;
  quoteNumber?: string;
  customerId?: string | null;
  customerName?: string;
  customerEmail?: string | null;
  validUntil?: string | null;
  paymentTerms?: string;
  currency?: string;
  items?: QuoteLineItem[];
  subtotalAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  createdBy?: QuoteCreatedBy;
}

export interface UpdateQuotePayload extends Partial<CreateQuotePayload> {
  status?: QuoteStatus;
}

export interface QuoteDto {
  id: string;
  tenantId: string;
  quoteNumber: string;
  customerId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  title: string;
  status: QuoteStatus;
  createdBy: QuoteCreatedBy;
  validUntil?: string | null;
  paymentTerms: string;
  currency: string;
  items: QuoteLineItem[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
}
