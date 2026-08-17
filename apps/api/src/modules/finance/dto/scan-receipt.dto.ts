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
  confidence: number;
  items: ExpenseItemDto[];
  rawText?: string;
}
