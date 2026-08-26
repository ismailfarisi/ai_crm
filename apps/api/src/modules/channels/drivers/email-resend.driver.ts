import { Resend } from 'resend';
import {
  ChannelDriver,
  OutboundPayload,
  ParsedWebhookMessage,
} from '../interfaces/channel-driver.interface';

export class EmailResendDriver implements ChannelDriver {
  async testConnection(
    credentials: Record<string, any>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!credentials?.apiKey) {
        return {
          success: false,
          message: 'Missing Resend API key in credentials',
        };
      }
      const resend = new Resend(credentials.apiKey);
      const res = await resend.apiKeys.list();
      if (res.error) {
        return {
          success: false,
          message: res.error.message || 'Resend API key verification failed',
        };
      }
      return { success: true, message: 'Resend API key verified successfully' };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Resend connection failed',
      };
    }
  }

  async sendMessage(
    credentials: Record<string, any>,
    payload: OutboundPayload,
  ) {
    if (!credentials?.apiKey) {
      throw new Error('Missing Resend API key in credentials');
    }
    const resend = new Resend(credentials.apiKey);
    const from =
      credentials.fromEmail || credentials.from || 'onboarding@resend.dev';
    const res = await resend.emails.send({
      from,
      to: payload.recipient,
      subject: payload.subject || 'No Subject',
      text: payload.body,
    });

    if (res.error) {
      throw new Error(res.error.message || 'Failed to send email via Resend');
    }

    return { externalId: res.data?.id, rawResponse: res };
  }

  async parseWebhookPayload(
    _credentials: Record<string, any>,
    _headers: any,
    body: any,
  ): Promise<ParsedWebhookMessage | null> {
    const sender = body?.data?.from || body?.from;
    if (!sender) return null;

    const messageBody =
      body?.data?.text ||
      body?.text ||
      body?.data?.subject ||
      body?.subject ||
      '';
    const externalId = body?.data?.email_id || body?.data?.id || body?.id;

    return {
      senderIdentifier: String(sender),
      body: String(messageBody),
      externalMessageId: externalId ? String(externalId) : undefined,
      rawPayload: body,
    };
  }
}
