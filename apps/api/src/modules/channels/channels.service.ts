import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import type { AppConfig } from '@/config/configuration';
import { ContactsService } from '../contacts/contacts.service';
import { TemporalService } from '../temporal/temporal.service';
import {
  ChannelConfig,
  ChannelProviderType,
  ChannelStatus,
} from './entities/channel-config.entity';
import {
  ChannelMessage,
  MessageAiProcessingStatus,
  MessageDirection,
  MessageStatus,
} from './entities/channel-message.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';
import { ChannelCommandService } from './services/channel-command.service';
import { ChannelDriver } from './interfaces/channel-driver.interface';
import { MetaWhatsAppDriver } from './drivers/meta-whatsapp.driver';
import { TelegramDriver } from './drivers/telegram.driver';
import { EmailSmtpDriver } from './drivers/email-smtp.driver';
import { EmailResendDriver } from './drivers/email-resend.driver';
import {
  channelAiWorkflow,
  channelConversationWorkflow,
} from './workflows/channel-ai.workflow';
import { newInboundMessageSignal } from './workflows/interfaces';

/**
 * Providers confirmed safe to let the AI agent auto-chat on (send its own
 * clarifying questions) — email never gets AI-authored freeform text sent
 * automatically, only the fixed canned auto-ack template.
 */
const CHAT_ENABLED_PROVIDERS: ChannelProviderType[] = [
  ChannelProviderType.TELEGRAM,
  ChannelProviderType.WHATSAPP_META,
];

