import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ChannelsService } from './channels.service';
import { ChannelConfig, ChannelProviderType, ChannelStatus } from './entities/channel-config.entity';
import { ChannelMessage, MessageDirection, MessageStatus } from './entities/channel-message.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';

const orgId = '11111111-1111-1111-1111-111111111111';
const actorId = '22222222-2222-2222-2222-222222222222';
const cryptoService = new ChannelCryptoService('secret-key-32-characters-length!!');

function makeService(overrides: { configRepo?: any; messageRepo?: any } = {}) {
  const configs: ChannelConfig[] = [];
  const messages: ChannelMessage[] = [];

  const configRepo = overrides.configRepo || ({
    find: jest.fn().mockImplementation(async ({ where }) => {
      return configs.filter((c) => c.organizationId === where.organizationId);
    }),
    findOne: jest.fn().mockImplementation(async ({ where }) => {
      return (
        configs.find(
          (c) =>
            c.organizationId === where.organizationId &&
            c.provider === where.provider,
        ) || null
      );
    }),
    create: jest.fn().mockImplementation((dto) => ({
      id: 'config-uuid-123',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastTestedAt: null,
      ...dto,
    })),
    save: jest.fn().mockImplementation(async (config) => {
      const idx = configs.findIndex(
        (c) =>
          c.organizationId === config.organizationId &&
          c.provider === config.provider,
      );
      if (idx >= 0) {
        configs[idx] = { ...configs[idx], ...config, updatedAt: new Date() };
        return configs[idx];
      }
      configs.push(config);
      return config;
    }),
  } as unknown as Repository<ChannelConfig>);

  const messageRepo = overrides.messageRepo || ({
    find: jest.fn().mockImplementation(async ({ where }) => {
      return messages.filter((m) => {
        if (m.organizationId !== where.organizationId) return false;
        if (where.contactId && m.contactId !== where.contactId) return false;
        return true;
      });
    }),
    create: jest.fn().mockImplementation((dto) => ({
      id: 'message-uuid-456',
      createdAt: new Date(),
      ...dto,
    })),
    save: jest.fn().mockImplementation(async (msg) => {
      messages.push(msg);
      return msg;
    }),
  } as unknown as Repository<ChannelMessage>);

  const service = new ChannelsService(configRepo, messageRepo, cryptoService);
  return { service, configRepo, messageRepo, configs, messages };
}

