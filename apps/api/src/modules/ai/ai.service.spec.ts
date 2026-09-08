import { BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import {
  AiNotConfiguredException,
  AiProviderError,
} from './interfaces/ai-provider.interface';
import * as factory from './ai-provider.factory';

const orgId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';

function makeService(
  overrides: { configService?: any; usageLogRepo?: any } = {},
) {
  const savedLogs: any[] = [];

  const configService =
    overrides.configService ||
    ({
      get: jest.fn().mockReturnValue({
        provider: 'anthropic',
        anthropicApiKey: 'test-key',
        anthropicModel: 'claude-sonnet-5',
      }),
    } as any);

  const usageLogRepo =
    overrides.usageLogRepo ||
    ({
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (log) => {
        savedLogs.push(log);
        return log;
      }),
    } as any);

  const service = new AiService(configService, usageLogRepo);
  return { service, configService, usageLogRepo, savedLogs };
}

describe('AiService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('returns true when an API key is set', () => {
      const { service } = makeService();
      expect(service.isConfigured()).toBe(true);
    });

    it('returns false when no API key is set', () => {
      const { service } = makeService({
        configService: {
          get: jest.fn().mockReturnValue({
            provider: 'anthropic',
            anthropicModel: 'claude-sonnet-5',
          }),
        },
      });
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('generateText', () => {
    it('throws AiNotConfiguredException when no API key is configured, without logging usage', async () => {
      const { service, savedLogs } = makeService({
        configService: {
          get: jest.fn().mockReturnValue({
            provider: 'anthropic',
            anthropicModel: 'claude-sonnet-5',
          }),
        },
      });

      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          {
            organizationId: orgId,
            userId,
          },
        ),
      ).rejects.toBeInstanceOf(AiNotConfiguredException);
      expect(savedLogs).toHaveLength(0);
    });

    it('throws BadRequestException for an unsupported provider', async () => {
      const { service } = makeService({
        configService: {
          get: jest.fn().mockReturnValue({
            provider: 'unsupported',
            anthropicApiKey: 'x',
            anthropicModel: 'claude-sonnet-5',
          }),
        },
      });

      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          {
            organizationId: orgId,
            userId,
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('writes a usage log on success', async () => {
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        name: 'anthropic',
        generateText: jest.fn().mockResolvedValue({
          text: 'hello',
          usage: { inputTokens: 100, outputTokens: 50 },
          model: 'claude-sonnet-5',
          stopReason: 'end_turn',
        }),
        generateStructured: jest.fn(),
      });

      const { service, savedLogs } = makeService();
      const result = await service.generateText(
        'test.feature',
        { messages: [{ role: 'user', content: 'hi' }] },
        { organizationId: orgId, userId },
      );

      expect(result.text).toBe('hello');
      expect(savedLogs).toHaveLength(1);
      expect(savedLogs[0]).toEqual(
        expect.objectContaining({
          organizationId: orgId,
          feature: 'test.feature',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          inputTokens: 100,
          outputTokens: 50,
          success: true,
          actorUserId: userId,
        }),
      );
      expect(savedLogs[0].estimatedCostUsd).toBeGreaterThan(0);
    });

    it('writes a failed usage log and rethrows when the provider call fails', async () => {
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        name: 'anthropic',
        generateText: jest.fn().mockRejectedValue(new AiProviderError('boom')),
        generateStructured: jest.fn(),
      });

      const { service, savedLogs } = makeService();
      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          {
            organizationId: orgId,
            userId,
          },
        ),
      ).rejects.toBeInstanceOf(AiProviderError);

      expect(savedLogs).toHaveLength(1);
      expect(savedLogs[0]).toEqual(
        expect.objectContaining({ success: false, errorMessage: 'boom' }),
      );
    });
  });

  describe('generateStructured', () => {
    it('writes a usage log on success', async () => {
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        name: 'anthropic',
        generateText: jest.fn(),
        generateStructured: jest.fn().mockResolvedValue({
          data: { foo: 'bar' },
          usage: { inputTokens: 10, outputTokens: 5 },
          model: 'claude-sonnet-5',
        }),
      });

      const { service, savedLogs } = makeService();
      const result = await service.generateStructured(
        'test.structured',
        {
          messages: [{ role: 'user', content: 'hi' }],
          jsonSchema: { type: 'object' },
          schemaName: 'test_schema',
        },
        { organizationId: orgId, userId },
      );

      expect(result.data).toEqual({ foo: 'bar' });
      expect(savedLogs).toHaveLength(1);
      expect(savedLogs[0].feature).toBe('test.structured');
    });
  });
});
