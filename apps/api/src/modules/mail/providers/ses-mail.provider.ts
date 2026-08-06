import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2';
import type { AppConfig } from '@/config/configuration';
import { MailProvider, type InviteMail } from '../mail.types';

/**
 * Amazon SES provider. Credentials come from the AWS SDK's default chain
 * (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars, ~/.aws/credentials,
 * an IAM role on EC2/EKS, ...) — never from .env.
 */
@Injectable()
export class SesMailProvider implements MailProvider {
  readonly name = 'ses';
  private readonly logger = new Logger(SesMailProvider.name);
  private readonly client: SESv2Client;
  private readonly from: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const mail = config.get('mail', { infer: true });
    this.client = new SESv2Client({ region: mail.region });
    this.from = mail.from;
  }

  async sendInvite(mail: InviteMail): Promise<void> {
    const input: SendEmailCommandInput = {
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [mail.to] },
      Content: {
        Simple: {
          Subject: { Data: `You've been invited to ${mail.organizationName}` },
          Body: {
            Text: {
              Data: [
                `${mail.inviterName} invited you to join ${mail.organizationName} on Relay CRM.`,
                '',
                'Set your password and sign in here:',
                mail.acceptUrl,
                '',
                `This invite expires ${mail.expiresAt.toISOString()}.`,
              ].join('\n'),
            },
            Html: {
              Data: [
                '<p>',
                `${escapeHtml(mail.inviterName)} invited you to join <strong>${escapeHtml(mail.organizationName)}</strong> on Relay CRM.`,
                '</p>',
                `<p><a href="${escapeHtml(mail.acceptUrl)}">Set your password and sign in</a></p>`,
                `<p>This invite expires <time datetime="${mail.expiresAt.toISOString()}">${mail.expiresAt.toISOString()}</time>.</p>`,
              ].join('\n'),
            },
          },
        },
      },
    };

    await this.client.send(new SendEmailCommand(input));
    this.logger.log(`Sent invite email to ${mail.to}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
