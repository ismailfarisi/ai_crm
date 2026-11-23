import { Resend } from 'resend';
import {
  ChannelDriver,
  InboundMedia,
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

    // The webhook names each attachment; the bytes are fetched afterwards.
    // An attachment id only means something beside its email's id, so the
    // reference carries both.
    const emailId = body?.data?.email_id;
    const attachments: any[] = Array.isArray(body?.data?.attachments)
      ? body.data.attachments
      : [];
    const files: InboundMedia[] = emailId
      ? attachments
          .filter((a) => a?.id)
          .map((a) => ({
            id: `${emailId}/${a.id}`,
            mimeType: String(a.content_type || 'application/octet-stream')
              .split(';')[0]
              .trim()
              .toLowerCase(),
            ...(a.filename ? { filename: String(a.filename) } : {}),
          }))
      : [];

    return {
      senderIdentifier: String(sender),
      body: String(messageBody),
      externalMessageId: externalId ? String(externalId) : undefined,
      rawPayload: body,
      ...(files.length ? { files } : {}),
    };
  }

  /**
   * Resend keeps a received email's attachments and hands out a download
   * link that lasts an hour, so the link is asked for each time.
   */
  async downloadMedia(
    credentials: Record<string, any>,
    mediaId: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!credentials?.apiKey) {
      throw new Error('Missing Resend API key in credentials');
    }
    const [emailId, attachmentId] = mediaId.split('/');
    if (!emailId || !attachmentId) {
      throw new Error('Not a Resend attachment reference');
    }
    const meta = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { Authorization: `Bearer ${credentials.apiKey}` } },
    );
    const info = await meta.json();
    if (!meta.ok || !info?.download_url) {
      throw new Error(info?.message || 'Resend did not return the file');
    }
    if (Number(info.size) > maxBytes) {
      throw new Error('The file is too large to read');
    }
    const res = await fetch(String(info.download_url));
    if (!res.ok) {
      throw new Error(`Resend file download failed (${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error('The file is too large to read');
    }
    return {
      buffer,
      mimeType: String(info.content_type || 'application/octet-stream')
        .split(';')[0]
        .trim()
        .toLowerCase(),
    };
  }
}
