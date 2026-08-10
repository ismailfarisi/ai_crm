import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from './permissions';
import {
  metaWhatsAppConfigSchema,
  telegramConfigSchema,
  emailSmtpConfigSchema,
  emailResendConfigSchema,
  channelConfigSchema,
  sendChannelMessageSchema,
  ChannelProviderEnum,
} from '../schemas/channel';

describe('Channel Permissions & Schemas', () => {
  it('should include channel permissions in PERMISSIONS catalog', () => {
    expect(PERMISSIONS.CHANNEL_MANAGE).toBe('channel:manage');
    expect(PERMISSIONS.CHANNEL_READ).toBe('channel:read');
    expect(PERMISSIONS.CHANNEL_SEND).toBe('channel:send');
  });

  it('should validate Meta WhatsApp credentials payload', () => {
    const valid = metaWhatsAppConfigSchema.safeParse({
      phoneNumberId: '123456789',
      businessAccountId: '987654321',
      accessToken: 'EAAG...',
      verifyToken: 'my-secret-verify-token',
    });
    expect(valid.success).toBe(true);

    const invalid = metaWhatsAppConfigSchema.safeParse({
      phoneNumberId: '',
      businessAccountId: '987654321',
      accessToken: 'EAAG...',
      verifyToken: 'my-secret-verify-token',
    });
    expect(invalid.success).toBe(false);
  });

  it('should validate Telegram credentials payload', () => {
    const valid = telegramConfigSchema.safeParse({
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      botUsername: 'MyCrmBot',
    });
    expect(valid.success).toBe(true);

    const invalid = telegramConfigSchema.safeParse({
      botToken: '',
      botUsername: '',
    });
    expect(invalid.success).toBe(false);
  });

  it('should validate Email SMTP credentials payload', () => {
    const valid = emailSmtpConfigSchema.safeParse({
      host: 'smtp.mailtrap.io',
      port: 2525,
      secure: false,
      user: 'smtp_user',
      pass: 'smtp_pass',
      fromEmail: 'noreply@example.com',
      fromName: 'CRM Notifications',
    });
    expect(valid.success).toBe(true);
  });

  it('should validate Email Resend credentials payload', () => {
    const valid = emailResendConfigSchema.safeParse({
      apiKey: 're_123456789',
      fromEmail: 'noreply@example.com',
      fromName: 'CRM Notifications',
    });
    expect(valid.success).toBe(true);
  });

  it('should validate channelConfigSchema', () => {
    const validMeta = channelConfigSchema.safeParse({
      phoneNumberId: '123456789',
      businessAccountId: '987654321',
      accessToken: 'EAAG...',
      verifyToken: 'my-secret-verify-token',
    });
    expect(validMeta.success).toBe(true);

    const validTelegram = channelConfigSchema.safeParse({
      botToken: '123456:ABC-DEF',
      botUsername: 'MyBot',
    });
    expect(validTelegram.success).toBe(true);
  });

  it('should validate sendChannelMessageSchema', () => {
    const validMessage = sendChannelMessageSchema.safeParse({
      provider: ChannelProviderEnum.enum.WHATSAPP_META,
      recipient: '+1234567890',
      body: 'Hello from CRM!',
    });
    expect(validMessage.success).toBe(true);

    const invalidMessage = sendChannelMessageSchema.safeParse({
      provider: 'INVALID_PROVIDER',
      recipient: '',
      body: '',
    });
    expect(invalidMessage.success).toBe(false);
  });
});
