import { AccountType } from '@saas/shared';

export class CreateFinanceAccountDto {
  name: string;
  accountType: AccountType;
  currency?: string;
  balance?: number;
  accountNumber?: string | null;
  isDefault?: boolean;
}

/**
 * What can be changed on an account after it exists.
 *
 * `balance` is absent on purpose: a cash balance only moves through a posting,
 * never by editing a field.
 */
export class UpdateFinanceAccountDto {
  name?: string;
  accountNumber?: string | null;
  isDefault?: boolean;
}
