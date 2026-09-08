import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when an organization's monthly AI spend has hit its configured cap.
 * @nestjs/common has no built-in 429 exception — this mirrors
 * @nestjs/throttler's ThrottlerException (HttpException + TOO_MANY_REQUESTS).
 */
export class AiBudgetExceededException extends HttpException {
  constructor(
    public readonly organizationId: string,
    public readonly currentSpendUsd: number,
    public readonly monthlyBudgetUsd: number,
  ) {
    super(
      `Monthly AI budget of $${monthlyBudgetUsd.toFixed(2)} exceeded ` +
        `(current spend: $${currentSpendUsd.toFixed(2)}). Ask an admin to raise the cap.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
