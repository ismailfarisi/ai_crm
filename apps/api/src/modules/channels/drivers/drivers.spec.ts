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
          senderName: 'Telegram user',
          body: 'Hello bot',
          externalMessageId: '42',
          rawPayload: payload,
        });
      });

      it('names the sender by name, then @username, never by the chat id', async () => {
        const named = await driver.parseWebhookPayload(
          {},
          {},
          {
            message: {
              message_id: 1,
              chat: { id: 77001 },
              from: {
                id: 77001,
                first_name: 'Sara',
                last_name: 'Ali',
                username: 'sara_a',
              },
              text: 'Hi',
            },
          },
        );
        expect(named?.senderName).toBe('Sara Ali');

        const handle = await driver.parseWebhookPayload(
          {},
          {},
          {
            message: {
              message_id: 2,
              chat: { id: 77001 },
              from: { id: 77001, username: 'sara_a' },
              text: 'Hi',
            },
          },
        );
        expect(handle?.senderName).toBe('@sara_a');

        const anonymous = await driver.parseWebhookPayload(
          {},
          {},
          {
            message: {
              message_id: 3,
              chat: { id: 77001 },
              from: { id: 77001 },
              text: 'Hi',
            },
          },
        );
        expect(anonymous?.senderName).toBe('Telegram user');
        expect(anonymous?.senderIdentifier).toBe('77001');
      });

      it('returns null for empty or non-text message', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          { message: {} },
        );
        expect(parsed).toBeNull();
      });

      it('ignores a message with neither words nor a file', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          {
            message: { message_id: 7, chat: { id: 1001 }, location: {} },
          },
        );
        expect(parsed).toBeNull();
      });

      it('reads a photo, taking the largest of the sizes Telegram sends', async () => {
        const payload = {
          message: {
            message_id: 43,
            chat: { id: 1001 },
            photo: [
              { file_id: 'small', width: 90, height: 60 },
              { file_id: 'large', width: 1280, height: 853 },
            ],
          },
        };
        const parsed = await driver.parseWebhookPayload({}, {}, payload);
        const photo = { id: 'large', mimeType: 'image/jpeg' };
        expect(parsed).toEqual({
          senderIdentifier: '1001',
          senderName: 'Telegram user',
          body: '[Image]',
          externalMessageId: '43',
          rawPayload: payload,
          media: photo,
          files: [photo],
        });
      });

      it('reads a document and the words sent with it', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          {
            message: {
              message_id: 44,
              chat: { id: 1001 },
              caption: 'Artwork for the shop sign',
              document: {
                file_id: 'doc-1',
                file_name: 'sign.pdf',
                mime_type: 'application/pdf',
              },
            },
          },
        );
        const doc = {
          id: 'doc-1',
          mimeType: 'application/pdf',
          filename: 'sign.pdf',
          caption: 'Artwork for the shop sign',
        };
        expect(parsed?.body).toBe('Artwork for the shop sign');
        expect(parsed?.media).toEqual(doc);
        expect(parsed?.files).toEqual([doc]);
      });

      it('names a document sent without words', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          {
            message: {
              message_id: 45,
              chat: { id: 1001 },
              document: { file_id: 'doc-2', file_name: 'logo.cdr' },
            },
          },
        );
        expect(parsed?.body).toBe('[Document: logo.cdr]');
        expect(parsed?.files?.[0].mimeType).toBe('application/octet-stream');
      });

      it('keeps a voice message but does not offer it to chat commands', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          {
            message: {
              message_id: 46,
              chat: { id: 1001 },
              voice: { file_id: 'voice-1', mime_type: 'audio/ogg' },
            },
          },
        );
        expect(parsed?.body).toBe('[Voice message]');
        expect(parsed?.media).toBeUndefined();
        expect(parsed?.files).toEqual([
          { id: 'voice-1', mimeType: 'audio/ogg' },
        ]);
      });
    });

    describe('downloadMedia', () => {
      it('resolves the file path, then downloads it with the bot token', async () => {
        const fetchMock = jest
          .fn()
          .mockResolvedValueOnce({
            json: async () => ({
              ok: true,
              result: { file_path: 'photos/file_7.jpg', file_size: 4 },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
          });
        global.fetch = fetchMock as any;

        const file = await driver.downloadMedia({ botToken: 'T' }, 'f/1', 100);

        expect(fetchMock).toHaveBeenNthCalledWith(
          1,
          'https://api.telegram.org/botT/getFile?file_id=f%2F1',
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
          2,
          'https://api.telegram.org/file/botT/photos/file_7.jpg',
        );
        expect(file.buffer).toHaveLength(4);
        expect(file.mimeType).toBe('image/jpeg');
      });

      it('refuses a file over the limit before downloading it', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce({
          json: async () => ({
            ok: true,
            result: { file_path: 'documents/big.pdf', file_size: 500 },
          }),
        });
        global.fetch = fetchMock as any;
        await expect(
          driver.downloadMedia({ botToken: 'T' }, 'big', 100),
        ).rejects.toThrow('too large');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it('reports what Telegram said when it will not give the file', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: async () => ({ ok: false, description: 'file is too big' }),
        }) as any;
        await expect(
          driver.downloadMedia({ botToken: 'T' }, 'x', 100),
        ).rejects.toThrow('file is too big');
      });
    });

    describe('registerWebhook', () => {
      it('calls Telegram setWebhook with the given URL', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({ ok: true, result: true }),
        } as any);

        const res = await driver.registerWebhook(
          { botToken: '12345:ABC' },
          'https://example.com/api/v1/webhooks/channels/TELEGRAM/org-1',
        );

        expect(res).toEqual({
          success: true,
          message: 'Telegram webhook registered',
        });
        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.telegram.org/bot12345:ABC/setWebhook',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              url: 'https://example.com/api/v1/webhooks/channels/TELEGRAM/org-1',
            }),
          }),
        );
      });

      it('returns success false when Telegram rejects the URL', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({
            ok: false,
            description: 'Bad webhook: HTTPS url must be provided',
          }),
        } as any);

        const res = await driver.registerWebhook(
          { botToken: '12345:ABC' },
          'http://not-https.example.com',
        );

        expect(res).toEqual({
          success: false,
          message: 'Bad webhook: HTTPS url must be provided',
        });
      });

      it('handles missing botToken gracefully', async () => {
        const res = await driver.registerWebhook(
          {},
          'https://example.com/hook',
        );
        expect(res.success).toBe(false);
        expect(res.message).toContain('Missing botToken');
      });

      it('handles fetch network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
        const res = await driver.registerWebhook(
          { botToken: '123' },
          'https://example.com/hook',
        );
        expect(res).toEqual({ success: false, message: 'Network error' });
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

      const whatsapp = (message: Record<string, unknown>) => ({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '15551234567', id: 'wamid.1', ...message },
                  ],
                },
              },
            ],
          },
        ],
      });

      it('lists a document both as the file to act on and as a file to keep', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          whatsapp({
            type: 'document',
            document: {
              id: 'media-1',
              mime_type: 'application/pdf',
              filename: 'artwork.pdf',
            },
          }),
        );
        const doc = {
          id: 'media-1',
          mimeType: 'application/pdf',
          filename: 'artwork.pdf',
        };
        expect(parsed?.body).toBe('[Document: artwork.pdf]');
        expect(parsed?.media).toEqual(doc);
        expect(parsed?.files).toEqual([doc]);
      });

      it('keeps a video or voice note without offering it to chat commands', async () => {
        const video = await driver.parseWebhookPayload(
          {},
          {},
          whatsapp({
            type: 'video',
            video: { id: 'media-2', mime_type: 'video/mp4' },
          }),
        );
        expect(video?.body).toBe('[Video]');
        expect(video?.media).toBeUndefined();
        expect(video?.files).toEqual([
          { id: 'media-2', mimeType: 'video/mp4' },
        ]);

        const voice = await driver.parseWebhookPayload(
          {},
          {},
          whatsapp({
            type: 'audio',
            audio: { id: 'media-3', mime_type: 'audio/ogg; codecs=opus' },
          }),
        );
        expect(voice?.body).toBe('[Voice message]');
        expect(voice?.files).toEqual([
          { id: 'media-3', mimeType: 'audio/ogg' },
        ]);
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

      it('lists every attachment, each tied to its email', async () => {
        const parsed = await driver.parseWebhookPayload(
          {},
          {},
          {
            type: 'email.received',
            data: {
              from: 'customer@domain.com',
              subject: 'Artwork for the banner',
              email_id: 'email-1',
              attachments: [
                {
                  id: 'att-1',
                  filename: 'banner.pdf',
                  content_type: 'application/pdf',
                },
                {
                  id: 'att-2',
                  filename: 'logo.png',
                  content_type: 'image/png; name=logo.png',
                },
              ],
            },
          },
        );
        expect(parsed?.body).toBe('Artwork for the banner');
        // Nothing a chat command acts on: email is not a staff command channel.
        expect(parsed?.media).toBeUndefined();
        expect(parsed?.files).toEqual([
          {
            id: 'email-1/att-1',
            mimeType: 'application/pdf',
            filename: 'banner.pdf',
          },
          { id: 'email-1/att-2', mimeType: 'image/png', filename: 'logo.png' },
        ]);
      });
    });

    describe('downloadMedia', () => {
      const originalFetch = global.fetch;
      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('asks Resend for a download link, then fetches it', async () => {
        const fetchMock = jest
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              download_url: 'https://inbound-cdn.resend.com/x?signature=s',
              content_type: 'application/pdf',
              size: 4,
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer,
          });
        global.fetch = fetchMock as never;

        const file = await driver.downloadMedia(
          { apiKey: 're_123' },
          'email-1/att-1',
          100,
        );

        expect(fetchMock).toHaveBeenNthCalledWith(
          1,
          'https://api.resend.com/emails/receiving/email-1/attachments/att-1',
          { headers: { Authorization: 'Bearer re_123' } },
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
          2,
          'https://inbound-cdn.resend.com/x?signature=s',
        );
        expect(file.mimeType).toBe('application/pdf');
        expect(file.buffer.toString()).toBe('%PDF');
      });

      it('refuses an attachment over the limit before downloading it', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ download_url: 'https://x', size: 500 }),
        });
        global.fetch = fetchMock as never;
        await expect(
          driver.downloadMedia({ apiKey: 're_123' }, 'email-1/att-1', 100),
        ).rejects.toThrow('too large');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it('refuses a reference that is not an email and an attachment', async () => {
        await expect(
          driver.downloadMedia({ apiKey: 're_123' }, 'att-1', 100),
        ).rejects.toThrow('Not a Resend attachment reference');
      });
    });
  });

  describe('MetaWhatsAppDriver media', () => {
    const driver = new MetaWhatsAppDriver();
    const payload = (message: Record<string, unknown>) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '971500000000', id: 'wamid.1', ...message }],
              },
            },
          ],
        },
      ],
    });

    it('reads a document as a file reference, keeping its caption apart', async () => {
      const parsed = await driver.parseWebhookPayload(
        {},
        {},
        payload({
          type: 'document',
          document: {
            id: 'media-9',
            mime_type: 'application/pdf',
            filename: 'INV-7781.pdf',
            caption: 'for PO 31',
          },
        }),
      );
      expect(parsed?.media).toEqual({
        id: 'media-9',
        mimeType: 'application/pdf',
        filename: 'INV-7781.pdf',
        caption: 'for PO 31',
      });
      expect(parsed?.body).toBe('for PO 31');
    });

    it('names a captionless photo in the inbox', async () => {
      const parsed = await driver.parseWebhookPayload(
        {},
        {},
        payload({
          type: 'image',
          image: { id: 'media-3', mime_type: 'image/jpeg; codecs=x' },
        }),
      );
      expect(parsed?.media).toEqual({ id: 'media-3', mimeType: 'image/jpeg' });
      expect(parsed?.body).toBe('[Image]');
    });

    it('downloads a file in two calls, with the token on both', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            url: 'https://lookaside.example/f',
            mime_type: 'application/pdf',
            file_size: 4,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer,
        }) as never;

      const file = await driver.downloadMedia(
        { accessToken: 'tok' },
        'media-9',
        1000,
      );

      expect(file.mimeType).toBe('application/pdf');
      expect(file.buffer.toString()).toBe('%PDF');
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls[0][0]).toBe('https://graph.facebook.com/v19.0/media-9');
      expect(calls[1][0]).toBe('https://lookaside.example/f');
      for (const [, init] of calls)
        expect(init.headers.Authorization).toBe('Bearer tok');
    });

    it('refuses a file over the limit before downloading it', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.example/f',
          mime_type: 'application/pdf',
          file_size: 5000,
        }),
      }) as never;
      await expect(
        driver.downloadMedia({ accessToken: 'tok' }, 'media-9', 1000),
      ).rejects.toThrow('too large');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
