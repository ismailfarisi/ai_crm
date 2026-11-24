import { ExpenseItemDto, ExpenseStatus } from '@saas/shared';

export class UpdateExpenseClaimDto {
  employeeId?: string;
  employeeName?: string;
  category?: string;
  amount?: number;
  currency?: string;
  merchantName?: string | null;
  expenseDate?: string | Date;
  receiptUrl?: string | null;
  notes?: string | null;
  rejectionReason?: string | null;
  items?: ExpenseItemDto[];
  /** A purchase tax code; null or left out means no VAT. */
  taxCodeId?: string | null;
  /** The VAT inside `amount`. Left out, it is worked out from the code's rate. */
  taxAmount?: number | null;
  /** The supplier's tax number (TRN) from the receipt. */
  supplierTaxId?: string | null;
  status?: ExpenseStatus;
}
