export class CreateRecurringExpenseDto {
  vendorName: string;
  category: string;
  amount: number;
  billingInterval: 'MONTHLY' | 'ANNUAL';
  nextBillingDate: string | Date;
  financeAccountId?: string | null;
  status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
}
