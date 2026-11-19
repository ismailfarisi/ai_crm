import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { TenantBaseEntity } from '@/common/entities/base.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { EmailAccount } from './email-account.entity';

export enum EmailFolder {
  INBOX = 'INBOX',
  SENT = 'SENT',
  DRAFTS = 'DRAFTS',
  ARCHIVE = 'ARCHIVE',
  SPAM = 'SPAM',
  TRASH = 'TRASH',
}

@Entity('email_threads')
@Unique('UQ_email_threads_account_thread', ['emailAccountId', 'gmailThreadId'])
@Index('idx_email_threads_tenant_folder', ['tenantId', 'folder'])
@Index('idx_email_threads_tenant_last_message', ['tenantId', 'lastMessageAt'])
export class EmailThread extends TenantBaseEntity {
  @Column('uuid')
  @Index('IDX_email_threads_account')
  emailAccountId: string;

  @ManyToOne(() => EmailAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'emailAccountId' })
  emailAccount: EmailAccount;

  /** The provider's own thread id — Gmail hands us threading for free. */
  @Column({ type: 'varchar', length: 64 })
  gmailThreadId: string;

  /** The contact this thread was auto-associated with, if any. */
  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_email_threads_contact')
  contactId: string | null;

  @ManyToOne(() => Contact, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'contactId' })
  contact: Contact | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  subject: string;

  @Column({ type: 'text', default: '' })
  snippet: string;

  @Column({ type: 'enum', enum: EmailFolder, default: EmailFolder.INBOX })
  folder: EmailFolder;

  @Column({ type: 'boolean', default: true })
  isRead: boolean;

  @Column({ type: 'boolean', default: false })
  isStarred: boolean;

  /** Every distinct address seen on the thread, account's own included. */
  @Column({ type: 'jsonb', default: [] })
  participants: string[];

  @Column({ type: 'timestamptz' })
  lastMessageAt: Date;

  @Column({ type: 'integer', default: 0 })
  messageCount: number;
}
