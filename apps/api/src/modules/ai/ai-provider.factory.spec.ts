import { BadRequestException } from '@nestjs/common';
import { getAiProvider } from './ai-provider.factory';
import { AiNotConfiguredException } from './interfaces/ai-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';

describe('getAiProvider', () => {
  it('builds an AnthropicProvider for provider: anthropic', () => {
    const provider = getAiProvider({
      provider: 'anthropic',
      apiKey: 'key',
      model: 'claude-sonnet-5',
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('builds an OpenAiCompatibleProvider pointed at api.openai.com for provider: openai', () => {
    const provider = getAiProvider({
      provider: 'openai',
      apiKey: 'key',
      model: 'gpt-4o',
    });
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.name).toBe('openai');
  });

  it('builds an OpenAiCompatibleProvider pointed at openrouter.ai for provider: openrouter', () => {
    const provider = getAiProvider({
      provider: 'openrouter',
      apiKey: 'key',
      model: 'meta-llama/llama-3.1-70b-instruct',
    });
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.name).toBe('openrouter');
  });

  it.each(['anthropic', 'openai', 'openrouter'])(
    'throws AiNotConfiguredException for %s when apiKey is missing',
    (provider) => {
      expect(() => getAiProvider({ provider, model: 'x' })).toThrow(
        AiNotConfiguredException,
      );
    },
  );

  it('throws BadRequestException for an unsupported provider', () => {
    expect(() =>
      getAiProvider({ provider: 'unsupported', apiKey: 'x', model: 'x' }),
    ).toThrow(BadRequestException);
  });
});
