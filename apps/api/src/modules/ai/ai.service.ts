import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
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
import { RedisBudgetGuardService } from './services/redis-budget-guard.service';

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
    @Optional()
    private readonly redisBudgetGuard?: RedisBudgetGuardService,
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
    let reservation:
      | { reservedAmount: number; periodKey: string }
      | undefined;
    let providerCallStarted = false;
    let actualUsage: { inputTokens: number; outputTokens: number } | undefined;
    let actualModel: string | undefined;

    try {
      reservation = await this.reserveBudget(actor.organizationId, options);
      providerCallStarted = true;
      const result = await provider.generateText(options);
      actualUsage = result.usage;
      actualModel = result.model;
      await this.reconcileBudget(reservation, actor.organizationId, result.model, result.usage);
      reservation = undefined;
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
      if (!providerCallStarted) {
        await this.releaseBudget(reservation, actor.organizationId);
      }
      await this.logUsage({
        feature,
        actor,
        providerName: provider.name,
        model: actualModel || options.model || 'unknown',
        usage: actualUsage ?? { inputTokens: 0, outputTokens: 0 },
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
    let reservation:
      | { reservedAmount: number; periodKey: string }
      | undefined;
    let providerCallStarted = false;
    let actualUsage: { inputTokens: number; outputTokens: number } | undefined;
    let actualModel: string | undefined;

    try {
      reservation = await this.reserveBudget(actor.organizationId, options);
      providerCallStarted = true;
      const result = await provider.generateStructured<T>(options);
      actualUsage = result.usage;
      actualModel = result.model;
      await this.reconcileBudget(reservation, actor.organizationId, result.model, result.usage);
      reservation = undefined;
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
      if (!providerCallStarted) {
        await this.releaseBudget(reservation, actor.organizationId);
      }
      await this.logUsage({
        feature,
        actor,
        providerName: provider.name,
        model: actualModel || options.model || 'unknown',
        usage: actualUsage ?? { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - started,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async reserveBudget(
    organizationId: string,
    options: AiGenerateOptions & { jsonSchema?: Record<string, unknown> },
  ): Promise<{ reservedAmount: number; periodKey: string } | undefined> {
    const budget = await this.budgetRepo.findOne({ where: { organizationId } });
    if (!budget?.isEnabled) return undefined;
    if (!this.redisBudgetGuard) {
      throw new ServiceUnavailableException(
        'AI budget enforcement is unavailable because Redis is not configured',
      );
    }

    const currentSpendUsd = await this.sumCurrentPeriodSpend(organizationId);
    let inputCharacters =
      (options.system?.length ?? 0) +
      (options.jsonSchema ? JSON.stringify(options.jsonSchema).length : 0);
    let imageCount = 0;
    for (const message of options.messages) {
      if (typeof message.content === 'string') {
        inputCharacters += message.content.length;
        continue;
      }
      for (const block of message.content) {
        if (block.type === 'text') {
          inputCharacters += block.text.length;
        } else {
          imageCount++;
        }
      }
    }
    const inputTokens = Math.max(
      1,
      Math.ceil(inputCharacters / 4) + imageCount * 4096,
    );
    const outputTokens = Math.max(1, options.maxTokens ?? 4096);
    const estimatedCostUsd = this.estimateCostUsd(
      options.model ?? '',
      inputTokens,
      outputTokens,
    );
    const reservation = await this.redisBudgetGuard.checkAndReserve(
      organizationId,
      estimatedCostUsd,
      budget.monthlyBudgetUsd,
      currentSpendUsd,
    );
    if (!reservation.allowed) {
      throw new AiBudgetExceededException(
        organizationId,
        reservation.currentSpendUsd,
        budget.monthlyBudgetUsd,
      );
    }
    return reservation;
  }

  private async reconcileBudget(
    reservation:
      | { reservedAmount: number; periodKey: string }
      | undefined,
    organizationId: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<void> {
    if (!reservation || !this.redisBudgetGuard) return;
    await this.redisBudgetGuard.reconcile(
      organizationId,
      this.estimateCostUsd(model, usage.inputTokens, usage.outputTokens),
      reservation.reservedAmount,
      reservation.periodKey,
    );
  }

  private async releaseBudget(
    reservation:
      | { reservedAmount: number; periodKey: string }
      | undefined,
    organizationId: string,
  ): Promise<void> {
    if (!reservation || !this.redisBudgetGuard) return;
    try {
      await this.redisBudgetGuard.reconcile(
        organizationId,
        0,
        reservation.reservedAmount,
        reservation.periodKey,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to release AI budget reservation: ${msg}`);
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
