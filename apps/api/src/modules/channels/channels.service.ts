import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Not, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import type { AppConfig } from '@/config/configuration';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { ContactsService } from '../contacts/contacts.service';
import { TemporalService } from '../temporal/temporal.service';
import {
  ChannelConfig,
  ChannelProviderType,
  ChannelStatus,
} from './entities/channel-config.entity';
import {
  CHANNEL_MESSAGE_EXTERNAL_ID_UNIQUE,
  ChannelMessage,
  MessageAiProcessingStatus,
  MessageDirection,
  MessageStatus,
} from './entities/channel-message.entity';
import { StaffChannelIdentity } from './entities/staff-channel-identity.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';
import {
  ChannelCommandService,
  type ChannelCommandResult,
} from './services/channel-command.service';
import {
  ChannelDriver,
  type InboundMedia,
} from './interfaces/channel-driver.interface';
import type { OutboundPayload } from './interfaces/channel-driver.interface';
import { MetaWhatsAppDriver } from './drivers/meta-whatsapp.driver';
import { TelegramDriver } from './drivers/telegram.driver';
import { SlackDriver } from './drivers/slack.driver';
import { EmailSmtpDriver } from './drivers/email-smtp.driver';
import { EmailResendDriver } from './drivers/email-resend.driver';
import {
  channelAiWorkflow,
  channelConversationWorkflow,
} from './workflows/channel-ai.workflow';
import { newInboundMessageSignal } from './workflows/interfaces';
import { IntentAgentConfigService } from './services/intent-agent-config.service';
import { ChannelThreadService } from './services/channel-thread.service';
import { ShopEventsService } from '@/common/events';
import { ATTACHMENT_MAX_BYTES } from '@saas/shared';
import { AttachmentsService } from '../storage/attachments.service';
import {
  type MessageFileDto,
  type StoredMessageFile,
  filenameFor,
  toMessageFileDtos,
} from './message-files';

