import { BadRequestException } from '@nestjs/common';
import {
  AiProvider,
  AiNotConfiguredException,
} from './interfaces/ai-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';

export interface AiProviderConfig {
  provider: string;
  anthropicApiKey?: string;
  anthropicModel: string;
}

/**
 * Plain function, not NestJS-DI-bound, so it can be called both from `AiService`
 * (NestJS side) and from Temporal activities (worker-process side, no DI) once
 * those are wired up to real AI calls.
 */
export function getAiProvider(config: AiProviderConfig): AiProvider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.anthropicApiKey) {
        throw new AiNotConfiguredException();
      }
      return new AnthropicProvider({
        apiKey: config.anthropicApiKey,
        defaultModel: config.anthropicModel,
      });
    default:
      throw new BadRequestException(
        `Unsupported AI provider: ${config.provider}`,
      );
  }
}
