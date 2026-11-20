import { createHmac, timingSafeEqual } from 'crypto';
import {
  ChannelDriver,
  OutboundPayload,
  ParsedWebhookMessage,
} from '../interfaces/channel-driver.interface';

const SLACK_API = 'https://slack.com/api';
/** Slack rejects signatures on requests older than five minutes. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

interface SlackEventBody {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    client_msg_id?: string;
    thread_ts?: string;
    files?: {
      id: string;
      mimetype?: string;
      name?: string;
      url_private_download?: string;
      url_private?: string;
    }[];
  };
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  team?: string;
  user?: string;
  ts?: string;
  channel?: { id: string };
}

export class SlackDriver implements ChannelDriver {
  async testConnection(
    credentials: Record<string, any>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const botToken = credentials?.botToken as string | undefined;
      if (!botToken) {
        return { success: false, message: 'Missing botToken in credentials' };
      }
      if (!credentials?.signingSecret) {
        return {
          success: false,
          message: 'Missing signingSecret in credentials',
        };
      }
      const data = await this.apiCall(botToken, 'auth.test');
      if (data.ok) {
        return {
          success: true,
          message: `Connected to Slack workspace ${data.team ?? 'unknown'} as ${data.user ?? 'bot'}`,
        };
      }
      return { success: false, message: data.error || 'Slack auth failed' };
    } catch (err) {
      return {
        success: false,
        message:
          err instanceof Error ? err.message : 'Failed to connect to Slack',
      };
    }
  }

  async sendMessage(
    credentials: Record<string, any>,
    payload: OutboundPayload,
  ) {
    const botToken = credentials?.botToken as string | undefined;
    if (!botToken) {
      throw new Error('Missing botToken in credentials');
    }
    // Recipient is whatever came in as senderIdentifier — a channel id for
    // posts into a shared channel or the DM channel id for a 1:1. A bare
    // user id needs a DM opened first.
    let channel = payload.recipient;
    if (channel.startsWith('U') || channel.startsWith('W')) {
      const opened = await this.apiCall(botToken, 'conversations.open', {
        users: channel,
      });
      if (!opened.ok || !opened.channel) {
        throw new Error(
          opened.error || 'Failed to open a Slack DM with that user',
        );
      }
      channel = opened.channel.id;
    }
    const data = await this.apiCall(botToken, 'chat.postMessage', {
      channel,
      text: payload.body,
    });
    if (!data.ok) throw new Error(data.error || 'Failed to send Slack message');
    return { externalId: data.ts, rawResponse: data };
  }

  /**
   * Slack signs every Events API request: v0:timestamp:rawbody HMAC-SHA256'd
   * with the app's signing secret. The timestamp window stops replayed
   * requests older than five minutes.
   */
  verifySlackSignature(
    credentials: Record<string, any>,
    headers: any,
    rawBody?: Buffer,
  ): boolean {
    const signingSecret = credentials?.signingSecret as string | undefined;
    const h = headers as Record<string, unknown> | undefined;
    const timestamp =
      typeof h?.['x-slack-request-timestamp'] === 'string'
        ? h['x-slack-request-timestamp']
        : undefined;
    const signature =
      typeof h?.['x-slack-signature'] === 'string'
        ? h['x-slack-signature']
        : undefined;
    if (!signingSecret || !timestamp || !signature || !rawBody) return false;
    if (
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) >
      SIGNATURE_TOLERANCE_SECONDS
    ) {
      return false;
    }
    const expected = `v0=${createHmac('sha256', signingSecret)
      .update(`v0:${timestamp}:${rawBody.toString('utf8')}`)
      .digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhookPayload(
    credentials: Record<string, any>,
    headers: any,
    body: SlackEventBody,
    rawBody?: Buffer,
  ): Promise<ParsedWebhookMessage | null> {
    if (!this.verifySlackSignature(credentials, headers, rawBody)) {
      // url_verification is handled in the service before this is reached; a
      // failed signature here means a forged or replayed event.
      return Promise.reject(new Error('Invalid Slack request signature'));
    }
    if (body?.type !== 'event_callback') return Promise.resolve(null);
    const event = body.event;
    if (event?.type !== 'message' || !event.channel) {
      return Promise.resolve(null);
    }
    // Subtyped events (edits, deletes, joins) and anything from a bot —
    // including our own echoes — are not customer messages. A message sent
    // with a file is the exception: Slack marks it `file_share`.
    const subtyped = event.subtype && event.subtype !== 'file_share';
    if (subtyped || event.bot_id || !event.user) {
      return Promise.resolve(null);
    }
    const text = (event.text ?? '').trim();
    const file = event.files?.[0];
    const media = file
      ? {
          id: file.id,
          mimeType: file.mimetype ?? 'application/octet-stream',
          filename: file.name,
          caption: text || undefined,
        }
      : undefined;
    return Promise.resolve({
      // The user, not the channel: each Slack user gets their own contact
      // and conversation, and a reply DMs them (conversations.open on send).
      senderIdentifier: event.user,
      body:
        text ||
        (file
          ? `[Slack file: ${file.name ?? file.id}]`
          : '(Slack message without text)'),
      externalMessageId: event.client_msg_id ?? event.ts,
      rawPayload: body as Record<string, any>,
      media,
    });
  }

  /**
   * Slack files are fetched by reference: files.info resolves the private
   * download URL, then the bytes stream with the bot token. Needs files:read.
   */
  async downloadMedia(
    credentials: Record<string, any>,
    mediaId: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const botToken = credentials?.botToken as string | undefined;
    if (!botToken) throw new Error('Missing botToken in credentials');
    const info = await fetch(`${SLACK_API}/files.info?file=${mediaId}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = (await info.json()) as {
      ok: boolean;
      error?: string;
      file?: {
        mimetype?: string;
        url_private_download?: string;
        url_private?: string;
      };
    };
    const url = data.file?.url_private_download ?? data.file?.url_private;
    if (!data.ok || !url) {
      throw new Error(data.error || 'Slack file has no download URL');
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) {
      throw new Error(`Slack file download failed with ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Slack file exceeds the ${maxBytes}-byte limit`);
    }
    return {
      buffer,
      mimeType: data.file?.mimetype ?? 'application/octet-stream',
    };
  }

  private async apiCall(
    botToken: string,
    method: string,
    body?: Record<string, any>,
  ): Promise<SlackApiResponse> {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as SlackApiResponse;
  }
}
