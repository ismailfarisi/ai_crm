import { BadRequestException, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AiConfigService } from './ai-config.service';
import { AiConfigStatus, AiProviderType } from '../entities/ai-config.entity';
import { AiNotConfiguredException } from '../interfaces/ai-provider.interface';

jest.mock('@anthropic-ai/sdk', () => {
  const listMock = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      models: { list: listMock },
    })),
    __listMock: listMock,
  };
});

const orgId = '11111111-1111-1111-1111-111111111111';

/** Real AES-256-GCM crypto, matching production behavior, not a stub — the
 * masked-credential merge logic depends on real encrypt/decrypt round-tripping. */
function makeCryptoService() {
  const { ChannelCryptoService } = jest.requireActual(
    '../../channels/services/channel-crypto.service',
  );
  return new ChannelCryptoService('test-secret-at-least-32-characters!!');
}

function makeService(configs: any[] = []) {
  const cryptoService = makeCryptoService();
  let idCounter = 0;

  const configRepo = {
    findOne: jest.fn().mockImplementation(async ({ where }: any) => {
      return (
        configs.find(
          (c) =>
            c.organizationId === where.organizationId &&
            (where.provider === undefined || c.provider === where.provider) &&
            (where.isEnabled === undefined ||
              c.isEnabled === where.isEnabled) &&
            (where.isDefault === undefined || c.isDefault === where.isDefault),
        ) ?? null
      );
    }),
    find: jest.fn().mockImplementation(async ({ where }: any) => {
      return configs.filter(
        (c) =>
          c.organizationId === where.organizationId &&
          (where.isEnabled === undefined || c.isEnabled === where.isEnabled),
      );
    }),
    count: jest.fn().mockImplementation(async ({ where }: any) => {
      return configs.filter(
        (c) =>
          c.organizationId === where.organizationId &&
          (where.isEnabled === undefined || c.isEnabled === where.isEnabled) &&
          (!where.id || c.id !== where.id.value),
      ).length;
    }),
    create: jest
      .fn()
      .mockImplementation((dto) => ({ id: `cfg-${++idCounter}`, ...dto })),
    save: jest.fn().mockImplementation(async (config) => {
      const idx = configs.findIndex((c) => c.id === config.id);
      if (idx >= 0) {
        configs[idx] = { ...configs[idx], ...config };
        return configs[idx];
      }
      configs.push(config);
      return config;
    }),
    createQueryBuilder: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation((_sql: string, params: any) => {
        for (const c of configs) {
          if (c.organizationId === params.orgId && c.isDefault) {
            c.isDefault = false;
          }
        }
        return { execute: jest.fn().mockResolvedValue(undefined) };
      }),
    }),
  };

  const dataSource = {
    transaction: jest.fn().mockImplementation(async (cb) => {
      return cb({ getRepository: () => configRepo });
    }),
  };

  const service = new AiConfigService(
    configRepo as any,
    cryptoService,
    dataSource as any,
  );
  return { service, configRepo, cryptoService, configs };
}

function encryptedRow(
  cryptoService: any,
  overrides: Partial<{
    provider: AiProviderType;
    isEnabled: boolean;
    isDefault: boolean;
    apiKey: string;
    model: string;
  }> = {},
) {
  return {
    id: `cfg-${overrides.provider ?? 'x'}`,
    organizationId: orgId,
    provider: overrides.provider ?? AiProviderType.OPENAI,
    isEnabled: overrides.isEnabled ?? true,
    isDefault: overrides.isDefault ?? false,
    status: AiConfigStatus.CONFIGURED,
    lastTestedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    encryptedCredentials: cryptoService.encrypt({
      apiKey: overrides.apiKey ?? 'sk-test-key-12345',
      model: overrides.model ?? 'gpt-4o',
    }),
  };
}

