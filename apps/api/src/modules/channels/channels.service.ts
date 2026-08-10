import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import {
  ChannelConfig,
  ChannelProviderType,
  ChannelStatus,
} from './entities/channel-config.entity';
import {
  ChannelMessage,
  MessageDirection,
  MessageStatus,
} from './entities/channel-message.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';
import { ChannelDriver } from './interfaces/channel-driver.interface';
import { MetaWhatsAppDriver } from './drivers/meta-whatsapp.driver';
import { TelegramDriver } from './drivers/telegram.driver';
import { EmailSmtpDriver } from './drivers/email-smtp.driver';
import { EmailResendDriver } from './drivers/email-resend.driver';

export interface SendMessageDto {
  contactId?: string;
  provider: ChannelProviderType;
  recipient: string;
  body: string;
  subject?: string;
}

@Injectable()
export class ChannelsService {
  constructor(
    @InjectRepository(ChannelConfig)
    private readonly configRepo: Repository<ChannelConfig>,
    @InjectRepository(ChannelMessage)
    private readonly messageRepo: Repository<ChannelMessage>,
    private readonly cryptoService: ChannelCryptoService,
  ) {}

  private getDriver(provider: ChannelProviderType): ChannelDriver {
    switch (provider) {
      case ChannelProviderType.WHATSAPP_META:
        return new MetaWhatsAppDriver();
      case ChannelProviderType.TELEGRAM:
        return new TelegramDriver();
      case ChannelProviderType.EMAIL_SMTP:
        return new EmailSmtpDriver();
      case ChannelProviderType.EMAIL_RESEND:
        return new EmailResendDriver();
      default:
        throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
  }

  private maskCredentials(credentials: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};
    const sensitiveKeys = [
      'accesstoken',
      'bottoken',
      'apikey',
      'pass',
      'password',
      'verifytoken',
      'secret',
    ];
    for (const [key, value] of Object.entries(credentials)) {
      if (
        typeof value === 'string' &&
        sensitiveKeys.some((k) => key.toLowerCase().includes(k))
      ) {
        if (value.length > 8) {
          masked[key] = `${value.slice(0, 4)}••••${value.slice(-4)}`;
        } else {
          masked[key] = '••••••••';
        }
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  async getConfigs(orgId: string): Promise<any[]> {
    const existing = await this.configRepo.find({
      where: { organizationId: orgId },
    });
    const map = new Map(existing.map((c) => [c.provider, c]));

    const providers = Object.values(ChannelProviderType);
    return providers.map((provider) => {
      const config = map.get(provider);
      if (!config) {
        return {
          id: null,
          organizationId: orgId,
          provider,
          isEnabled: false,
          status: ChannelStatus.UNCONFIGURED,
          credentials: null,
          webhookSecret: null,
          lastTestedAt: null,
        };
      }

      let credentials: Record<string, any> | null = null;
      if (config.encryptedCredentials) {
        try {
          const decrypted = this.cryptoService.decrypt(config.encryptedCredentials);
          credentials = this.maskCredentials(decrypted);
        } catch (e) {
          credentials = {};
        }
      }

      const { encryptedCredentials: _, ...rest } = config;
      return {
        ...rest,
        credentials,
      };
    });
  }

  async getConfigByProvider(
    orgId: string,
    provider: ChannelProviderType,
  ): Promise<ChannelConfig | null> {
    return this.configRepo.findOne({
      where: { organizationId: orgId, provider },
    });
  }

  async saveConfig(
    orgId: string,
    provider: ChannelProviderType,
    isEnabled: boolean,
    credentials?: Record<string, any>,
  ): Promise<any> {
    let config = await this.configRepo.findOne({
      where: { organizationId: orgId, provider },
    });

    let encryptedCredentials = config?.encryptedCredentials || null;

    if (credentials && Object.keys(credentials).length > 0) {
      const finalCreds = { ...credentials };
      if (config?.encryptedCredentials) {
        try {
          const existingDecrypted = this.cryptoService.decrypt(
            config.encryptedCredentials,
          );
          for (const [key, value] of Object.entries(credentials)) {
            if (
              typeof value === 'string' &&
              value.includes('••••') &&
              existingDecrypted[key]
            ) {
              finalCreds[key] = existingDecrypted[key];
            }
          }
        } catch (e) {
          // Ignore decryption error
        }
      }
      encryptedCredentials = this.cryptoService.encrypt(finalCreds);
    }

    const webhookSecret =
      config?.webhookSecret || randomBytes(16).toString('hex');

    if (config) {
      config.isEnabled = isEnabled;
      if (encryptedCredentials) {
        config.encryptedCredentials = encryptedCredentials;
      }
      config.webhookSecret = webhookSecret;
      if (config.status === ChannelStatus.UNCONFIGURED && encryptedCredentials) {
        config.status = ChannelStatus.CONFIGURED;
      }
    } else {
      config = this.configRepo.create({
        organizationId: orgId,
        provider,
        isEnabled,
        encryptedCredentials,
        webhookSecret,
        status: encryptedCredentials
          ? ChannelStatus.CONFIGURED
          : ChannelStatus.UNCONFIGURED,
      });
    }

    const saved = await this.configRepo.save(config);

    let decryptedCreds: Record<string, any> | null = null;
    if (saved.encryptedCredentials) {
      try {
        const dec = this.cryptoService.decrypt(saved.encryptedCredentials);
        decryptedCreds = this.maskCredentials(dec);
      } catch (e) {
        decryptedCreds = {};
      }
    }

    const { encryptedCredentials: _, ...rest } = saved;
    return {
      ...rest,
      credentials: decryptedCreds,
    };
  }

  async testConnection(
    orgId: string,
    provider: ChannelProviderType,
  ): Promise<{ success: boolean; message: string; status: ChannelStatus }> {
    const config = await this.configRepo.findOne({
      where: { organizationId: orgId, provider },
    });

    if (!config || !config.encryptedCredentials) {
      throw new NotFoundException(
        `Channel configuration for provider ${provider} not found`,
      );
    }

    const credentials = this.cryptoService.decrypt(config.encryptedCredentials);
    const driver = this.getDriver(provider);
    const result = await driver.testConnection(credentials);

    config.lastTestedAt = new Date();
    config.status = result.success
      ? ChannelStatus.CONFIGURED
      : ChannelStatus.ERROR;
    await this.configRepo.save(config);

    return {
      success: result.success,
      message: result.message,
      status: config.status,
    };
  }

  async sendMessage(
    orgId: string,
    actorId: string,
    dto: SendMessageDto,
  ): Promise<ChannelMessage> {
    const config = await this.configRepo.findOne({
      where: { organizationId: orgId, provider: dto.provider },
    });

    if (!config || !config.isEnabled || !config.encryptedCredentials) {
      throw new BadRequestException(
        `Channel ${dto.provider} is not configured or is disabled`,
      );
    }

    const credentials = this.cryptoService.decrypt(config.encryptedCredentials);
    const driver = this.getDriver(dto.provider);

    try {
      const result = await driver.sendMessage(credentials, {
        recipient: dto.recipient,
        body: dto.body,
        subject: dto.subject,
      });

      const message = this.messageRepo.create({
        organizationId: orgId,
        contactId: dto.contactId || null,
        provider: dto.provider,
        direction: MessageDirection.OUTBOUND,
        sender: actorId,
        recipient: dto.recipient,
        body: dto.body,
        metadata: {
          externalId: result.externalId,
          rawResponse: result.rawResponse,
          actorId,
          subject: dto.subject,
        },
        status: MessageStatus.SENT,
      });

      return await this.messageRepo.save(message);
    } catch (err: any) {
      const failedMessage = this.messageRepo.create({
        organizationId: orgId,
        contactId: dto.contactId || null,
        provider: dto.provider,
        direction: MessageDirection.OUTBOUND,
        sender: actorId,
        recipient: dto.recipient,
        body: dto.body,
        metadata: {
          error: err.message || String(err),
          actorId,
          subject: dto.subject,
        },
        status: MessageStatus.FAILED,
      });
      await this.messageRepo.save(failedMessage);
      throw err;
    }
  }

  async getMessages(
    orgId: string,
    query?: { contactId?: string; limit?: number },
  ): Promise<ChannelMessage[]> {
    const where: any = { organizationId: orgId };
    if (query?.contactId) {
      where.contactId = query.contactId;
    }
    return this.messageRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: query?.limit || 50,
    });
  }
}
