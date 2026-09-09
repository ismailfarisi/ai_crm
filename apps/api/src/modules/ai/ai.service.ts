import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AiBudgetStatusDto } from '@saas/shared';
import { getAiProvider } from './ai-provider.factory';
import {
  AiGenerateOptions,
  AiGenerateResult,
  AiStructuredOptions,
  AiStructuredResult,
  AiNotConfiguredException,
} from './interfaces/ai-provider.interface';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { AiBudget } from './entities/ai-budget.entity';
import { AiBudgetExceededException } from './exceptions/ai-budget-exceeded.exception';
import { UpsertAiBudgetDto } from './dto/upsert-ai-budget.dto';
import { AiConfigService } from './services/ai-config.service';

export interface AiActor {
  organizationId: string;
  userId?: string;
}

/**
 * $ per million tokens, by model id. Hand-maintained — update when Anthropic's
 * pricing changes. Unknown models fall back to a conservative estimate rather
 * than throwing, since cost tracking shouldn't block a successful AI call.
 */
const PRICING_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 15, output: 75 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly aiConfigService: AiConfigService,
    @InjectRepository(AiUsageLog)
    private readonly usageLogRepo: Repository<AiUsageLog>,
    @InjectRepository(AiBudget)
    private readonly budgetRepo: Repository<AiBudget>,
  ) {}

  async isConfigured(organizationId: string): Promise<boolean> {
    try {
      await this.aiConfigService.resolveProviderConfig(organizationId);
      return true;
    } catch (err) {
      if (err instanceof AiNotConfiguredException) return false;
      throw err;
    }
  }

  async generateText(
    feature: string,
    options: AiGenerateOptions,
    actor: AiActor,
  ): Promise<AiGenerateResult> {
    const started = Date.now();
    const providerConfig = await this.aiConfigService.resolveProviderConfig(
      actor.organizationId,
      options.provider,
    );
    const provider = getAiProvider(providerConfig);

    try {
      await this.enforceBudget(actor.organizationId);
      const result = await provider.generateText(options);
      await this.logUsage({
        feature,
        actor,
        providerName: provider.name,
        model: result.model,
        usage: result.usage,
        durationMs: Date.now() - started,
        success: true,
      });
      return result;
    } catch (err) {
      await this.logUsage({
        feature,
        actor,
        providerName: provider.name,
        model: options.model || 'unknown',
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - started,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async generateStructured<T>(
    feature: string,
    options: AiStructuredOptions,
    actor: AiActor,
  ): Promise<AiStructuredResult<T>> {
    const started = Date.now();
    const providerConfig = await this.aiConfigService.resolveProviderConfig(
      actor.organizationId,
      options.provider,
    );
    const provider = getAiProvider(providerConfig);

    try {
      await this.enforceBudget(actor.organizationId);
      const result = await provider.generateStructured<T>(options);
      await this.logUsage({
        feature,
        actor,
        providerName: provider.name,
        model: result.model,
        usage: result.usage,
        durationMs: Date.now() - started,
        success: true,
      });
      return result;
    } catch (err) {
      await this.logUsage({
        feature,
        actor,
        providerName: provider.name,
        model: options.model || 'unknown',
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - started,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Hard-stops further AI calls once an org's current-month spend hits its
   * configured cap. This is a check-then-act over an async DB round trip, not
   * transactional — a burst of concurrent calls could each read the same
   * pre-increment sum and briefly overshoot the cap. Accepted tradeoff given
   * this app's realistic AI call volume (a handful of concurrent calls per
   * org), rather than building distributed-lock/atomic-counter machinery.
   *
   * Fails open on infrastructure errors (the SUM query itself failing) — a
   * guard must never become an availability risk for the underlying feature,
   * consistent with how Temporal/AI-provider failures degrade elsewhere.
   */
  private async enforceBudget(organizationId: string): Promise<void> {
    try {
      const budget = await this.budgetRepo.findOne({
        where: { organizationId },
      });
      if (!budget || !budget.isEnabled) return;

      const currentSpendUsd = await this.sumCurrentPeriodSpend(organizationId);
      if (currentSpendUsd >= budget.monthlyBudgetUsd) {
        throw new AiBudgetExceededException(
          organizationId,
          currentSpendUsd,
          budget.monthlyBudgetUsd,
        );
      }
    } catch (err) {
      if (err instanceof AiBudgetExceededException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `AI budget check failed, allowing call through (fail-open): ${msg}`,
      );
    }
  }

  async getBudgetStatus(organizationId: string): Promise<AiBudgetStatusDto> {
    const periodStart = this.startOfCurrentMonthUtc();
    const periodEnd = new Date();
    const currentSpendUsd = await this.sumCurrentPeriodSpend(organizationId);
    const budget = await this.budgetRepo.findOne({ where: { organizationId } });

    if (!budget) {
      return {
        budget: null,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        currentSpendUsd,
        percentage: null,
        isNearLimit: false,
        isOverBudget: false,
      };
    }

    const percentage =
      budget.monthlyBudgetUsd > 0
        ? (currentSpendUsd / budget.monthlyBudgetUsd) * 100
        : 0;
    const isOverBudget = currentSpendUsd >= budget.monthlyBudgetUsd;
    const isNearLimit =
      !isOverBudget && percentage >= budget.alertThresholdPercent;

    return {
      budget: {
        organizationId: budget.organizationId,
        monthlyBudgetUsd: budget.monthlyBudgetUsd,
        alertThresholdPercent: budget.alertThresholdPercent,
        isEnabled: budget.isEnabled,
        createdAt: budget.createdAt.toISOString(),
        updatedAt: budget.updatedAt.toISOString(),
      },
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      currentSpendUsd,
      percentage,
      isNearLimit,
      isOverBudget,
    };
  }

  async upsertBudget(
    organizationId: string,
    dto: UpsertAiBudgetDto,
  ): Promise<AiBudget> {
    let budget = await this.budgetRepo.findOne({ where: { organizationId } });

    if (budget) {
      budget.monthlyBudgetUsd = dto.monthlyBudgetUsd;
      if (dto.alertThresholdPercent !== undefined) {
        budget.alertThresholdPercent = dto.alertThresholdPercent;
      }
      if (dto.isEnabled !== undefined) {
        budget.isEnabled = dto.isEnabled;
      }
    } else {
      budget = this.budgetRepo.create({
        organizationId,
        monthlyBudgetUsd: dto.monthlyBudgetUsd,
        alertThresholdPercent: dto.alertThresholdPercent ?? 80,
        isEnabled: dto.isEnabled ?? true,
      });
    }

    return this.budgetRepo.save(budget);
  }

  async listUsage(organizationId: string, limit = 50): Promise<AiUsageLog[]> {
    return this.usageLogRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  private async sumCurrentPeriodSpend(organizationId: string): Promise<number> {
    const result = await this.usageLogRepo
      .createQueryBuilder('log')
      .select('COALESCE(SUM(log.estimatedCostUsd), 0)', 'sum')
      .where('log.organizationId = :organizationId', { organizationId })
      .andWhere('log.createdAt >= :periodStart', {
        periodStart: this.startOfCurrentMonthUtc(),
      })
      .getRawOne<{ sum: string }>();
    return Number(result?.sum ?? 0);
  }

  private startOfCurrentMonthUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private estimateCostUsd(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const pricing = PRICING_PER_MILLION_TOKENS[model] || DEFAULT_PRICING;
    return (
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output
    );
  }

  private async logUsage(entry: {
    feature: string;
    actor: AiActor;
    providerName: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
    durationMs: number;
    success: boolean;
    errorMessage?: string;
  }): Promise<void> {
    try {
      const log = this.usageLogRepo.create({
        organizationId: entry.actor.organizationId,
        feature: entry.feature,
        provider: entry.providerName,
        model: entry.model,
        inputTokens: entry.usage.inputTokens,
        outputTokens: entry.usage.outputTokens,
        estimatedCostUsd: this.estimateCostUsd(
          entry.model,
          entry.usage.inputTokens,
          entry.usage.outputTokens,
        ),
        success: entry.success,
        errorMessage: entry.errorMessage ?? null,
        actorUserId: entry.actor.userId ?? null,
        durationMs: entry.durationMs,
      });
      await this.usageLogRepo.save(log);
    } catch (err) {
      // Usage logging must never break the actual AI call/feature.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to write AI usage log: ${msg}`);
    }
  }
}
