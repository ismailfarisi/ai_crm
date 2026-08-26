import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { TelegramDriver } from './telegram.driver';
import { MetaWhatsAppDriver } from './meta-whatsapp.driver';
import { EmailSmtpDriver } from './email-smtp.driver';
import { EmailResendDriver } from './email-resend.driver';

jest.mock('nodemailer');
jest.mock('resend');

describe('Channel Drivers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('TelegramDriver', () => {
    let driver: TelegramDriver;

    beforeEach(() => {
      driver = new TelegramDriver();
    });

    describe('testConnection', () => {
      it('returns success true when botToken is valid', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            ok: true,
            result: { username: 'TestBot' },
          }),
        } as any);

        const res = await driver.testConnection({ botToken: '12345:ABC' });
        expect(res).toEqual({
          success: true,
          message: 'Connected to Telegram bot @TestBot',
        });
        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.telegram.org/bot12345:ABC/getMe',
        );
      });

      it('returns success false when botToken is invalid', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            ok: false,
            description: 'Unauthorized',
          }),
        } as any);

        const res = await driver.testConnection({ botToken: 'invalid' });
        expect(res).toEqual({
          success: false,
          message: 'Unauthorized',
        });
      });

      it('handles missing botToken gracefully', async () => {
        const res = await driver.testConnection({});
        expect(res.success).toBe(false);
        expect(res.message).toContain('Missing botToken');
      });

      it('handles fetch network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
        const res = await driver.testConnection({ botToken: '123' });
        expect(res).toEqual({
          success: false,
          message: 'Network error',
        });
      });
    });

    describe('sendMessage', () => {
      it('sends message successfully', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            ok: true,
            result: { message_id: 999 },
          }),
        } as any);

        const res = await driver.sendMessage(
          { botToken: '12345:ABC' },
          { recipient: '123456', body: 'Hello Telegram' },
        );

        expect(res.externalId).toBe('999');
        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.telegram.org/bot12345:ABC/sendMessage',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ chat_id: '123456', text: 'Hello Telegram' }),
          }),
        );
      });

      it('throws error when API returns ok=false', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            ok: false,
            description: 'Chat not found',
          }),
        } as any);

        await expect(
          driver.sendMessage(
            { botToken: '123' },
            { recipient: 'bad_id', body: 'Hi' },
          ),
        ).rejects.toThrow('Chat not found');
      });

      it('throws error when credentials missing botToken', async () => {
        await expect(
          driver.sendMessage({}, { recipient: '123', body: 'Hi' }),
        ).rejects.toThrow('Missing botToken');
      });
    });

    describe('parseWebhookPayload', () => {
      it('parses valid incoming text message', async () => {
        const payload = {
          message: {
            message_id: 42,
            chat: { id: 1001 },
            text: 'Hello bot',
          },
        };
        const parsed = await driver.parseWebhookPayload({}, {}, payload);
        expect(parsed).toEqual({
          senderIdentifier: '1001',
          body: 'Hello bot',
          externalMessageId: '42',
          rawPayload: payload,
        });
      });

      it('returns null for empty or non-text message', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          { message: {} },
        );
        expect(parsed).toBeNull();
      });
    });
  });

  describe('MetaWhatsAppDriver', () => {
    let driver: MetaWhatsAppDriver;

    beforeEach(() => {
      driver = new MetaWhatsAppDriver();
    });

    describe('testConnection', () => {
      it('returns success true when phone ID is valid', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            id: 'phone_123',
            display_phone_number: '+1234567890',
          }),
        } as any);

        const res = await driver.testConnection({
          phoneNumberId: 'phone_123',
          accessToken: 'token_abc',
        });
        expect(res).toEqual({
          success: true,
          message: 'Connected Meta WhatsApp Phone ID +1234567890',
        });
      });

      it('returns success false when API returns error', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            error: { message: 'Invalid OAuth access token' },
          }),
        } as any);

        const res = await driver.testConnection({
          phoneNumberId: 'phone_123',
          accessToken: 'bad_token',
        });
        expect(res).toEqual({
          success: false,
          message: 'Invalid OAuth access token',
        });
      });

      it('handles missing credentials', async () => {
        const res = await driver.testConnection({});
        expect(res.success).toBe(false);
        expect(res.message).toContain('Missing phoneNumberId or accessToken');
      });
    });

    describe('sendMessage', () => {
      it('sends whatsapp message successfully', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            messages: [{ id: 'wamid.HBgL...' }],
          }),
        } as any);

        const res = await driver.sendMessage(
          { phoneNumberId: 'phone_123', accessToken: 'token_abc' },
          { recipient: '+123456789', body: 'Hello WhatsApp' },
        );

        expect(res.externalId).toBe('wamid.HBgL...');
      });

      it('throws error when API returns error object', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            error: { message: 'Recipient not opted in' },
          }),
        } as any);

        await expect(
          driver.sendMessage(
            { phoneNumberId: 'phone_123', accessToken: 'token_abc' },
            { recipient: '+123', body: 'Hi' },
          ),
        ).rejects.toThrow('Recipient not opted in');
      });
    });

    describe('parseWebhookPayload', () => {
      it('parses valid whatsapp webhook payload', async () => {
        const payload = {
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: '15551234567',
                        id: 'wamid.999',
                        text: { body: 'Inbound message' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };

        const parsed = await driver.parseWebhookPayload({}, {}, payload);
        expect(parsed).toEqual({
          senderIdentifier: '15551234567',
          body: 'Inbound message',
          externalMessageId: 'wamid.999',
          rawPayload: payload,
        });
      });

      it('returns fallback text for media/non-text messages', async () => {
        const payload = {
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: '15551234567',
                        id: 'wamid.888',
                        type: 'image',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };

        const parsed = await driver.parseWebhookPayload({}, {}, payload);
        expect(parsed?.body).toBe('[Media/Unsupported Content]');
      });

      it('returns null for empty payload structure', async () => {
        const parsed = await driver.parseWebhookPayload({}, {}, {});
        expect(parsed).toBeNull();
      });
    });
  });

  describe('EmailSmtpDriver', () => {
    let driver: EmailSmtpDriver;
    let mockTransporter: any;

    beforeEach(() => {
      driver = new EmailSmtpDriver();
      mockTransporter = {
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn().mockResolvedValue({ messageId: '<msg123@smtp>' }),
      };
      (nodemailer.createTransport as jest.Mock).mockReturnValue(
        mockTransporter,
      );
    });

    describe('testConnection', () => {
      it('returns success true when verify passes', async () => {
        const res = await driver.testConnection({
          host: 'smtp.example.com',
          port: 587,
          user: 'user@example.com',
          pass: 'secret',
        });

        expect(res).toEqual({
          success: true,
          message: 'SMTP connection verified successfully',
        });
        expect(mockTransporter.verify).toHaveBeenCalled();
      });

      it('returns success false when missing host', async () => {
        const res = await driver.testConnection({});
        expect(res.success).toBe(false);
        expect(res.message).toContain('Missing SMTP host');
      });

      it('returns success false when verify fails', async () => {
        mockTransporter.verify.mockRejectedValue(
          new Error('Connection timeout'),
        );
        const res = await driver.testConnection({ host: 'smtp.example.com' });
        expect(res).toEqual({
          success: false,
          message: 'Connection timeout',
        });
      });
    });

    describe('sendMessage', () => {
      it('sends email successfully via SMTP', async () => {
        const res = await driver.sendMessage(
          { host: 'smtp.example.com', user: 'sender@example.com' },
          {
            recipient: 'dest@example.com',
            subject: 'Subject',
            body: 'Body content',
          },
        );

        expect(res.externalId).toBe('<msg123@smtp>');
        expect(mockTransporter.sendMail).toHaveBeenCalledWith({
          from: 'sender@example.com',
          to: 'dest@example.com',
          subject: 'Subject',
          text: 'Body content',
        });
      });

      it('throws error when missing host', async () => {
        await expect(
          driver.sendMessage({}, { recipient: 'dest@example.com', body: 'Hi' }),
        ).rejects.toThrow('Missing SMTP host');
      });
    });

    describe('parseWebhookPayload', () => {
      it('parses valid inbound SMTP webhook payload', async () => {
        const payload = {
          from: 'client@example.com',
          text: 'Email body test',
          'message-id': 'msg-001',
        };

        const parsed = await driver.parseWebhookPayload({}, {}, payload);
        expect(parsed).toEqual({
          senderIdentifier: 'client@example.com',
          body: 'Email body test',
          externalMessageId: 'msg-001',
          rawPayload: payload,
        });
      });

      it('returns null if sender missing', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          { text: 'no sender' },
        );
        expect(parsed).toBeNull();
      });
    });
  });

  describe('EmailResendDriver', () => {
    let driver: EmailResendDriver;
    let mockResendInstance: any;

    beforeEach(() => {
      driver = new EmailResendDriver();
      mockResendInstance = {
        apiKeys: {
          list: jest.fn().mockResolvedValue({ data: [] }),
        },
        emails: {
          send: jest
            .fn()
            .mockResolvedValue({ data: { id: 'resend_123' }, error: null }),
        },
      };
      (Resend as unknown as jest.Mock).mockImplementation(
        () => mockResendInstance,
      );
    });

    describe('testConnection', () => {
      it('returns success true when API key is valid', async () => {
        const res = await driver.testConnection({ apiKey: 're_12345' });
        expect(res).toEqual({
          success: true,
          message: 'Resend API key verified successfully',
        });
      });

      it('returns success false when missing API key', async () => {
        const res = await driver.testConnection({});
        expect(res.success).toBe(false);
        expect(res.message).toContain('Missing Resend API key');
      });

      it('returns success false when API returns error', async () => {
        mockResendInstance.apiKeys.list.mockResolvedValue({
          error: { message: 'Invalid API key' },
        });
        const res = await driver.testConnection({ apiKey: 'bad_key' });
        expect(res).toEqual({
          success: false,
          message: 'Invalid API key',
        });
      });
    });

    describe('sendMessage', () => {
      it('sends email successfully via Resend', async () => {
        const res = await driver.sendMessage(
          { apiKey: 're_123', fromEmail: 'sales@example.com' },
          {
            recipient: 'lead@example.com',
            subject: 'Demo',
            body: 'Resend email body',
          },
        );

        expect(res.externalId).toBe('resend_123');
        expect(mockResendInstance.emails.send).toHaveBeenCalledWith({
          from: 'sales@example.com',
          to: 'lead@example.com',
          subject: 'Demo',
          text: 'Resend email body',
        });
      });

      it('throws error when resend.emails.send returns error', async () => {
        mockResendInstance.emails.send.mockResolvedValue({
          data: null,
          error: { message: 'Domain not verified' },
        });

        await expect(
          driver.sendMessage(
            { apiKey: 're_123' },
            { recipient: 'lead@example.com', body: 'Hello' },
          ),
        ).rejects.toThrow('Domain not verified');
      });

      it('throws error when missing API key', async () => {
        await expect(
          driver.sendMessage({}, { recipient: 'test@example.com', body: 'Hi' }),
        ).rejects.toThrow('Missing Resend API key');
      });
    });

    describe('parseWebhookPayload', () => {
      it('parses valid resend webhook payload', async () => {
        const payload = {
          type: 'email.received',
          data: {
            from: 'customer@domain.com',
            text: 'Incoming resend webhook body',
            email_id: 're_inbound_999',
          },
        };

        const parsed = await driver.parseWebhookPayload({}, {}, payload);
        expect(parsed).toEqual({
          senderIdentifier: 'customer@domain.com',
          body: 'Incoming resend webhook body',
          externalMessageId: 're_inbound_999',
          rawPayload: payload,
        });
      });

      it('returns null if no sender found', async () => {
        const parsed = await driver.parseWebhookPayload({}, {}, {});
        expect(parsed).toBeNull();
      });
    });
  });
});
