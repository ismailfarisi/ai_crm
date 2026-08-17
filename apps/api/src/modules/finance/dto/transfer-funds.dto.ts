export class TransferFundsDto {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
}
