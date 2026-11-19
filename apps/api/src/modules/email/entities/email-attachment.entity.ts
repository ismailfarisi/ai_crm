import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { TenantBaseEntity } from '@/common/entities/base.entity';
import { EmailMessage } from './email-message.entity';

/**
 * Attachment metadata only — bytes live in the provider mailbox and are
 * fetched on demand through the Gmail API, so nothing is stored locally.
 */
@Entity('email_attachments')
@Unique('UQ_email_attachments_message_provider', [
  'emailMessageId',
  'providerAttachmentId',
])
export class EmailAttachment extends TenantBaseEntity {
  @Column('uuid')
  @Index('IDX_email_attachments_message')
  emailMessageId: string;

  @ManyToOne(() => EmailMessage, (message) => message.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'emailMessageId' })
  emailMessage: EmailMessage;

  /**
   * Provider attachment locator — a Gmail attachment id, or
   * `mailbox:uid:index` for IMAP (the raw part is re-parsed on download).
   */
  @Column({ type: 'varchar', length: 500 })
  providerAttachmentId: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'integer', default: 0 })
  sizeBytes: number;
}
