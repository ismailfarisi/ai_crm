export interface OutboundPayload {
  recipient: string;
  body: string;
  subject?: string;
}

export interface ParsedWebhookMessage {
  senderIdentifier: string;
  body: string;
  externalMessageId?: string;
  rawPayload: Record<string, any>;
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
  ): Promise<ParsedWebhookMessage | null>;
  /** Providers whose webhook is registered via API call (e.g. Telegram's setWebhook) implement this. */
  registerWebhook?(
    credentials: Record<string, any>,
    webhookUrl: string,
  ): Promise<{ success: boolean; message: string }>;
}
