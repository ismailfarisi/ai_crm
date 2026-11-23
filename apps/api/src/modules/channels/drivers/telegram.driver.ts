import {
  ChannelDriver,
  InboundMedia,
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
    const msg = body?.message;
    if (!msg?.chat?.id) return null;
    const file = fileOf(msg);
    const text = typeof msg.text === 'string' ? msg.text : '';
    // Neither words nor a file: a join, a pin, a location. Not a message.
    if (!text && !file) return null;
    const caption =
      typeof msg.caption === 'string' && msg.caption.trim()
        ? msg.caption
        : undefined;
    const kept: InboundMedia | undefined = file
      ? { ...file.media, ...(caption ? { caption } : {}) }
      : undefined;
    return {
      senderIdentifier: String(msg.chat.id),
      body:
        text ||
        caption ||
        (kept?.filename
          ? `[Document: ${kept.filename}]`
          : `[${file?.label ?? 'File'}]`),
      externalMessageId: String(msg.message_id),
      rawPayload: body,
      // Only a picture or a document can be a receipt or an invoice.
      ...(kept && file?.actionable ? { media: kept } : {}),
      // An album arrives as one message per file, each with its own id, so
      // one file here is the whole of it.
      ...(kept ? { files: [kept] } : {}),
    };
  }

  /**
   * Two calls: getFile turns the id into a path that is good for an hour,
   * and the path is fetched with the same token. Telegram lets a bot download
   * files of up to 20 MB; a larger one fails at getFile.
   */
  async downloadMedia(
    credentials: Record<string, any>,
    mediaId: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!credentials?.botToken) {
      throw new Error('Missing botToken in credentials');
    }
    const info = await fetch(
      `https://api.telegram.org/bot${credentials.botToken}/getFile?file_id=${encodeURIComponent(mediaId)}`,
    );
    const data = await info.json();
    const path = data?.result?.file_path as string | undefined;
    if (!data?.ok || !path) {
      throw new Error(data?.description || 'Telegram did not return the file');
    }
    if (Number(data.result.file_size) > maxBytes) {
      throw new Error('The file is too large to read');
    }
    const res = await fetch(
      `https://api.telegram.org/file/bot${credentials.botToken}/${path}`,
    );
    if (!res.ok) {
      throw new Error(`Telegram file download failed (${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error('The file is too large to read');
    }
    // Telegram serves every file as a plain download, so the type comes
    // from the path; the message that carried the file knows it better.
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return {
      buffer,
      mimeType: TYPE_BY_EXTENSION[ext] ?? 'application/octet-stream',
    };
  }
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/**
 * The file a Telegram message carries, if any. A photo comes as several
 * sizes of one picture; the last is the largest.
 */
function fileOf(
  msg: any,
): { media: InboundMedia; label: string; actionable: boolean } | null {
  const photo = Array.isArray(msg.photo)
    ? msg.photo[msg.photo.length - 1]
    : null;
  if (photo?.file_id) {
    return {
      media: { id: String(photo.file_id), mimeType: 'image/jpeg' },
      label: 'Image',
      actionable: true,
    };
  }
  const kinds: [string, string, string][] = [
    ['document', 'Document', 'application/octet-stream'],
    ['video', 'Video', 'video/mp4'],
    ['audio', 'Audio', 'audio/mpeg'],
    ['voice', 'Voice message', 'audio/ogg'],
    ['video_note', 'Video', 'video/mp4'],
    ['sticker', 'Sticker', 'image/webp'],
  ];
  for (const [key, label, fallbackType] of kinds) {
    const f = msg[key];
    if (!f?.file_id) continue;
    return {
      media: {
        id: String(f.file_id),
        mimeType: String(f.mime_type || fallbackType)
          .split(';')[0]
          .trim()
          .toLowerCase(),
        ...(f.file_name ? { filename: String(f.file_name) } : {}),
      },
      label,
      actionable: key === 'document',
    };
  }
  return null;
}
