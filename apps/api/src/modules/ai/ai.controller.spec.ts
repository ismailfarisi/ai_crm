import { AiController } from './ai.controller';
import { AiProviderType } from './entities/ai-config.entity';

const orgId = '11111111-1111-1111-1111-111111111111';
const user = { id: 'u1', organizationId: orgId } as any;

function makeController() {
  const aiService = {
    getBudgetStatus: jest.fn(),
    upsertBudget: jest.fn(),
    listUsage: jest.fn(),
  } as any;
  const aiConfigService = {
    getConfigs: jest.fn().mockResolvedValue(['config']),
    saveConfig: jest.fn().mockResolvedValue('saved'),
    testConnection: jest.fn().mockResolvedValue('tested'),
    setDefault: jest.fn().mockResolvedValue('defaulted'),
  } as any;
  const controller = new AiController(aiService, aiConfigService);
  return { controller, aiService, aiConfigService };
}

describe('AiController', () => {
  it('getConfigs delegates to AiConfigService with the caller org', async () => {
    const { controller, aiConfigService } = makeController();
    await controller.getConfigs(user);
    expect(aiConfigService.getConfigs).toHaveBeenCalledWith(orgId);
  });

  it('saveConfig passes through provider/body to AiConfigService', async () => {
    const { controller, aiConfigService } = makeController();
    await controller.saveConfig(user, AiProviderType.OPENAI, {
      isEnabled: true,
      credentials: { apiKey: 'k', model: 'gpt-4o' },
    });
    expect(aiConfigService.saveConfig).toHaveBeenCalledWith(
      orgId,
      AiProviderType.OPENAI,
      true,
      { apiKey: 'k', model: 'gpt-4o' },
    );
  });

  it('testConfig delegates to AiConfigService.testConnection', async () => {
    const { controller, aiConfigService } = makeController();
    await controller.testConfig(user, AiProviderType.ANTHROPIC);
    expect(aiConfigService.testConnection).toHaveBeenCalledWith(
      orgId,
      AiProviderType.ANTHROPIC,
    );
  });

  it('setDefaultConfig delegates to AiConfigService.setDefault', async () => {
    const { controller, aiConfigService } = makeController();
    await controller.setDefaultConfig(user, AiProviderType.OPENROUTER);
    expect(aiConfigService.setDefault).toHaveBeenCalledWith(
      orgId,
      AiProviderType.OPENROUTER,
    );
  });
});
