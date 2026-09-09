import { BadRequestException } from '@nestjs/common';
import {
  AiProvider,
  AiNotConfiguredException,
} from './interfaces/ai-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';

export interface AiProviderConfig {
  /** Lowercase provider id: 'anthropic' | 'openai' | 'openrouter'. */
  provider: string;
  apiKey?: string;
  model: string;
}

/**
 * Plain function, not NestJS-DI-bound, so it can be called both from `AiService`
 * (NestJS side) and from Temporal activities (worker-process side, no DI) once
 * those are wired up to real AI calls.
 */
export function getAiProvider(config: AiProviderConfig): AiProvider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.apiKey) {
        throw new AiNotConfiguredException();
      }
      return new AnthropicProvider({
        apiKey: config.apiKey,
        defaultModel: config.model,
      });
    case 'openai':
      if (!config.apiKey) {
        throw new AiNotConfiguredException();
      }
      return new OpenAiCompatibleProvider({
        name: 'openai',
        apiKey: config.apiKey,
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: config.model,
      });
    case 'openrouter':
      if (!config.apiKey) {
        throw new AiNotConfiguredException();
      }
      return new OpenAiCompatibleProvider({
        name: 'openrouter',
        apiKey: config.apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: config.model,
      });
    default:
      throw new BadRequestException(
        `Unsupported AI provider: ${config.provider}`,
      );
  }
}
