import {
  ChannelDriver,
  OutboundPayload,
  ParsedWebhookMessage,
} from '../interfaces/channel-driver.interface';

export class MetaWhatsAppDriver implements ChannelDriver {
  async testConnection(
    credentials: Record<string, any>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!credentials?.phoneNumberId || !credentials?.accessToken) {
        return {
          success: false,
          message: 'Missing phoneNumberId or accessToken in credentials',
        };
      }
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${credentials.phoneNumberId}`,
        {
          headers: { Authorization: `Bearer ${credentials.accessToken}` },
        },
      );
      const data = await res.json();
      if (data.id) {
        return {
          success: true,
          message: `Connected Meta WhatsApp Phone ID ${data.display_phone_number || data.id}`,
        };
      }
      return {
        success: false,
        message: data.error?.message || 'Meta WhatsApp auth failed',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to connect to Meta WhatsApp',
      };
    }
  }

  async sendMessage(
    credentials: Record<string, any>,
    payload: OutboundPayload,
  ) {
    if (!credentials?.phoneNumberId || !credentials?.accessToken) {
      throw new Error('Missing phoneNumberId or accessToken in credentials');
    }
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: payload.recipient,
          type: 'text',
          text: { body: payload.body },
        }),
      },
    );
    const data = await res.json();
    if (data.error)
      throw new Error(data.error.message || 'Failed to send WhatsApp message');
    return { externalId: data.messages?.[0]?.id, rawResponse: data };
  }

  async parseWebhookPayload(
    _credentials: Record<string, any>,
    _headers: any,
    body: any,
  ): Promise<ParsedWebhookMessage | null> {
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return null;
    return {
      senderIdentifier: String(msg.from),
      body: msg.text?.body || '[Media/Unsupported Content]',
      externalMessageId: String(msg.id),
      rawPayload: body,
    };
  }
}
