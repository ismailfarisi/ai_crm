import { Column, Entity, Index, Unique } from 'typeorm';
import { TenantBaseEntity } from '@/common/entities/base.entity';

export enum EmailProviderType {
  GMAIL_OAUTH = 'GMAIL_OAUTH',
  IMAP_SMTP = 'IMAP_SMTP',
}

export enum EmailSyncStatus {
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
  PAUSED = 'PAUSED',
}

/**
 * A mailbox one user connected — Google OAuth, or an IMAP/SMTP app password.
 * Credentials are AES-256-GCM encrypted via ChannelCryptoService and never
 * leave the API.
 */
@Entity('email_accounts')
@Unique('UQ_email_accounts_tenant_user_address', [
  'tenantId',
  'userId',
  'emailAddress',
])
@Index('IDX_email_accounts_tenant', ['tenantId'])
export class EmailAccount extends TenantBaseEntity {
  /** The CRM user who connected this mailbox. */
  @Column('uuid')
  @Index('IDX_email_accounts_user')
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  emailAddress: string;

  /** Display name Google reported for this mailbox. */
  @Column({ type: 'varchar', length: 255, default: '' })
  name: string;

  @Column({
    type: 'enum',
    enum: EmailProviderType,
    default: EmailProviderType.GMAIL_OAUTH,
  })
  providerType: EmailProviderType;

  /** OAuth tokens or { username, appPassword } — encrypted at rest. */
  @Column({ type: 'text', nullable: true })
  encryptedCredentials: string | null;

  /**
   * Incremental-sync cursor. Gmail stores a `historyId`; IMAP stores a JSON
   * map of `{ mailboxPath: "uidvalidity:lastUid" }` per watched mailbox.
   */
  @Column({ type: 'text', nullable: true })
  syncCursor: string | null;

  /**
   * A shared mailbox is visible to every `email:read` holder in the tenant,
   * not just the user who connected it.
   */
  @Column({ type: 'boolean', default: false })
  isShared: boolean;

  @Column({
    type: 'enum',
    enum: EmailSyncStatus,
    default: EmailSyncStatus.ACTIVE,
  })
  syncStatus: EmailSyncStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  syncError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;
}
