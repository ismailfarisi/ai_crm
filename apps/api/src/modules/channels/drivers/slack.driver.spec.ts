import { createHmac } from 'crypto';
import { SlackDriver } from './slack.driver';

describe('SlackDriver', () => {
  const driver = new SlackDriver();
  const originalFetch = global.fetch;
  const signingSecret = 'test-signing-secret';
  const credentials = { botToken: 'xoxb-test', signingSecret };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function signedRequest(body: Record<string, any>) {
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', signingSecret)
      .update(`v0:${timestamp}:${rawBody.toString('utf8')}`)
      .digest('hex')}`;
    const headers = {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    };
    return { rawBody, headers, body };
  }

  describe('verifySlackSignature', () => {
    it('accepts a correctly signed request', () => {
      const { rawBody, headers, body } = signedRequest({
        type: 'event_callback',
      });
      expect(driver.verifySlackSignature(credentials, headers, rawBody)).toBe(
        true,
      );
      expect(body.type).toBe('event_callback');
    });

    it('rejects a wrong signature', () => {
      const { rawBody, headers } = signedRequest({ type: 'event_callback' });
      headers['x-slack-signature'] = 'v0=' + '0'.repeat(64);
      expect(driver.verifySlackSignature(credentials, headers, rawBody)).toBe(
        false,
      );
    });

    it('rejects a stale timestamp', () => {
      const { rawBody, headers } = signedRequest({ type: 'event_callback' });
      headers['x-slack-request-timestamp'] = String(
        Math.floor(Date.now() / 1000) - 3600,
      );
      expect(driver.verifySlackSignature(credentials, headers, rawBody)).toBe(
        false,
      );
    });

    it('fails closed without a raw body', () => {
      const { headers } = signedRequest({ type: 'event_callback' });
      expect(driver.verifySlackSignature(credentials, headers, undefined)).toBe(
        false,
      );
    });
  });

  describe('parseWebhookPayload', () => {
    it('parses a message keyed on the sender user id', async () => {
      const eventBody = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'C0123',
          user: 'U0456',
          text: 'hello from slack',
          client_msg_id: 'msg-1',
          ts: '1700000000.000100',
        },
      };
      const { rawBody, headers } = signedRequest(eventBody);
      const parsed = await driver.parseWebhookPayload(
        credentials,
        headers,
        eventBody,
        rawBody,
      );
      expect(parsed).toMatchObject({
        senderIdentifier: 'U0456',
        body: 'hello from slack',
        externalMessageId: 'msg-1',
      });
    });

    it('carries the first attached file as media with the text as caption', async () => {
      const eventBody = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'D0999',
          user: 'U0456',
          text: 'here is the quote',
          ts: '1700000000.000100',
          files: [
            {
              id: 'F0ABC',
              mimetype: 'application/pdf',
              name: 'quote.pdf',
              url_private_download: 'https://files.slack.com/quote.pdf',
            },
          ],
        },
      };
      const { rawBody, headers } = signedRequest(eventBody);
      const parsed = await driver.parseWebhookPayload(
        credentials,
        headers,
        eventBody,
        rawBody,
      );
      expect(parsed?.media).toEqual({
        id: 'F0ABC',
        mimeType: 'application/pdf',
        filename: 'quote.pdf',
        caption: 'here is the quote',
      });
    });

    it('reads a file upload, which Slack sends with the file_share subtype', async () => {
      const eventBody = {
        type: 'event_callback',
        event: {
          type: 'message',
          subtype: 'file_share',
          channel: 'D0999',
          user: 'U0456',
          text: 'fuel receipt',
          ts: '1700000000.000100',
          files: [{ id: 'F0RCPT', mimetype: 'image/jpeg', name: 'receipt.jpg' }],
        },
      };
      const { rawBody, headers } = signedRequest(eventBody);
      const parsed = await driver.parseWebhookPayload(
        credentials,
        headers,
        eventBody,
        rawBody,
      );
      expect(parsed?.senderIdentifier).toBe('U0456');
      expect(parsed?.media).toEqual({
        id: 'F0RCPT',
        mimeType: 'image/jpeg',
        filename: 'receipt.jpg',
        caption: 'fuel receipt',
      });
    });

    it('names the file when a file-only message has no text', async () => {
      const eventBody = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'D0999',
          user: 'U0456',
          ts: '1700000000.000100',
          files: [{ id: 'F0ABC', mimetype: 'image/png', name: 'shot.png' }],
        },
      };
      const { rawBody, headers } = signedRequest(eventBody);
      const parsed = await driver.parseWebhookPayload(
        credentials,
        headers,
        eventBody,
        rawBody,
      );
      expect(parsed?.body).toBe('[Slack file: shot.png]');
    });

    it('falls back to the event ts when there is no client_msg_id', async () => {
      const eventBody = {
        type: 'event_callback',
        event: {
          type: 'message',
          channel: 'D0999',
          user: 'U0456',
          text: 'dm',
          ts: '1700000000.000100',
        },
      };
      const { rawBody, headers } = signedRequest(eventBody);
      const parsed = await driver.parseWebhookPayload(
        credentials,
        headers,
        eventBody,
        rawBody,
      );
      expect(parsed?.externalMessageId).toBe('1700000000.000100');
    });

    it.each([
      ['bot message', { bot_id: 'B01', text: 'echo' }],
      ['edited message', { subtype: 'message_changed', text: 'edit' }],
      ['join notice', { subtype: 'channel_join' }],
    ])('ignores %s', async (_label, extra) => {
      const eventBody = {
        type: 'event_callback',
        event: { type: 'message', channel: 'C0123', user: 'U0456', ...extra },
      };
      const { rawBody, headers } = signedRequest(eventBody);
      expect(
        await driver.parseWebhookPayload(
          credentials,
          headers,
          eventBody,
          rawBody,
        ),
      ).toBeNull();
    });

    it('ignores non-message events', async () => {
      const eventBody = {
        type: 'event_callback',
        event: { type: 'reaction_added', channel: 'C0123' },
      };
      const { rawBody, headers } = signedRequest(eventBody);
      expect(
        await driver.parseWebhookPayload(
          credentials,
          headers,
          eventBody,
          rawBody,
        ),
      ).toBeNull();
    });

    it('throws on an invalid signature', async () => {
      const eventBody = { type: 'event_callback', event: { type: 'message' } };
      const { rawBody, headers } = signedRequest(eventBody);
      headers['x-slack-signature'] = 'v0=' + 'f'.repeat(64);
      await expect(
        driver.parseWebhookPayload(credentials, headers, eventBody, rawBody),
      ).rejects.toThrow('Invalid Slack request signature');
    });
  });

  describe('sendMessage', () => {
    it('posts directly to a channel id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ ok: true, ts: '1700.1' }),
      } as any);
      const res = await driver.sendMessage(credentials, {
        recipient: 'C0123',
        body: 'hi',
      });
      expect(res.externalId).toBe('1700.1');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          body: JSON.stringify({ channel: 'C0123', text: 'hi' }),
        }),
      );
    });

    it('opens a DM when the recipient is a user id', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue({
            ok: true,
            channel: { id: 'D0DM' },
          }),
        })
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue({ ok: true, ts: '1700.2' }),
        }) as any;
      const res = await driver.sendMessage(credentials, {
        recipient: 'U0456',
        body: 'hi',
      });
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://slack.com/api/conversations.open',
        expect.anything(),
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          body: JSON.stringify({ channel: 'D0DM', text: 'hi' }),
        }),
      );
      expect(res.externalId).toBe('1700.2');
    });
  });

  describe('downloadMedia', () => {
    it('resolves files.info then downloads with the bot token', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue({
            ok: true,
            file: {
              mimetype: 'application/pdf',
              url_private_download: 'https://files.slack.com/quote.pdf',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
        }) as any;
      const res = await driver.downloadMedia(credentials, 'F0ABC', 1024);
      expect(res.buffer).toEqual(Buffer.from([1, 2, 3]));
      expect(res.mimeType).toBe('application/pdf');
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://files.slack.com/quote.pdf',
        expect.objectContaining({
          headers: { Authorization: 'Bearer xoxb-test' },
        }),
      );
    });

    it('rejects files larger than the limit', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue({
            ok: true,
            file: {
              mimetype: 'application/pdf',
              url_private_download: 'https://files.slack.com/big.pdf',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array(10).buffer),
        }) as any;
      await expect(
        driver.downloadMedia(credentials, 'F0ABC', 5),
      ).rejects.toThrow('exceeds');
    });
  });

  describe('testConnection', () => {
    it('reports the workspace when auth.test succeeds', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: jest
          .fn()
          .mockResolvedValue({ ok: true, team: 'Acme', user: 'kerf_bot' }),
      } as any);
      const res = await driver.testConnection(credentials);
      expect(res.success).toBe(true);
      expect(res.message).toContain('Acme');
    });

    it('fails without credentials', async () => {
      expect((await driver.testConnection({})).success).toBe(false);
      expect(
        (await driver.testConnection({ botToken: 'xoxb-x' })).success,
      ).toBe(false);
    });
  });
});
