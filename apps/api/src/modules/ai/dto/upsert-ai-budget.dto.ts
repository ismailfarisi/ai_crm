export class UpsertAiBudgetDto {
  monthlyBudgetUsd: number;
  alertThresholdPercent?: number;
  isEnabled?: boolean;
  automationAiEmailToCustomers?: boolean;
}
