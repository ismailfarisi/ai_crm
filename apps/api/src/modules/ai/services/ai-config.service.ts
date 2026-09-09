import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { ChannelCryptoService } from '../../channels/services/channel-crypto.service';
import {
  AiConfig,
  AiConfigStatus,
  AiProviderType,
} from '../entities/ai-config.entity';
import type { AiProviderConfig } from '../ai-provider.factory';
import { AiNotConfiguredException } from '../interfaces/ai-provider.interface';

interface AiCredentials {
  apiKey: string;
  model: string;
}

export interface AiConfigDto {
  id: string | null;
  organizationId: string;
  provider: AiProviderType;
  isEnabled: boolean;
  isDefault: boolean;
  status: AiConfigStatus;
  credentials: Record<string, any> | null;
  lastTestedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable()
export class AiConfigService {
  constructor(
    @InjectRepository(AiConfig)
    private readonly configRepo: Repository<AiConfig>,
    private readonly cryptoService: ChannelCryptoService,
    private readonly dataSource: DataSource,
  ) {}

  private maskCredentials(
    credentials: Record<string, any>,
  ): Record<string, any> {
    const masked: Record<string, any> = {};
    for (const [key, value] of Object.entries(credentials)) {
      if (key.toLowerCase().includes('apikey') && typeof value === 'string') {
        masked[key] =
          value.length > 8
            ? `${value.slice(0, 4)}••••${value.slice(-4)}`
            : '••••••••';
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  private toDto(
    config: AiConfig,
    decryptedCredentials?: Record<string, any> | null,
  ): AiConfigDto {
    return {
      id: config.id,
      organizationId: config.organizationId,
      provider: config.provider,
      isEnabled: config.isEnabled,
      isDefault: config.isDefault,
      status: config.status,
      credentials: decryptedCredentials
        ? this.maskCredentials(decryptedCredentials)
        : null,
      lastTestedAt: config.lastTestedAt
        ? config.lastTestedAt.toISOString()
        : null,
      createdAt: config.createdAt?.toISOString(),
      updatedAt: config.updatedAt?.toISOString(),
    };
  }

  async getConfigs(orgId: string): Promise<AiConfigDto[]> {
    const existing = await this.configRepo.find({
      where: { organizationId: orgId },
    });
    const map = new Map(existing.map((c) => [c.provider, c]));

    return Object.values(AiProviderType).map((provider) => {
      const config = map.get(provider);
      if (!config) {
        return {
          id: null,
          organizationId: orgId,
          provider,
          isEnabled: false,
          isDefault: false,
          status: AiConfigStatus.UNCONFIGURED,
          credentials: null,
          lastTestedAt: null,
        };
      }

      let decrypted: Record<string, any> | null = null;
      if (config.encryptedCredentials) {
        try {
          decrypted = this.cryptoService.decrypt(config.encryptedCredentials);
        } catch {
          decrypted = {};
        }
      }
      return this.toDto(config, decrypted);
    });
  }

  async saveConfig(
    orgId: string,
    provider: AiProviderType,
    isEnabled: boolean,
    credentials?: Partial<AiCredentials>,
  ): Promise<AiConfigDto> {
    let config = await this.configRepo.findOne({
      where: { organizationId: orgId, provider },
    });

    let encryptedCredentials = config?.encryptedCredentials || null;

    if (credentials && Object.keys(credentials).length > 0) {
      const finalCreds: Record<string, any> = {
        apiKey: credentials.apiKey,
        model: credentials.model,
      };
      if (config?.encryptedCredentials) {
        try {
          const existing = this.cryptoService.decrypt<Record<string, any>>(
            config.encryptedCredentials,
          );
          for (const [key, value] of Object.entries(finalCreds)) {
            if (
              typeof value === 'string' &&
              value.includes('••••') &&
              existing[key]
            ) {
              finalCreds[key] = existing[key];
            }
          }
        } catch {
          // Ignore decryption error — will simply persist whatever was submitted.
        }
      }
      encryptedCredentials = this.cryptoService.encrypt(finalCreds);
    }

    if (config) {
      config.isEnabled = isEnabled;
      if (encryptedCredentials) {
        config.encryptedCredentials = encryptedCredentials;
      }
      if (
        config.status === AiConfigStatus.UNCONFIGURED &&
        encryptedCredentials
      ) {
        config.status = AiConfigStatus.CONFIGURED;
      }
      // A disabled provider can't remain the org's default.
      if (!isEnabled && config.isDefault) {
        config.isDefault = false;
      }
    } else {
      config = this.configRepo.create({
        organizationId: orgId,
        provider,
        isEnabled,
        encryptedCredentials,
        status: encryptedCredentials
          ? AiConfigStatus.CONFIGURED
          : AiConfigStatus.UNCONFIGURED,
        isDefault: false,
      });
    }

    let saved = await this.configRepo.save(config);

    // UX nicety: if this is now the org's only enabled provider, make it the
    // default automatically instead of waiting for an explicit "set default"
    // click (resolveProviderConfig would treat it as implicit default anyway).
    if (isEnabled && !saved.isDefault) {
      const otherEnabledCount = await this.configRepo.count({
        where: { organizationId: orgId, isEnabled: true, id: Not(saved.id) },
      });
      if (otherEnabledCount === 0) {
        saved.isDefault = true;
        saved = await this.configRepo.save(saved);
      }
    }

    return this.toDto(saved);
  }

  async setDefault(
    orgId: string,
    provider: AiProviderType,
  ): Promise<AiConfigDto> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AiConfig);
      const target = await repo.findOne({
        where: { organizationId: orgId, provider },
      });
      if (!target || !target.isEnabled) {
        throw new BadRequestException(
          'Provider must be enabled before it can be set as default',
        );
      }

      await repo
        .createQueryBuilder()
        .update(AiConfig)
        .set({ isDefault: false })
        .where('"organizationId" = :orgId AND "isDefault" = true', { orgId })
        .execute();

      target.isDefault = true;
      const saved = await repo.save(target);
      return this.toDto(saved);
    });
  }

