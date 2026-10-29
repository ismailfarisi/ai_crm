import { AiService, estimatePdfPages } from './ai.service';
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
  overrides: {
    aiConfigService?: any;
    usageLogRepo?: any;
    budgetRepo?: any;
    redisBudgetGuard?: any;
  } = {},
) {
  const savedLogs: any[] = [];

  const aiConfigService =
    overrides.aiConfigService ||
    ({
      resolveProviderConfig: jest.fn().mockResolvedValue({
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-sonnet-5',
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

  const redisBudgetGuard =
    overrides.redisBudgetGuard === null
      ? undefined
      : overrides.redisBudgetGuard ||
        ({
          checkAndReserve: jest.fn(
            async (
              _organizationId: string,
              estimatedCostUsd: number,
              cap: number,
              initialSpendUsd: number,
            ) => ({
              allowed: initialSpendUsd + estimatedCostUsd <= cap,
              reservedAmount:
                initialSpendUsd + estimatedCostUsd <= cap
                  ? estimatedCostUsd
                  : 0,
              currentSpendUsd: initialSpendUsd + estimatedCostUsd,
              periodKey: 'ai:budget:test',
            }),
          ),
          reconcile: jest.fn().mockResolvedValue(undefined),
        } as any);

  const service = new AiService(
    aiConfigService,
    usageLogRepo,
    budgetRepo,
    redisBudgetGuard,
  );
  return {
    service,
    aiConfigService,
    usageLogRepo,
    budgetRepo,
    redisBudgetGuard,
    savedLogs,
  };
}

describe('AiService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('returns true when the org has a resolvable provider config', async () => {
      const { service } = makeService();
      await expect(service.isConfigured(orgId)).resolves.toBe(true);
    });

    it('returns false when the org has no resolvable provider config', async () => {
      const { service } = makeService({
        aiConfigService: {
          resolveProviderConfig: jest
            .fn()
            .mockRejectedValue(new AiNotConfiguredException()),
        },
      });
      await expect(service.isConfigured(orgId)).resolves.toBe(false);
    });

    it('rethrows an unrelated error instead of swallowing it as unconfigured', async () => {
      const { service } = makeService({
        aiConfigService: {
          resolveProviderConfig: jest
            .fn()
            .mockRejectedValue(new Error('DB unavailable')),
        },
      });
      await expect(service.isConfigured(orgId)).rejects.toThrow(
        'DB unavailable',
      );
    });
  });

  describe('generateText', () => {
    it('throws AiNotConfiguredException when the org has no enabled provider, without logging usage', async () => {
      const { service, savedLogs } = makeService({
        aiConfigService: {
          resolveProviderConfig: jest
            .fn()
            .mockRejectedValue(new AiNotConfiguredException()),
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

    it('forwards an explicit options.provider to resolveProviderConfig, overriding the org default', async () => {
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        defaultMaxTokens: 4096,
        generateWithTools: jest.fn(),
        name: 'openai',
        generateText: jest.fn().mockResolvedValue({
          text: 'hi',
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'gpt-4o',
          stopReason: 'stop',
        }),
        generateStructured: jest.fn(),
      });
      const { service, aiConfigService } = makeService();

      await service.generateText(
        'test.feature',
        {
          provider: 'OPENAI' as any,
          messages: [{ role: 'user', content: 'hi' }],
        },
        { organizationId: orgId, userId },
      );

      expect(aiConfigService.resolveProviderConfig).toHaveBeenCalledWith(
        orgId,
        'OPENAI',
      );
    });

    it('writes a usage log on success', async () => {
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        defaultMaxTokens: 4096,
        generateWithTools: jest.fn(),
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
        defaultMaxTokens: 4096,
        generateWithTools: jest.fn(),
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
        defaultMaxTokens: 4096,
        generateWithTools: jest.fn(),
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

  describe('generateWithTools', () => {
    it('logs cache tokens and costs cache reads below the input rate', async () => {
      const generateWithTools = jest.fn().mockResolvedValue({
        text: '',
        toolCalls: [{ id: 'toolu_1', name: 'quote.create', input: {} }],
        raw: { provider: 'anthropic', content: [] },
        usage: {
          inputTokens: 1_000,
          outputTokens: 1_000,
          cacheReadInputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000,
        },
        model: 'claude-opus-5-5',
        stopReason: 'tool_use',
      });
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        name: 'anthropic',
        defaultMaxTokens: 16_000,
        generateText: jest.fn(),
        generateStructured: jest.fn(),
        generateWithTools,
      });

      const { service, savedLogs } = makeService();
      const options = {
        tools: [{ name: 'quote.create', description: 'd', inputSchema: {} }],
        messages: [{ role: 'user' as const, content: 'hi' }],
        cache: true,
      };
      const result = await service.generateWithTools('test.tools', options, {
        organizationId: orgId,
        userId,
      });

      expect(generateWithTools).toHaveBeenCalledWith(options);
      expect(result.toolCalls).toHaveLength(1);
      expect(savedLogs[0]).toEqual(
        expect.objectContaining({
          feature: 'test.tools',
          cacheReadInputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000,
        }),
      );
      // 1k input at $4 + 1M cache reads at $0.20 + 1M cache writes at
      // 1.25 x $4 + 1k output at $20, per million tokens.
      expect(savedLogs[0].estimatedCostUsd).toBeCloseTo(0.004 + 0.2 + 5 + 0.02, 6);
    });
  });

  describe('budget enforcement (via generateText)', () => {
    function stubProvider() {
      jest.spyOn(factory, 'getAiProvider').mockReturnValue({
        defaultMaxTokens: 4096,
        generateWithTools: jest.fn(),
        name: 'anthropic',
        generateText: jest.fn().mockResolvedValue({
          text: 'ok',
          usage: { inputTokens: 10, outputTokens: 5 },
          model: 'claude-sonnet-5',
          stopReason: 'end_turn',
        }),
        generateStructured: jest.fn().mockResolvedValue({
          data: { ok: true },
          usage: { inputTokens: 10, outputTokens: 5 },
          model: 'claude-sonnet-5',
        }),
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

    it('fails closed when the spend-sum query itself errors', async () => {
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
      ).rejects.toThrow('DB hiccup');
    });

    it('fails closed when Redis is unavailable for an enabled budget', async () => {
      stubProvider();
      const { service } = makeService({ redisBudgetGuard: null });
      service['budgetRepo'].findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 10,
        isEnabled: true,
      });
      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          { organizationId: orgId, userId },
        ),
      ).rejects.toThrow('AI budget enforcement is unavailable');
    });

    it('reserves against system/schema text, images, and provider default output tokens', async () => {
      stubProvider();
      const { service, budgetRepo, redisBudgetGuard } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 10,
        isEnabled: true,
      });

      await service.generateStructured(
        'test.feature',
        {
          system: 's'.repeat(400),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'u'.repeat(400) },
                { type: 'image', mimeType: 'image/png', url: 'https://example.test/image.png' },
              ],
            },
          ],
          jsonSchema: { type: 'object', description: 'd'.repeat(400) },
          schemaName: 'test_result',
        },
        { organizationId: orgId, userId },
      );

      expect(redisBudgetGuard.checkAndReserve).toHaveBeenCalledWith(
        orgId,
        expect.any(Number),
        10,
        0,
      );
      // The configured claude-sonnet-5's 4096 output tokens alone come to
      // $0.041; anything above that is the text, schema and image input.
      const reservedEstimate =
        redisBudgetGuard.checkAndReserve.mock.calls[0][1];
      expect(reservedEstimate).toBeGreaterThan(0.045);
    });

    it("reserves at the configured model's rate when the call names no model", async () => {
      stubProvider();
      const { service, budgetRepo, redisBudgetGuard, aiConfigService } = makeService();
      aiConfigService.resolveProviderConfig.mockResolvedValue({
        provider: 'anthropic',
        apiKey: 'k',
        model: 'claude-haiku-5-5',
      });
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 10,
        isEnabled: true,
      });

      await service.generateText(
        'test.feature',
        { messages: [{ role: 'user', content: 'hi' }] },
        { organizationId: orgId, userId },
      );

      // 4096 output tokens at Haiku's $0.50/M, not the $15/M fallback.
      const reservedEstimate = redisBudgetGuard.checkAndReserve.mock.calls[0][1];
      expect(reservedEstimate).toBeLessThan(0.003);
      expect(reservedEstimate).toBeGreaterThan(0.002);
    });

    it('logs provider-reported usage when budget reconciliation fails', async () => {
      stubProvider();
      const { service, budgetRepo, redisBudgetGuard, savedLogs } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 10,
        isEnabled: true,
      });
      redisBudgetGuard.reconcile.mockRejectedValue(
        new Error('Redis reconciliation unavailable'),
      );

      await expect(
        service.generateText(
          'test.feature',
          { messages: [{ role: 'user', content: 'hi' }] },
          { organizationId: orgId, userId },
        ),
      ).rejects.toThrow('Redis reconciliation unavailable');

      expect(savedLogs).toEqual([
        expect.objectContaining({
          inputTokens: 10,
          outputTokens: 5,
          model: 'claude-sonnet-5',
          success: false,
        }),
      ]);
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

    it('reports automationAiEmailToCustomers false when no row exists', async () => {
      const { service, budgetRepo, usageLogRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue(null);
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQueryBuilderMock('0'));

      const status = await service.getBudgetStatus(orgId);
      expect(status.automationAiEmailToCustomers).toBe(false);
    });

    it('reports the stored automationAiEmailToCustomers flag', async () => {
      const { service, budgetRepo, usageLogRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: orgId,
        monthlyBudgetUsd: 100,
        alertThresholdPercent: 80,
        isEnabled: true,
        automationAiEmailToCustomers: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      usageLogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQueryBuilderMock('0'));

      const status = await service.getBudgetStatus(orgId);
      expect(status.automationAiEmailToCustomers).toBe(true);
      expect(status.budget?.automationAiEmailToCustomers).toBe(true);
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
          automationAiEmailToCustomers: false,
        }),
      );
      expect(result.monthlyBudgetUsd).toBe(50);
    });

    it('persists automationAiEmailToCustomers on create and update, and leaves it alone when omitted', async () => {
      const { service, budgetRepo } = makeService();
      budgetRepo.findOne = jest.fn().mockResolvedValue(null);
      await service.upsertBudget(orgId, {
        monthlyBudgetUsd: 50,
        automationAiEmailToCustomers: true,
      });
      expect(budgetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ automationAiEmailToCustomers: true }),
      );

      const existing = {
        organizationId: orgId,
        monthlyBudgetUsd: 50,
        alertThresholdPercent: 80,
        isEnabled: true,
        automationAiEmailToCustomers: true,
      };
      budgetRepo.findOne = jest.fn().mockResolvedValue(existing);
      const kept = await service.upsertBudget(orgId, { monthlyBudgetUsd: 60 });
      expect(kept.automationAiEmailToCustomers).toBe(true);
      const off = await service.upsertBudget(orgId, {
        monthlyBudgetUsd: 60,
        automationAiEmailToCustomers: false,
      });
      expect(off.automationAiEmailToCustomers).toBe(false);
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

describe('estimatePdfPages', () => {
  const b64 = (s: string) => Buffer.from(s, 'latin1').toString('base64');

  it('counts page objects and not the page tree', () => {
    const pdf =
      '%PDF-1.7\n1 0 obj << /Type /Pages /Count 2 >>\n' +
      '2 0 obj << /Type /Page >>\n3 0 obj << /Type/Page >>\n';
    expect(estimatePdfPages(b64(pdf))).toBe(2);
  });

  it('counts an unreadable file as one page', () => {
    expect(estimatePdfPages(b64('not a pdf'))).toBe(1);
  });
});
