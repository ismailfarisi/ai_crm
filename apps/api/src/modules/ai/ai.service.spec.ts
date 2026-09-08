import { BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import {
  AiNotConfiguredException,
  AiProviderError,
} from './interfaces/ai-provider.interface';
import { AiBudgetExceededException } from './exceptions/ai-budget-exceeded.exception';
import * as factory from './ai-provider.factory';

const orgId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';

/** Chainable mock matching `Repository.createQueryBuilder(...)`'s fluent API. */
function makeQueryBuilderMock(sum: string | undefined) {
  return {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest
      .fn()
      .mockResolvedValue(sum === undefined ? undefined : { sum }),
  } as any;
}

function makeService(
  overrides: { configService?: any; usageLogRepo?: any; budgetRepo?: any } = {},
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
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilderMock('0')),
    } as any);

  const budgetRepo =
    overrides.budgetRepo ||
    ({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (b) => b),
    } as any);

  const service = new AiService(configService, usageLogRepo, budgetRepo);
  return { service, configService, usageLogRepo, budgetRepo, savedLogs };
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

  describe('budget enforcement (via generateText)', () => {
    function stubProvider() {
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        name: 'anthropic',
        generateText: jest.fn().mockResolvedValue({
          text: 'ok',
          usage: { inputTokens: 10, outputTokens: 5 },
          model: 'claude-sonnet-5',
          stopReason: 'end_turn',
        }),
        generateStructured: jest.fn(),
      });
    }

    it('allows the call through when no budget row exists for the org', async () => {
      stubProvider();
      const { service, budgetRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          { organizationId: orgId, userId },
        ),
      ).resolves.toBeDefined();
    });

    it('allows the call through when the budget is disabled, even over cap', async () => {
      stubProvider();
      const { service, budgetRepo, usageLogRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 1,
        alertThresholdPercent: 80,
        isEnabled: false,
      });
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQueryBuilderMock('999'));

      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          { organizationId: orgId, userId },
        ),
      ).resolves.toBeDefined();
    });

    it('blocks the call and logs a failed usage row when current spend is at or over the cap', async () => {
      stubProvider();
      const { service, budgetRepo, usageLogRepo, savedLogs } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 10,
        alertThresholdPercent: 80,
        isEnabled: true,
      });
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQueryBuilderMock('10.5'));

      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          { organizationId: orgId, userId },
        ),
      ).rejects.toBeInstanceOf(AiBudgetExceededException);

      expect(savedLogs).toHaveLength(1);
      expect(savedLogs[0].success).toBe(false);
      expect(savedLogs[0].errorMessage).toContain('Monthly AI budget');
    });

    it('fails open (allows the call) when the spend-sum query itself errors', async () => {
      stubProvider();
      const { service, budgetRepo, usageLogRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 10,
        alertThresholdPercent: 80,
        isEnabled: true,
      });
      const failingBuilder = makeQueryBuilderMock('0');
      failingBuilder.getRawOne = jest
        .fn()
        .mockRejectedValue(new Error('DB hiccup'));
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(failingBuilder);

      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          { organizationId: orgId, userId },
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('getBudgetStatus', () => {
    it('returns budget: null and no near-limit/over-budget flags when no row exists', async () => {
      const { service, budgetRepo, usageLogRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue(null);
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQueryBuilderMock('42'));

      const status = await service.getBudgetStatus(orgId);
      expect(status.budget).toBeNull();
      expect(status.currentSpendUsd).toBe(42);
      expect(status.percentage).toBeNull();
      expect(status.isNearLimit).toBe(false);
      expect(status.isOverBudget).toBe(false);
    });

    it('reports isNearLimit once spend crosses the alert threshold but stays under cap', async () => {
      const { service, budgetRepo, usageLogRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 100,
        alertThresholdPercent: 80,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQueryBuilderMock('85'));

      const status = await service.getBudgetStatus(orgId);
      expect(status.percentage).toBe(85);
      expect(status.isNearLimit).toBe(true);
      expect(status.isOverBudget).toBe(false);
    });

    it('reports isOverBudget once spend reaches the cap', async () => {
      const { service, budgetRepo, usageLogRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 100,
        alertThresholdPercent: 80,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQueryBuilderMock('100'));

      const status = await service.getBudgetStatus(orgId);
      expect(status.isOverBudget).toBe(true);
      expect(status.isNearLimit).toBe(false);
    });
  });

  describe('upsertBudget', () => {
    it('creates a new budget row with defaults when none exists', async () => {
      const { service, budgetRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue(null);

      const result = await service.upsertBudget(orgId, {
        monthlyBudgetUsd: 50,
      });

      expect(budgetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          monthlyBudgetUsd: 50,
          alertThresholdPercent: 80,
          isEnabled: true,
        }),
      );
      expect(result.monthlyBudgetUsd).toBe(50);
    });

    it('updates fields on the existing row, preserving organizationId', async () => {
      const existing = {
        organizationId: orgId,
        monthlyBudgetUsd: 50,
        alertThresholdPercent: 80,
        isEnabled: true,
      };
      const { service, budgetRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue(existing);

      const result = await service.upsertBudget(orgId, {
        monthlyBudgetUsd: 200,
        alertThresholdPercent: 90,
        isEnabled: false,
      });

      expect(result.organizationId).toBe(orgId);
      expect(result.monthlyBudgetUsd).toBe(200);
      expect(result.alertThresholdPercent).toBe(90);
      expect(result.isEnabled).toBe(false);
    });
  });
});
