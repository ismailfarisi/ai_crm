import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppConfig } from '@/config/configuration';
import { getAiProvider } from './ai-provider.factory';
import {
  AiGenerateOptions,
  AiGenerateResult,
  AiStructuredOptions,
  AiStructuredResult,
} from './interfaces/ai-provider.interface';
import { AiUsageLog } from './entities/ai-usage-log.entity';

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
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectRepository(AiUsageLog)
    private readonly usageLogRepo: Repository<AiUsageLog>,
  ) {}

  isConfigured(): boolean {
    const ai = this.configService.get('ai', { infer: true });
    return Boolean(ai.anthropicApiKey);
  }

  async generateText(
    feature: string,
    options: AiGenerateOptions,
    actor: AiActor,
  ): Promise<AiGenerateResult> {
    const started = Date.now();
    const ai = this.configService.get('ai', { infer: true });
    const provider = getAiProvider(ai);

    try {
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
    const ai = this.configService.get('ai', { infer: true });
    const provider = getAiProvider(ai);

    try {
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