export interface SendMessageDto {
  contactId?: string;
  provider: ChannelProviderType;
  recipient: string;
  body: string;
  subject?: string;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectRepository(ChannelConfig)
    private readonly configRepo: Repository<ChannelConfig>,
    @InjectRepository(ChannelMessage)
    private readonly messageRepo: Repository<ChannelMessage>,
    private readonly cryptoService: ChannelCryptoService,
    private readonly contactsService: ContactsService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly channelCommandService: ChannelCommandService,
    private readonly temporalService: TemporalService,
  ) {}

  /** The URL the given provider's inbound webhook is reachable at — must match the route in ChannelsWebhookController. */
  private buildWebhookUrl(
    orgId: string,
    provider: ChannelProviderType,
  ): string {
    const base = this.configService.get('publicApiUrl', { infer: true });
    return `${base}/webhooks/channels/${provider}/${orgId}`;
  }

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

  private maskCredentials(
    credentials: Record<string, any>,
  ): Record<string, any> {
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
          webhookUrl: this.buildWebhookUrl(orgId, provider),
          lastTestedAt: null,
        };
      }

      let credentials: Record<string, any> | null = null;
      if (config.encryptedCredentials) {
        try {
          const decrypted = this.cryptoService.decrypt(
            config.encryptedCredentials,
          );
          credentials = this.maskCredentials(decrypted);
        } catch (e) {
          credentials = {};
        }
      }

      const { encryptedCredentials: _, ...rest } = config;
      return {
        ...rest,
        credentials,
        webhookUrl: this.buildWebhookUrl(orgId, provider),
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
      if (
        config.status === ChannelStatus.UNCONFIGURED &&
        encryptedCredentials
      ) {
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

    let saved = await this.configRepo.save(config);

    // Providers with an API-registrable webhook (currently just Telegram) get
    // their webhook (re-)registered on every save — cheap and idempotent, and
    // means the "register with curl" step from the setup docs isn't needed.
    let webhookRegistration: { success: boolean; message: string } | undefined;
    const driver = this.getDriver(provider);
    if (driver.registerWebhook && isEnabled && saved.encryptedCredentials) {
      const finalCreds = this.cryptoService.decrypt(saved.encryptedCredentials);
      const webhookUrl = this.buildWebhookUrl(orgId, provider);
      webhookRegistration = await driver.registerWebhook(
        finalCreds,
        webhookUrl,
      );
      saved.status = webhookRegistration.success
        ? ChannelStatus.CONFIGURED
        : ChannelStatus.ERROR;
      saved = await this.configRepo.save(saved);
    }

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
      webhookUrl: this.buildWebhookUrl(orgId, provider),
      ...(webhookRegistration ? { webhookRegistration } : {}),
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
    const messages = await this.messageRepo.find({
      where,
      relations: { contact: true },
      order: { createdAt: 'DESC' },
      take: query?.limit || 50,
    });

    // `Contact.fullName` is a getter, not a column — it's dropped by JSON
    // serialization unless run through the same DTO mapping the contacts
    // endpoints use, so the embedded `contact` here must go through it too.
    return messages.map((message) => ({
      ...message,
      contact: message.contact
        ? (this.contactsService.toDto(message.contact) as any)
        : null,
    }));
  }

  async verifyMetaChallenge(
    orgId: string,
    mode: string,
    verifyToken: string,
    challenge: string,
  ): Promise<string> {
    const config = await this.configRepo.findOne({
      where: {
        organizationId: orgId,
        provider: ChannelProviderType.WHATSAPP_META,
      },
    });

    if (!config) {
      throw new UnauthorizedException('Channel configuration not found');
    }

    let credentialVerifyToken: string | undefined;
    if (config.encryptedCredentials) {
      try {
        const decrypted = this.cryptoService.decrypt(
          config.encryptedCredentials,
        );
        credentialVerifyToken = decrypted?.verifyToken;
      } catch (e) {
        // Ignore decryption error
      }
    }

    const matchesToken =
      (credentialVerifyToken && verifyToken === credentialVerifyToken) ||
      (config.webhookSecret && verifyToken === config.webhookSecret);

    if (mode !== 'subscribe' || !verifyToken || !matchesToken) {
      throw new UnauthorizedException('Invalid verification token or mode');
    }

    return challenge;
  }

  async processInboundWebhook(
    orgId: string,
    provider: ChannelProviderType,
    headers: any,
    body: any,
  ): Promise<{ ignored?: boolean; success?: boolean; messageId?: string }> {
    const config = await this.configRepo.findOne({
      where: { organizationId: orgId, provider },
    });

    if (!config || !config.isEnabled) {
      return { ignored: true };
    }

    let credentials: Record<string, any> = {};
    if (config.encryptedCredentials) {
      try {
        credentials = this.cryptoService.decrypt(config.encryptedCredentials);
      } catch (e) {
        // Ignore decryption error
      }
    }

    const driver = this.getDriver(provider);
    const parsed = await driver.parseWebhookPayload(credentials, headers, body);
    if (!parsed || !parsed.senderIdentifier) {
      return { ignored: true };
    }

    // Staff commands (quote approval via chat) are routed here, before any
    // customer-contact side effect. `handled: false` means this sender has
    // no linked staff identity and no active linking code — fall through to
    // the ordinary customer path exactly as before.
    const commandResult = await this.channelCommandService.handleInboundMessage(
      orgId,
      provider,
      parsed.senderIdentifier,
      parsed.body,
    );
    if (commandResult.handled) {
      if (commandResult.reply && commandResult.userId) {
        await this.sendMessage(orgId, commandResult.userId, {
          provider,
          recipient: parsed.senderIdentifier,
          body: commandResult.reply.body,
        });
      }
      return { success: true };
    }

    const contact = await this.contactsService.findOrCreateForChannel(
      orgId,
      parsed.senderIdentifier,
      provider,
    );

    const message = this.messageRepo.create({
      organizationId: orgId,
      contactId: contact.id,
      provider,
      direction: MessageDirection.INBOUND,
      sender: parsed.senderIdentifier,
      recipient: orgId,
      body: parsed.body,
      metadata: {
        externalId: parsed.externalMessageId,
        rawPayload: parsed.rawPayload,
      },
      status: MessageStatus.RECEIVED,
      aiProcessingStatus: MessageAiProcessingStatus.PENDING,
    });

    const saved = await this.messageRepo.save(message);

    try {
      const client = this.temporalService.getClient();
      if (CHAT_ENABLED_PROVIDERS.includes(provider)) {
        // Per-contact, long-running conversation — the first message and
        // every follow-up reply both flow in purely via signal, so this
        // correlates back to the same in-progress workflow instead of
        // starting an unrelated one per message.
        await client.workflow.signalWithStart(channelConversationWorkflow, {
          taskQueue: 'channel-ai-queue',
          workflowId: `channel-conv-${orgId}-${provider}-${contact.id}`,
          args: [
            {
              organizationId: orgId,
              provider,
              contactId: contact.id,
              senderIdentifier: parsed.senderIdentifier,
            },
          ],
          signal: newInboundMessageSignal,
          signalArgs: [{ messageId: saved.id, body: parsed.body }],
        });
      } else {
        await client.workflow.start(channelAiWorkflow, {
          taskQueue: 'channel-ai-queue',
          workflowId: `channel-ai-${saved.id}`,
          args: [
            {
              messageId: saved.id,
              organizationId: orgId,
              contactId: contact.id,
              provider,
              senderIdentifier: parsed.senderIdentifier,
              body: parsed.body,
            },
          ],
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Channel AI workflow start deferred/failed: ${msg}`);
    }

    return { success: true, messageId: saved.id };
  }

  async updateAiClassification(
    messageId: string,
    patch: Partial<
      Pick<
        ChannelMessage,
        | 'aiIntent'
        | 'aiConfidence'
        | 'aiSummary'
        | 'aiSuggestedReply'
        | 'aiSuggestedReplyOptions'
        | 'aiProcessingStatus'
        | 'aiAutoAcked'
        | 'aiCreatedQuoteId'
      >
    >,
  ): Promise<void> {
    await this.messageRepo.update({ id: messageId }, patch);
  }
}
