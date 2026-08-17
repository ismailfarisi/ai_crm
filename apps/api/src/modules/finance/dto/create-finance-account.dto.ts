import { AccountType } from '@saas/shared';

export class CreateFinanceAccountDto {
  name: string;
  accountType: AccountType;
  currency?: string;
  balance?: number;
  accountNumber?: string | null;
  isDefault?: boolean;
}
