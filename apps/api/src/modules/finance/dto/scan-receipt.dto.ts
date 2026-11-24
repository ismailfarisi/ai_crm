import { ExpenseItemDto } from '@saas/shared';

export class ScanReceiptDto {
  imageUrl?: string;
  base64?: string;
  mimeType?: string;
  rawText?: string;
}

export interface ScannedReceiptResult {
  merchantName: string;
  amount: number;
  currency: string;
  expenseDate: string;
  category: string;
  taxAmount?: number;
  /** The supplier's tax number (TRN) as printed on the receipt. */
  supplierTaxId?: string | null;
  /** The purchase code the VAT can be claimed under, when there is one. */
  taxCodeId?: string | null;
  confidence: number;
  items: ExpenseItemDto[];
  rawText?: string;
}
