import { Injectable, Logger } from '@nestjs/common';
import { MailProvider, type InviteMail } from '../mail.types';

/**
 * Development provider: prints the invite email (including the clickable link)
 * to the API console instead of sending anything. This is the default so the
 * app works out of the box with zero external credentials.
 */
@Injectable()
export class ConsoleMailProvider implements MailProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleMailProvider.name);

  sendInvite(mail: InviteMail): Promise<void> {
    this.logger.log(
      [
        '',
        '┌──────────────────────────────────────────────────────────┐',
        '│  INVITE (console mail provider — not actually sent)       │',
        '└──────────────────────────────────────────────────────────┘',
        `To:      ${mail.to}`,
        `Org:     ${mail.organizationName}`,
        `Invited by: ${mail.inviterName}`,
        `Expires: ${mail.expiresAt.toISOString()}`,
        '',
        'Accept the invite:',
        mail.acceptUrl,
        '',
      ].join('\n'),
    );
    return Promise.resolve();
  }
}
