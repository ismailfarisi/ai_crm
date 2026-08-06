import { Inject, Injectable } from '@nestjs/common';
import type { MailProvider } from './mail.types';
import { MAIL_PROVIDER } from './mail.types';

/** Facade over the active provider; callers depend on this, not on a concrete class. */
@Injectable()
export class MailService implements MailProvider {
  readonly name: string;

  constructor(@Inject(MAIL_PROVIDER) private readonly provider: MailProvider) {
    this.name = provider.name;
  }

  sendInvite(mail: Parameters<MailProvider['sendInvite']>[0]): Promise<void> {
    return this.provider.sendInvite(mail);
  }
}
