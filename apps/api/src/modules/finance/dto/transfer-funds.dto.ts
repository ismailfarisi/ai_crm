export class TransferFundsDto {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  /** What arrived, in the destination's currency, when the two accounts differ. */
  toAmount?: number;
  description?: string;
}
