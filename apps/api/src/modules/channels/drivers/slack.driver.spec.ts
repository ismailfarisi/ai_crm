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
    it('parses a channel message keyed on the channel id', async () => {
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
        senderIdentifier: 'C0123',
        body: 'hello from slack',
        externalMessageId: 'msg-1',
      });
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
