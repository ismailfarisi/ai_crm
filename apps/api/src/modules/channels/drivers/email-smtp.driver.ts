import * as nodemailer from 'nodemailer';
import { ChannelDriver, OutboundPayload, ParsedWebhookMessage } from '../interfaces/channel-driver.interface';

export class EmailSmtpDriver implements ChannelDriver {
  private createTransporter(credentials: Record<string, any>) {
    const port = credentials.port ? Number(credentials.port) : 587;
    return nodemailer.createTransport({
      host: credentials.host,
      port,
      secure: credentials.secure !== undefined ? Boolean(credentials.secure) : port === 465,
      auth: (credentials.user || credentials.auth?.user) ? {
        user: credentials.user || credentials.auth?.user,
        pass: credentials.pass || credentials.password || credentials.auth?.pass,
      } : undefined,
    });
  }

  async testConnection(credentials: Record<string, any>): Promise<{ success: boolean; message: string }> {
    try {
      if (!credentials?.host) {
        return { success: false, message: 'Missing SMTP host in credentials' };
      }
      const transporter = this.createTransporter(credentials);
      await transporter.verify();
      return { success: true, message: 'SMTP connection verified successfully' };
    } catch (err: any) {
      return { success: false, message: err.message || 'SMTP connection failed' };
    }
  }

  async sendMessage(credentials: Record<string, any>, payload: OutboundPayload) {
    if (!credentials?.host) {
      throw new Error('Missing SMTP host in credentials');
    }
    const transporter = this.createTransporter(credentials);
    const from = credentials.fromEmail || credentials.from || credentials.user || credentials.auth?.user;
    const info = await transporter.sendMail({
      from,
      to: payload.recipient,
      subject: payload.subject || 'No Subject',
      text: payload.body,
    });
    return { externalId: info.messageId, rawResponse: info };
  }

  async parseWebhookPayload(_credentials: Record<string, any>, _headers: any, body: any): Promise<ParsedWebhookMessage | null> {
    const sender = body?.from || body?.sender || body?.envelope?.from;
    if (!sender) return null;
    const messageBody = body?.text || body?.['stripped-text'] || body?.body || body?.html || '';
    return {
      senderIdentifier: String(sender),
      body: String(messageBody),
      externalMessageId: body?.['message-id'] || body?.messageId || body?.id ? String(body['message-id'] || body.messageId || body.id) : undefined,
      rawPayload: body,
    };
  }
}
