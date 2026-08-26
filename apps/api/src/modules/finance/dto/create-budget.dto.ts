import { BudgetPeriod } from '@saas/shared';

export class CreateCategoryBudgetDto {
  category: string;
  period: BudgetPeriod;
  budgetAmount: number;
  spentAmount?: number;
  alertThresholdPercent?: number;
  startDate: string | Date;
  endDate: string | Date;
}
