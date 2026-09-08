import {
  ChannelDriver,
  OutboundPayload,
  ParsedWebhookMessage,
} from '../interfaces/channel-driver.interface';

export class TelegramDriver implements ChannelDriver {
  async testConnection(
    credentials: Record<string, any>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!credentials?.botToken) {
        return { success: false, message: 'Missing botToken in credentials' };
      }
      const res = await fetch(
        `https://api.telegram.org/bot${credentials.botToken}/getMe`,
      );
      const data = await res.json();
      if (data.ok) {
        return {
          success: true,
          message: `Connected to Telegram bot @${data.result.username}`,
        };
      }
      return {
        success: false,
        message: data.description || 'Telegram auth failed',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to connect to Telegram',
      };
    }
  }

  async sendMessage(
    credentials: Record<string, any>,
    payload: OutboundPayload,
  ) {
    if (!credentials?.botToken) {
      throw new Error('Missing botToken in credentials');
    }
    const res = await fetch(
      `https://api.telegram.org/bot${credentials.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: payload.recipient,
          text: payload.body,
        }),
      },
    );
    const data = await res.json();
    if (!data.ok)
      throw new Error(data.description || 'Failed to send Telegram message');
    return { externalId: String(data.result.message_id), rawResponse: data };
  }

  async registerWebhook(
    credentials: Record<string, any>,
    webhookUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!credentials?.botToken) {
      return { success: false, message: 'Missing botToken in credentials' };
    }
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${credentials.botToken}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl }),
        },
      );
      const data = await res.json();
      if (!data.ok) {
        return {
          success: false,
          message: data.description || 'Telegram rejected the webhook URL',
        };
      }
      return { success: true, message: 'Telegram webhook registered' };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to register Telegram webhook',
      };
    }
  }

  async parseWebhookPayload(
    _credentials: Record<string, any>,
    _headers: any,
    body: any,
  ): Promise<ParsedWebhookMessage | null> {
    if (!body?.message?.text) return null;
    return {
      senderIdentifier: String(body.message.chat.id),
      body: body.message.text,
      externalMessageId: String(body.message.message_id),
      rawPayload: body,
    };
  }
}
