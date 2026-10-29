import {
  ChannelDriver,
  InboundMedia,
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
    const file =
      msg.type === 'image'
        ? msg.image
        : msg.type === 'document'
          ? msg.document
          : null;
    const media: InboundMedia | undefined =
      file?.id && file?.mime_type
        ? {
            id: String(file.id),
            mimeType: String(file.mime_type).split(';')[0].trim().toLowerCase(),
            ...(file.filename ? { filename: String(file.filename) } : {}),
            ...(file.caption ? { caption: String(file.caption) } : {}),
          }
        : undefined;
    return {
      senderIdentifier: String(msg.from),
      body:
        msg.text?.body ||
        media?.caption ||
        (media
          ? media.filename
            ? `[Document: ${media.filename}]`
            : '[Image]'
          : '[Media/Unsupported Content]'),
      externalMessageId: String(msg.id),
      rawPayload: body,
      ...(media ? { media } : {}),
    };
  }

  /**
   * Two calls: the media id resolves to a short-lived URL, and that URL needs
   * the same token. Meta keeps the file for 30 days, so a confirmation that
   * arrives later can still fetch it.
   */
  async downloadMedia(
    credentials: Record<string, any>,
    mediaId: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!credentials?.accessToken) {
      throw new Error('Missing accessToken in credentials');
    }
    const auth = { Authorization: `Bearer ${credentials.accessToken}` };
    const meta = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(mediaId)}`,
      { headers: auth },
    );
    const info = await meta.json();
    if (!meta.ok || !info?.url) {
      throw new Error(
        info?.error?.message || 'WhatsApp did not return the file',
      );
    }
    if (Number(info.file_size) > maxBytes) {
      throw new Error('The file is too large to read');
    }
    const res = await fetch(String(info.url), { headers: auth });
    if (!res.ok)
      throw new Error(`WhatsApp file download failed (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes)
      throw new Error('The file is too large to read');
    return {
      buffer,
      mimeType: String(info.mime_type || res.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase(),
    };
  }
}