describe('AiConfigService', () => {
  describe('getConfigs', () => {
    it('returns one unconfigured placeholder per provider when the org has none', async () => {
      const { service } = makeService([]);
      const configs = await service.getConfigs(orgId);
      expect(configs).toHaveLength(3);
      expect(
        configs.every((c) => c.status === AiConfigStatus.UNCONFIGURED),
      ).toBe(true);
    });

    it('masks apiKey but leaves model plain', async () => {
      const { cryptoService } = makeService();
      const row = encryptedRow(cryptoService, {
        apiKey: 'sk-1234567890abcdef',
      });
      const { service: s2 } = makeService([row]);
      const configs = await s2.getConfigs(orgId);
      const openai = configs.find((c) => c.provider === AiProviderType.OPENAI)!;
      expect(openai.credentials?.apiKey).toBe('sk-1••••cdef');
      expect(openai.credentials?.model).toBe('gpt-4o');
    });
  });

  describe('saveConfig', () => {
    it("creates a new config, auto-marking it default as the org's only enabled provider", async () => {
      const { service } = makeService([]);
      const result = await service.saveConfig(
        orgId,
        AiProviderType.OPENAI,
        true,
        {
          apiKey: 'sk-abc',
          model: 'gpt-4o',
        },
      );
      expect(result.status).toBe(AiConfigStatus.CONFIGURED);
      expect(result.isDefault).toBe(true);
    });

    it('does not auto-disable another already-enabled provider (no mutual exclusivity)', async () => {
      const { service, cryptoService, configs } = makeService();
      configs.push(
        encryptedRow(cryptoService, {
          provider: AiProviderType.ANTHROPIC,
          isDefault: true,
        }),
      );

      await service.saveConfig(orgId, AiProviderType.OPENAI, true, {
        apiKey: 'sk-new',
        model: 'gpt-4o',
      });

      const anthropic = configs.find(
        (c) => c.provider === AiProviderType.ANTHROPIC,
      );
      expect(anthropic.isEnabled).toBe(true);
      expect(anthropic.isDefault).toBe(true);
    });

    it('recovers the real apiKey when the incoming value is still masked', async () => {
      const { service, cryptoService, configs } = makeService();
      const row = encryptedRow(cryptoService, {
        apiKey: 'sk-original-key',
        model: 'gpt-4o',
      });
      configs.push(row);

      await service.saveConfig(orgId, AiProviderType.OPENAI, true, {
        apiKey: 'sk-o••••-key',
        model: 'gpt-4o-mini',
      });

      const decrypted = cryptoService.decrypt(
        configs.find((c) => c.provider === AiProviderType.OPENAI)
          .encryptedCredentials,
      );
      expect(decrypted.apiKey).toBe('sk-original-key');
      expect(decrypted.model).toBe('gpt-4o-mini');
    });

    it('clears isDefault when the config is disabled', async () => {
      const { service, cryptoService, configs } = makeService();
      configs.push(encryptedRow(cryptoService, { isDefault: true }));

      const result = await service.saveConfig(
        orgId,
        AiProviderType.OPENAI,
        false,
      );
      expect(result.isDefault).toBe(false);
    });
  });

  describe('setDefault', () => {
    it('throws BadRequestException if the target is not enabled', async () => {
      const { service, cryptoService, configs } = makeService();
      configs.push(encryptedRow(cryptoService, { isEnabled: false }));
      await expect(
        service.setDefault(orgId, AiProviderType.OPENAI),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('unsets the previous default and sets the new one', async () => {
      const { service, cryptoService, configs } = makeService();
      configs.push(
        encryptedRow(cryptoService, {
          provider: AiProviderType.OPENAI,
          isDefault: true,
        }),
      );
      configs.push(
        encryptedRow(cryptoService, {
          provider: AiProviderType.ANTHROPIC,
          isDefault: false,
        }),
      );

      await service.setDefault(orgId, AiProviderType.ANTHROPIC);

      expect(
        configs.find((c) => c.provider === AiProviderType.OPENAI).isDefault,
      ).toBe(false);
      expect(
        configs.find((c) => c.provider === AiProviderType.ANTHROPIC).isDefault,
      ).toBe(true);
    });
  });

  describe('resolveProviderConfig', () => {
    it('throws AiNotConfiguredException when nothing is enabled', async () => {
      const { service } = makeService([]);
      await expect(service.resolveProviderConfig(orgId)).rejects.toBeInstanceOf(
        AiNotConfiguredException,
      );
    });

    it('returns the sole enabled config as implicit default', async () => {
      const { cryptoService } = makeService();
      const row = encryptedRow(cryptoService, {
        provider: AiProviderType.OPENAI,
      });
      const { service: s2 } = makeService([row]);
      const config = await s2.resolveProviderConfig(orgId);
      expect(config.provider).toBe('openai');
    });

    it('returns the marked default when multiple are enabled', async () => {
      const { cryptoService } = makeService();
      const rows = [
        encryptedRow(cryptoService, {
          provider: AiProviderType.OPENAI,
          isDefault: false,
        }),
        encryptedRow(cryptoService, {
          provider: AiProviderType.ANTHROPIC,
          isDefault: true,
        }),
      ];
      const { service } = makeService(rows);
      const config = await service.resolveProviderConfig(orgId);
      expect(config.provider).toBe('anthropic');
    });

    it('returns the explicitly requested provider regardless of default', async () => {
      const { cryptoService } = makeService();
      const rows = [
        encryptedRow(cryptoService, {
          provider: AiProviderType.OPENAI,
          isDefault: true,
        }),
        encryptedRow(cryptoService, {
          provider: AiProviderType.ANTHROPIC,
          isDefault: false,
        }),
      ];
      const { service } = makeService(rows);
      const config = await service.resolveProviderConfig(
        orgId,
        AiProviderType.ANTHROPIC,
      );
      expect(config.provider).toBe('anthropic');
    });

    it('throws when the explicitly requested provider is not enabled/configured', async () => {
      const { service } = makeService([]);
      await expect(
        service.resolveProviderConfig(orgId, AiProviderType.OPENAI),
      ).rejects.toBeInstanceOf(AiNotConfiguredException);
    });

    it('throws (ambiguous) when 2+ are enabled and none is default', async () => {
      const { cryptoService } = makeService();
      const rows = [
        encryptedRow(cryptoService, {
          provider: AiProviderType.OPENAI,
          isDefault: false,
        }),
        encryptedRow(cryptoService, {
          provider: AiProviderType.ANTHROPIC,
          isDefault: false,
        }),
      ];
      const { service } = makeService(rows);
      await expect(service.resolveProviderConfig(orgId)).rejects.toBeInstanceOf(
        AiNotConfiguredException,
      );
    });
  });

  describe('testConnection', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
      jest.clearAllMocks();
    });

    it('throws NotFoundException when the provider has no stored config', async () => {
      const { service } = makeService([]);
      await expect(
        service.testConnection(orgId, AiProviderType.OPENAI),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('marks status configured on a successful OpenAI check', async () => {
      const { cryptoService } = makeService();
      const row = encryptedRow(cryptoService, {
        provider: AiProviderType.OPENAI,
      });
      const { service, configs } = makeService([row]);
      global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;

      const result = await service.testConnection(orgId, AiProviderType.OPENAI);
      expect(result.success).toBe(true);
      expect(configs[0].status).toBe(AiConfigStatus.CONFIGURED);
    });

    it('marks status error on a failed OpenRouter check', async () => {
      const { cryptoService } = makeService();
      const row = encryptedRow(cryptoService, {
        provider: AiProviderType.OPENROUTER,
      });
      const { service, configs } = makeService([row]);
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 401 }) as any;

      const result = await service.testConnection(
        orgId,
        AiProviderType.OPENROUTER,
      );
      expect(result.success).toBe(false);
      expect(configs[0].status).toBe(AiConfigStatus.ERROR);
    });

    it('uses the Anthropic SDK models.list() for the anthropic check', async () => {
      const { cryptoService } = makeService();
      const row = encryptedRow(cryptoService, {
        provider: AiProviderType.ANTHROPIC,
      });
      const { service } = makeService([row]);
      const listMock = (Anthropic as any)().models.list;
      listMock.mockResolvedValue({ data: [] });

      const result = await service.testConnection(
        orgId,
        AiProviderType.ANTHROPIC,
      );
      expect(result.success).toBe(true);
    });
  });
});