  /** Runtime resolution used by AiService — never returns masked credentials. */
  async resolveProviderConfig(
    orgId: string,
    explicitProvider?: AiProviderType,
  ): Promise<AiProviderConfig> {
    if (explicitProvider) {
      const config = await this.configRepo.findOne({
        where: {
          organizationId: orgId,
          provider: explicitProvider,
          isEnabled: true,
        },
      });
      if (!config?.encryptedCredentials) {
        throw new AiNotConfiguredException(
          `AI provider ${explicitProvider} is not configured for this organization`,
        );
      }
      return this.toProviderConfig(config);
    }

    const defaultConfig = await this.configRepo.findOne({
      where: { organizationId: orgId, isDefault: true, isEnabled: true },
    });
    if (defaultConfig?.encryptedCredentials) {
      return this.toProviderConfig(defaultConfig);
    }

    const enabled = await this.configRepo.find({
      where: { organizationId: orgId, isEnabled: true },
    });
    if (enabled.length === 1 && enabled[0].encryptedCredentials) {
      return this.toProviderConfig(enabled[0]);
    }

    throw new AiNotConfiguredException();
  }

  private toProviderConfig(config: AiConfig): AiProviderConfig {
    const creds = this.cryptoService.decrypt<AiCredentials>(
      config.encryptedCredentials as string,
    );
    return {
      provider: config.provider.toLowerCase(),
      apiKey: creds.apiKey,
      model: creds.model,
    };
  }

  async testConnection(
    orgId: string,
    provider: AiProviderType,
  ): Promise<{ success: boolean; message: string; status: AiConfigStatus }> {
    const config = await this.configRepo.findOne({
      where: { organizationId: orgId, provider },
    });
    if (!config || !config.encryptedCredentials) {
      throw new NotFoundException(
        `AI configuration for provider ${provider} not found`,
      );
    }

    const { apiKey } = this.cryptoService.decrypt<AiCredentials>(
      config.encryptedCredentials,
    );

    let result: { success: boolean; message: string };
    switch (provider) {
      case AiProviderType.OPENAI:
        result = await this.testOpenAi(apiKey);
        break;
      case AiProviderType.ANTHROPIC:
        result = await this.testAnthropic(apiKey);
        break;
      case AiProviderType.OPENROUTER:
        result = await this.testOpenRouter(apiKey);
        break;
    }

    config.lastTestedAt = new Date();
    config.status = result.success
      ? AiConfigStatus.CONFIGURED
      : AiConfigStatus.ERROR;
    await this.configRepo.save(config);

    return {
      success: result.success,
      message: result.message,
      status: config.status,
    };
  }

  private async testOpenAi(
    apiKey: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        return {
          success: false,
          message: `OpenAI rejected the key (${response.status})`,
        };
      }
      return { success: true, message: 'Connected to OpenAI successfully' };
    } catch (err) {
      return { success: false, message: this.errorMessage(err) };
    }
  }

  private async testAnthropic(
    apiKey: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = new Anthropic({ apiKey });
      await client.models.list();
      return { success: true, message: 'Connected to Anthropic successfully' };
    } catch (err) {
      return { success: false, message: this.errorMessage(err) };
    }
  }

  private async testOpenRouter(
    apiKey: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        return {
          success: false,
          message: `OpenRouter rejected the key (${response.status})`,
        };
      }
      return { success: true, message: 'Connected to OpenRouter successfully' };
    } catch (err) {
      return { success: false, message: this.errorMessage(err) };
    }
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