export interface SendMessageDto {
  contactId?: string;
  provider: ChannelProviderType;
  recipient: string;
  body: string;
  subject?: string;
  template?: OutboundPayload['template'];
  /** Extra facts stored on the message, e.g. which document it carried. */
  metadata?: Record<string, unknown>;
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
    private readonly intentAgentConfigService: IntentAgentConfigService,
    @Optional()
    private readonly tenantContext?: TenantContextService,
    @Optional()
    private readonly threads?: ChannelThreadService,
    @Optional()
    private readonly shopEvents?: ShopEventsService,
    @Optional()
    private readonly attachments?: AttachmentsService,
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
      case ChannelProviderType.SLACK:
        return new SlackDriver();
      case ChannelProviderType.EMAIL_SMTP:
        return new EmailSmtpDriver();
      case ChannelProviderType.EMAIL_RESEND:
        return new EmailResendDriver();
      default:
        throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * The bytes of a file that arrived on a channel, by the provider's id for
   * it. Skills hold only that id between turns, so the confirmation step can
   * fetch the same file the proposal was made from.
   */
  async downloadMedia(
    orgId: string,
    provider: ChannelProviderType,
    mediaId: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const config = await this.configRepo.findOne({
      where: { organizationId: orgId, provider },
    });
    if (!config || !config.isEnabled || !config.encryptedCredentials) {
      throw new BadRequestException(
        `Channel ${provider} is not configured or is disabled`,
      );
    }
    const driver = this.getDriver(provider);
    if (!driver.downloadMedia) {
      throw new BadRequestException(
        `Files from ${provider} cannot be read yet`,
      );
    }
    const credentials = this.cryptoService.decrypt(config.encryptedCredentials);
    return driver.downloadMedia(credentials, mediaId, maxBytes);
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
        ...(dto.template ? { template: dto.template } : {}),
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
          ...(dto.template ? { template: dto.template.name } : {}),
          ...dto.metadata,
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
          ...dto.metadata,
        },
        status: MessageStatus.FAILED,
      });
      await this.messageRepo.save(failedMessage);
      throw err;
    }
  }

  /**
   * A customer conversation as an agent reads it: the most recent messages on
   * one channel, oldest first. Anything sent from this side, by the AI or by
   * staff, reads as the business speaking.
   */
  async getTranscript(
    orgId: string,
    provider: ChannelProviderType,
    contactId: string,
    limit = 20,
  ): Promise<{ role: 'customer' | 'agent'; body: string }[]> {
    const messages = await this.messageRepo.find({
      where: {
        organizationId: orgId,
        provider,
        contactId,
        status: Not(MessageStatus.FAILED),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return messages
      .reverse()
      .filter((message) => message.body?.trim())
      .map((message) => ({
        role:
          message.direction === MessageDirection.INBOUND ? 'customer' : 'agent',
        body: message.body,
      }));
  }

  async getMessages(
    orgId: string,
    query?: { contactId?: string; limit?: number },
  ): Promise<(ChannelMessage & { files?: MessageFileDto[] })[]> {
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

    const identities =
      typeof this.channelCommandService?.listAllIdentities === 'function'
        ? await this.channelCommandService.listAllIdentities(orgId)
        : [];

    const identityMap = new Map<string, StaffChannelIdentity>();
    for (const ident of identities) {
      identityMap.set(`${ident.provider}:${ident.identifier}`, ident);
    }

    // `Contact.fullName` is a getter, not a column — it's dropped by JSON
    // serialization unless run through the same DTO mapping the contacts
    // endpoints use, so the embedded `contact` here must go through it too.
    return messages.map((message) => {
      const contactDto = message.contact
        ? (this.contactsService.toDto(message.contact) as any)
        : null;

      const ident =
        identityMap.get(`${message.provider}:${message.sender}`) ||
        identityMap.get(`${message.provider}:${message.recipient}`);

      let staffUser:
        { id: string; name: string; email: string; role?: string } | undefined =
        undefined;
      if (ident?.user) {
        const u = ident.user as any;
        const name =
          `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
        staffUser = {
          id: u.id,
          name,
          email: u.email,
          ...(u.role
            ? { role: u.role }
            : u.roles?.[0]?.name
              ? { role: u.roles[0].name }
              : {}),
        };
      }

      if (staffUser && contactDto) {
        contactDto.fullName = staffUser.name;
        contactDto.isStaff = true;
      }

      const files = toMessageFileDtos(message);

      return {
        ...message,
        contact: contactDto,
        ...(staffUser ? { staffUser } : {}),
        ...(files.length ? { files } : {}),
      };
    });
  }

  async verifyMetaChallenge(
    orgId: string,
    mode: string,
    verifyToken: string,
    challenge: string,
  ): Promise<string> {
    const run = <T>(fn: () => Promise<T>): Promise<T> =>
      this.tenantContext ? this.tenantContext.runWithTenant(orgId, fn) : fn();

    return run(async () => {
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
    });
  }

  async processInboundWebhook(
    orgId: string,
    provider: ChannelProviderType,
    headers: any,
    body: any,
    rawBody?: Buffer,
  ): Promise<{
    ignored?: boolean;
    success?: boolean;
    messageId?: string;
    duplicate?: boolean;
    challenge?: string;
  }> {
    const run = <T>(fn: () => Promise<T>): Promise<T> =>
      this.tenantContext ? this.tenantContext.runWithTenant(orgId, fn) : fn();

    return run(async () => {
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

      // Slack's Events API handshake: echo the challenge back, but only after
      // the request signature checks out — the URL is public.
      const slackEnvelope = body as { type?: string; challenge?: string };
      if (
        provider === ChannelProviderType.SLACK &&
        slackEnvelope?.type === 'url_verification'
      ) {
        const slack = driver as SlackDriver;
        if (!slack.verifySlackSignature(credentials, headers, rawBody)) {
          throw new UnauthorizedException('Invalid Slack request signature');
        }
        return { challenge: slackEnvelope.challenge };
      }

      const parsed = await driver.parseWebhookPayload(
        credentials,
        headers,
        body,
        rawBody,
      );
      if (!parsed || !parsed.senderIdentifier) {
        return { ignored: true };
      }

      // A provider redelivers any webhook it believes failed. The inbound row
      // is the claim: it carries the provider's message id under a partial
      // unique index, so a second delivery fails to insert and stops here —
      // before a staff command (quote approval) runs again or a second AI
      // workflow starts. The contact is resolved first only so the row can
      // carry it; find-or-create is itself serialised and idempotent.
      const contact = await this.contactsService.findOrCreateForChannel(
        orgId,
        parsed.senderIdentifier,
        provider,
        parsed.senderName,
      );

      const externalMessageId = parsed.externalMessageId
        ? String(parsed.externalMessageId).slice(0, 255)
        : null;

      let saved: ChannelMessage;
      try {
        saved = await this.messageRepo.save(
          this.messageRepo.create({
            organizationId: orgId,
            contactId: contact.id,
            provider,
            direction: MessageDirection.INBOUND,
            sender: parsed.senderIdentifier,
            recipient: orgId,
            body: parsed.body,
            externalMessageId,
            metadata: {
              externalId: parsed.externalMessageId,
              rawPayload: parsed.rawPayload,
              ...(parsed.files?.length
                ? { files: parsed.files.map(toStoredFile) }
                : {}),
            },
            status: MessageStatus.RECEIVED,
          }),
        );
      } catch (err: unknown) {
        if (isDuplicateInboundError(err)) {
          this.logger.log(
            `Ignoring redelivered ${provider} message ${externalMessageId}`,
          );
          return { success: true, duplicate: true };
        }
        throw err;
      }

      // Staff commands (quote approval via chat) are routed before any
      // customer-facing AI work. `handled: false` means this sender has no
      // linked staff identity and no active linking code — fall through to
      // the ordinary customer path exactly as before.
      let commandResult: ChannelCommandResult;
      try {
        // A file's `body` is a placeholder for the inbox; the command layer
        // gets only what the person actually typed with it.
        commandResult = await this.channelCommandService.handleInboundMessage(
          orgId,
          provider,
          parsed.senderIdentifier,
          parsed.media ? (parsed.media.caption ?? '') : parsed.body,
          parsed.media,
        );
      } catch (err) {
        // Nothing was done for this message: release the claim so the
        // provider's retry is processed rather than silently dropped.
        await this.messageRepo.delete({ id: saved.id });
        throw err;
      }

      if (commandResult.handled) {
        saved.metadata = {
          ...saved.metadata,
          staffUserId: commandResult.userId,
        };
        await this.messageRepo.update(
          { id: saved.id },
          { metadata: saved.metadata },
        );

        if (commandResult.reply && commandResult.userId) {
          await this.sendMessage(orgId, commandResult.userId, {
            contactId: contact.id,
            provider,
            recipient: parsed.senderIdentifier,
            body: commandResult.reply.body,
          });
        }
        this.keepFilesInBackground(orgId, provider, saved.id, parsed.files);
        return { success: true };
      }

      // Started only now: a failed command deletes the row above, and the
      // files would be left belonging to a message that no longer exists.
      this.keepFilesInBackground(orgId, provider, saved.id, parsed.files);

      // A customer wrote, whoever answers it: a person or the AI.
      await this.shopEvents?.emit('message.received', orgId, saved.id);

      // A conversation a person holds, or is waiting to be picked up, is
      // left to them: the AI neither classifies nor replies.
      if (
        this.threads &&
        !(await this.threads.admitInbound(orgId, provider, contact.id))
      ) {
        return { success: true };
      }

      saved.aiProcessingStatus = MessageAiProcessingStatus.PENDING;
      await this.messageRepo.update(
        { id: saved.id },
        { aiProcessingStatus: MessageAiProcessingStatus.PENDING },
      );

      try {
        const client = await this.temporalService.getClient();
        const intentConfig =
          await this.intentAgentConfigService.getEffective(orgId);
        if (
          intentConfig.isEnabled &&
          intentConfig.eligibleProviders.includes(provider)
        ) {
          // Per-contact, long-running conversation — the first message and
          // every follow-up reply both flow in purely via signal, so this
          // correlates back to the same in-progress workflow instead of
          // starting an unrelated one per message. Settings are resolved once,
          // here, and carried in the workflow's input for its whole lifetime.
          await client.workflow.signalWithStart(channelConversationWorkflow, {
            taskQueue: 'channel-ai-queue',
            workflowId: `channel-conv-${orgId}-${provider}-${contact.id}`,
            args: [
              {
                organizationId: orgId,
                provider,
                contactId: contact.id,
                senderIdentifier: parsed.senderIdentifier,
                maxTurns: intentConfig.maxTurns,
                replyTimeoutMinutes: intentConfig.replyTimeoutMinutes,
                systemPrompt: intentConfig.systemPrompt,
                model: intentConfig.model,
                aiProvider: intentConfig.provider,
              },
            ],
            signal: newInboundMessageSignal,
            signalArgs: [{ messageId: saved.id, body: parsed.body }],
          });
        } else {
          // Keyed on the provider's message rather than the row, and never
          // reused: a second start for the same message is rejected.
          await client.workflow.start(channelAiWorkflow, {
            taskQueue: 'channel-ai-queue',
            workflowId: channelAiWorkflowId(
              orgId,
              provider,
              parsed.senderIdentifier,
              externalMessageId,
              saved.id,
            ),
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            args: [
              {
                messageId: saved.id,
                organizationId: orgId,
                contactId: contact.id,
                provider,
                senderIdentifier: parsed.senderIdentifier,
                body: parsed.body,
                model: intentConfig.model,
                aiProvider: intentConfig.provider,
              },
            ],
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Channel AI workflow start deferred/failed: ${msg}`);
      }

      return { success: true, messageId: saved.id };
    });
  }

  /**
   * Copies a message's files out of the provider and into our own store,
   * without making the webhook wait: WhatsApp keeps a file for 30 days and a
   * Telegram or Resend link lasts an hour, so the inbox cannot rely on them.
   * Never throws; a file that cannot be fetched is marked so the inbox says so.
   */
  private keepFilesInBackground(
    orgId: string,
    provider: ChannelProviderType,
    messageId: string,
    files: InboundMedia[] | undefined,
  ): void {
    if (!files?.length || !this.attachments) return;
    void this.keepFiles(orgId, provider, messageId, files).catch((err) => {
      this.logger.warn(
        `Could not keep the files of message ${messageId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async keepFiles(
    orgId: string,
    provider: ChannelProviderType,
    messageId: string,
    files: InboundMedia[],
  ): Promise<StoredMessageFile[]> {
    const attachments = this.attachments;
    if (!attachments) return [];
    const kept: StoredMessageFile[] = [];
    for (const [index, file] of files.entries()) {
      const entry = toStoredFile(file, index);
      try {
        const fetched = await this.downloadMedia(
          orgId,
          provider,
          file.id,
          ATTACHMENT_MAX_BYTES,
        );
        // The message says what the file is; the download often says only
        // "a file".
        const mimeType =
          file.mimeType && file.mimeType !== 'application/octet-stream'
            ? file.mimeType
            : fetched.mimeType;
        const row = await attachments.storeReceived(
          orgId,
          'CHANNEL_MESSAGE',
          messageId,
          { buffer: fetched.buffer, mimeType, filename: entry.filename },
        );
        kept.push({
          ...entry,
          attachmentId: row.id,
          sizeBytes: row.sizeBytes,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Could not keep file ${index + 1} of message ${messageId}: ${reason}`,
        );
        kept.push({ ...entry, error: reason.slice(0, 200) });
      }
    }
    // One statement that touches only `files`, so it cannot undo a change
    // made to the rest of the metadata while the downloads were running.
    await this.messageRepo.query(
      `UPDATE "${this.messageRepo.metadata.tableName}"
          SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{files}', $1::jsonb)
        WHERE id = $2 AND "organizationId" = $3`,
      [JSON.stringify(kept), messageId, orgId],
    );
    return kept;
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

/**
 * True when an insert lost to the inbound external-id unique index, i.e. the
 * provider redelivered a message that is already recorded.
 */
function isDuplicateInboundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = e.code ?? e.driverError?.code;
  const constraint = e.constraint ?? e.driverError?.constraint;
  return code === '23505' && constraint === CHANNEL_MESSAGE_EXTERNAL_ID_UNIQUE;
}

/**
 * Deterministic id for the one-shot classification workflow. Derived from the
 * provider's own message id when there is one, so a second start for the same
 * message is rejected by Temporal however it comes about. Hashed so sender
 * addresses and phone numbers do not end up in workflow ids.
 */
export function channelAiWorkflowId(
  orgId: string,
  provider: ChannelProviderType,
  senderIdentifier: string,
  externalMessageId: string | null,
  rowId: string,
): string {
  if (!externalMessageId) return `channel-ai-${rowId}`;
  const digest = createHash('sha256')
    .update(`${senderIdentifier}\u0000${externalMessageId}`)
    .digest('hex')
    .slice(0, 32);
  return `channel-ai-${orgId}-${provider}-${digest}`;
}

function toStoredFile(file: InboundMedia, index: number): StoredMessageFile {
  return {
    ref: file.id,
    mimeType: file.mimeType,
    filename: filenameFor(file, index),
  };
}
