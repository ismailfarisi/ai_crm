export interface AiBudgetDto {
  organizationId: string;
  monthlyBudgetUsd: number;
  alertThresholdPercent: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAiBudgetPayload {
  monthlyBudgetUsd: number;
  alertThresholdPercent?: number;
  isEnabled?: boolean;
}

/** Derived, read-only — computed on the fly server-side, never persisted as a counter. */
export interface AiBudgetStatusDto {
  /** Null when no AiBudget row exists for the org (unlimited / guard not opted in). */
  budget: AiBudgetDto | null;
  periodStart: string;
  periodEnd: string;
  currentSpendUsd: number;
  /** Null when budget is null (nothing to compare against). */
  percentage: number | null;
  isNearLimit: boolean;
  isOverBudget: boolean;
}

export interface AiUsageLogDto {
  id: string;
  organizationId: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  success: boolean;
  errorMessage: string | null;
  actorUserId: string | null;
  durationMs: number | null;
  createdAt: string;
}
