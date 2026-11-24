export interface OutboundPayload {
  recipient: string;
  body: string;
  subject?: string;
  /**
   * Send as an approved template instead of free text (WhatsApp only), for a
   * customer outside the 24-hour window. `body` is still what is recorded.
   */
  template?: { name: string; language: string; parameters: string[] };
}

/**
 * A file that arrived with a message. Only a reference: the bytes are fetched
 * when a skill needs them, so a photo nobody acts on is never downloaded.
 * Serialisable, so a conversation can carry it between turns.
 */
export interface InboundMedia {
  /** The provider's id for the file, as its download API expects it. */
  id: string;
  mimeType: string;
  filename?: string;
  /** Text sent with the file. `body` already shows it; this is it alone. */
  caption?: string;
}

export interface ParsedWebhookMessage {
  senderIdentifier: string;
  /**
   * What to call the sender when a contact is made for them: their name, a
   * handle, or the channel's word for someone anonymous. Never the bare id.
   */
  senderName?: string;
  /** What the inbox shows. For a file, its caption or a placeholder naming it. */
  body: string;
  externalMessageId?: string;
  rawPayload: Record<string, any>;
  /**
   * The one file a chat command can act on (a receipt, a supplier invoice):
   * the first image or document. Voice notes and videos are not offered.
   */
  media?: InboundMedia;
  /** Every file that came with the message, to be kept and shown in the inbox. */
  files?: InboundMedia[];
}

export interface ChannelDriver {
  testConnection(
    credentials: Record<string, any>,
  ): Promise<{ success: boolean; message: string }>;
  sendMessage(
    credentials: Record<string, any>,
    payload: OutboundPayload,
  ): Promise<{ externalId?: string; rawResponse?: any }>;
  parseWebhookPayload(
    credentials: Record<string, any>,
    headers: any,
    body: any,
    rawBody?: Buffer,
  ): Promise<ParsedWebhookMessage | null>;
  /** Providers whose webhook is registered via API call (e.g. Telegram's setWebhook) implement this. */
  registerWebhook?(
    credentials: Record<string, any>,
    webhookUrl: string,
  ): Promise<{ success: boolean; message: string }>;
  /** Providers that deliver files by reference implement this. */
  downloadMedia?(
    credentials: Record<string, any>,
    mediaId: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: string }>;
}
