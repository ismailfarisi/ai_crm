/**
 * Provider abstraction for transactional email. Add a new provider by
 * implementing `MailProvider` and registering it in `mail.module.ts` — nothing
 * else in the app needs to change.
 */
export interface MailProvider {
  /** Send a "you've been invited to X" email. */
  sendInvite(mail: InviteMail): Promise<void>;
  readonly name: string;
}

/** DI token for the active mail provider. */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

export interface InviteMail {
  to: string;
  organizationName: string;
  inviterName: string;
  /** Absolute URL to the accept-invite page, including the token. */
  acceptUrl: string;
  expiresAt: Date;
}
