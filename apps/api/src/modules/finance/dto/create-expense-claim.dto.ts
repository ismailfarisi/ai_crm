import { ExpenseItemDto, ExpenseStatus } from '@saas/shared';

export class CreateExpenseClaimDto {
  claimNumber?: string;
  employeeId?: string;
  employeeName?: string;
  category: string;
  amount: number;
  currency?: string;
  merchantName?: string | null;
  expenseDate?: string | Date;
  receiptUrl?: string | null;
  items?: ExpenseItemDto[];
  status?: ExpenseStatus;
}