describe('ChannelsService', () => {
  describe('getConfigs', () => {
    it('returns default unconfigured list for all 4 providers when empty', async () => {
      const { service } = makeService();
      const res = await service.getConfigs(orgId);
      expect(res).toHaveLength(4);
      expect(res.map((c) => c.provider)).toEqual([
        ChannelProviderType.WHATSAPP_META,
        ChannelProviderType.TELEGRAM,
        ChannelProviderType.EMAIL_SMTP,
        ChannelProviderType.EMAIL_RESEND,
      ]);
      expect(res[0].status).toBe(ChannelStatus.UNCONFIGURED);
    });

    it('returns masked credentials when config exists', async () => {
      const { service } = makeService();
      await service.saveConfig(orgId, ChannelProviderType.TELEGRAM, true, {
        botToken: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        botUsername: 'TestBot',
      });

      const res = await service.getConfigs(orgId);
      const telegramConfig = res.find(
        (c) => c.provider === ChannelProviderType.TELEGRAM,
      );
      expect(telegramConfig).toBeDefined();
      expect(telegramConfig.isEnabled).toBe(true);
      expect(telegramConfig.credentials.botToken).toContain('••••');
      expect(telegramConfig.credentials.botUsername).toBe('TestBot');
    });
  });

  describe('saveConfig', () => {
    it('encrypts credentials and generates webhookSecret', async () => {
      const { service, configs } = makeService();
      const res = await service.saveConfig(
        orgId,
        ChannelProviderType.EMAIL_RESEND,
        true,
        { apiKey: 're_123456789_abcdef', fromEmail: 'test@example.com' },
      );

      expect(res.provider).toBe(ChannelProviderType.EMAIL_RESEND);
      expect(res.webhookSecret).toBeDefined();
      expect(res.status).toBe(ChannelStatus.CONFIGURED);
      expect(configs[0].encryptedCredentials).not.toContain('re_123456789_abcdef');
    });

    it('preserves existing decrypted credentials when updating with masked values', async () => {
      const { service } = makeService();
      await service.saveConfig(orgId, ChannelProviderType.TELEGRAM, true, {
        botToken: 'real-super-secret-token',
        botUsername: 'OldUsername',
      });

      const updated = await service.saveConfig(
        orgId,
        ChannelProviderType.TELEGRAM,
        true,
        {
          botToken: 'real••••ken',
          botUsername: 'NewUsername',
        },
      );

      expect(updated.credentials.botUsername).toBe('NewUsername');
      const dbConfig = await service.getConfigByProvider(
        orgId,
        ChannelProviderType.TELEGRAM,
      );
      const dec = cryptoService.decrypt(dbConfig!.encryptedCredentials!);
      expect(dec.botToken).toBe('real-super-secret-token');
      expect(dec.botUsername).toBe('NewUsername');
    });
  });

  describe('testConnection', () => {
    it('throws NotFoundException if config is missing or unconfigured', async () => {
      const { service } = makeService();
      await expect(
        service.testConnection(orgId, ChannelProviderType.TELEGRAM),
      ).rejects.toThrow(NotFoundException);
    });

    it('calls driver testConnection and updates lastTestedAt and status', async () => {
      const { service } = makeService();
      await service.saveConfig(orgId, ChannelProviderType.TELEGRAM, true, {
        botToken: 'invalid-token',
        botUsername: 'TestBot',
      });

      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({ ok: false, description: 'Unauthorized' }),
      } as any);

      const res = await service.testConnection(
        orgId,
        ChannelProviderType.TELEGRAM,
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe(ChannelStatus.ERROR);

      const dbConfig = await service.getConfigByProvider(
        orgId,
        ChannelProviderType.TELEGRAM,
      );
      expect(dbConfig?.status).toBe(ChannelStatus.ERROR);
      expect(dbConfig?.lastTestedAt).toBeDefined();
    });
  });

  describe('sendMessage', () => {
    it('throws BadRequestException if channel is not configured or disabled', async () => {
      const { service } = makeService();
      await expect(
        service.sendMessage(orgId, actorId, {
          provider: ChannelProviderType.TELEGRAM,
          recipient: '123456',
          body: 'Hello',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sends message via driver and saves ChannelMessage as SENT', async () => {
      const { service, messages } = makeService();
      await service.saveConfig(orgId, ChannelProviderType.TELEGRAM, true, {
        botToken: 'test-token',
        botUsername: 'TestBot',
      });

      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          result: { message_id: 888 },
        }),
      } as any);

      const msg = await service.sendMessage(orgId, actorId, {
        provider: ChannelProviderType.TELEGRAM,
        recipient: '12345678',
        body: 'Test Telegram message',
      });

      expect(msg.direction).toBe(MessageDirection.OUTBOUND);
      expect(msg.status).toBe(MessageStatus.SENT);
      expect(msg.metadata.externalId).toBe('888');
      expect(messages).toHaveLength(1);
    });

    it('saves message as FAILED when driver fails and rethrows', async () => {
      const { service, messages } = makeService();
      await service.saveConfig(orgId, ChannelProviderType.TELEGRAM, true, {
        botToken: 'test-token',
        botUsername: 'TestBot',
      });

      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          ok: false,
          description: 'Chat not found',
        }),
      } as any);

      await expect(
        service.sendMessage(orgId, actorId, {
          provider: ChannelProviderType.TELEGRAM,
          recipient: 'invalid-chat-id',
          body: 'Fail test',
        }),
      ).rejects.toThrow('Chat not found');

      expect(messages).toHaveLength(1);
      expect(messages[0].status).toBe(MessageStatus.FAILED);
      expect(messages[0].metadata.error).toBe('Chat not found');
    });
  });

  describe('getMessages', () => {
    it('returns message history for org and filters by contactId', async () => {
      const { service, messages } = makeService();
      messages.push(
        {
          id: '1',
          organizationId: orgId,
          contactId: 'contact-1',
          provider: ChannelProviderType.TELEGRAM,
          direction: MessageDirection.OUTBOUND,
          sender: actorId,
          recipient: '123',
          body: 'Msg 1',
          metadata: {},
          status: MessageStatus.SENT,
          createdAt: new Date(),
        } as ChannelMessage,
        {
          id: '2',
          organizationId: orgId,
          contactId: 'contact-2',
          provider: ChannelProviderType.EMAIL_RESEND,
          direction: MessageDirection.INBOUND,
          sender: 'user@test.com',
          recipient: 'crm@test.com',
          body: 'Msg 2',
          metadata: {},
          status: MessageStatus.RECEIVED,
          createdAt: new Date(),
        } as ChannelMessage,
      );

      const all = await service.getMessages(orgId);
      expect(all).toHaveLength(2);

      const filtered = await service.getMessages(orgId, { contactId: 'contact-1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });
  });
});
