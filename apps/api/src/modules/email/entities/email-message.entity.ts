import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { TenantBaseEntity } from '@/common/entities/base.entity';
import { EmailAttachment } from './email-attachment.entity';
import { EmailThread } from './email-thread.entity';

export enum EmailDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum EmailMessageStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  RECEIVED = 'RECEIVED',
}

@Entity('email_messages')
@Unique('UQ_email_messages_account_message', [
  'emailAccountId',
  'gmailMessageId',
])
@Index('idx_email_messages_tenant_thread', ['tenantId', 'threadId'])
export class EmailMessage extends TenantBaseEntity {
  @Column('uuid')
  threadId: string;

  @ManyToOne(() => EmailThread, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'threadId' })
  thread: EmailThread;

  /** Denormalised so (account, provider id) stays unique across re-threads. */
  @Column('uuid')
  @Index('IDX_email_messages_account')
  emailAccountId: string;

  /** The provider's immutable message id. */
  @Column({ type: 'varchar', length: 64 })
  gmailMessageId: string;

  /** RFC822 Message-ID header — used to thread our own replies. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  messageIdHeader: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  inReplyToHeader: string | null;

  @Column({ type: 'enum', enum: EmailDirection })
  direction: EmailDirection;

  @Column({ type: 'varchar', length: 255 })
  fromEmail: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fromName: string | null;

  @Column({ type: 'jsonb', default: [] })
  toEmails: { name?: string; email: string }[];

  @Column({ type: 'jsonb', default: [] })
  ccEmails: { name?: string; email: string }[];

  @Column({ type: 'jsonb', default: [] })
  bccEmails: { name?: string; email: string }[];

  @Column({ type: 'varchar', length: 500, default: '' })
  subject: string;

  @Column({ type: 'text', default: '' })
  bodyText: string;

  @Column({ type: 'text', default: '' })
  bodyHtml: string;

  /** Provider label ids — drives thread isRead/isStarred/folder recomputes. */
  @Column({ type: 'jsonb', default: [] })
  labelIds: string[];

  @Column({ type: 'boolean', default: false })
  hasAttachments: boolean;

  @Column({ type: 'enum', enum: EmailMessageStatus })
  status: EmailMessageStatus;

  @Column({ type: 'timestamptz' })
  sentAt: Date;

  @OneToMany(() => EmailAttachment, (attachment) => attachment.emailMessage)
  attachments: EmailAttachment[];
}
