import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ChannelProviderType } from './channel-config.entity';
import { Contact } from '../../contacts/entities/contact.entity';

export enum MessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum MessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RECEIVED = 'received',
}

/** Hand-synced with `MessageAiIntentEnum` in @saas/shared — keep in sync by hand. */
export enum MessageAiIntent {
  GENERAL_QUESTION = 'GENERAL_QUESTION',
  QUOTATION_REQUEST = 'QUOTATION_REQUEST',
  ORDER_STATUS = 'ORDER_STATUS',
  PRICING_QUESTION = 'PRICING_QUESTION',
  COMPLAINT = 'COMPLAINT',
  SUPPORT_REQUEST = 'SUPPORT_REQUEST',
  SCHEDULING = 'SCHEDULING',
  SPAM = 'SPAM',
  OTHER = 'OTHER',
}

export enum MessageAiProcessingStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  AWAITING_REPLY = 'AWAITING_REPLY',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export interface ChannelIntentOption {
  label: string;
  body: string;
}

@Entity('channel_messages')
export class ChannelMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  contactId: string | null;

  @ManyToOne(() => Contact, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'contactId' })
  contact: Contact | null;

  @Column({ type: 'enum', enum: ChannelProviderType })
  provider: ChannelProviderType;

  @Column({ type: 'enum', enum: MessageDirection })
  direction: MessageDirection;

  @Column({ type: 'varchar', length: 255 })
  sender: string;

  @Column({ type: 'varchar', length: 255 })
  recipient: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.PENDING,
  })
  status: MessageStatus;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @Column({ type: 'enum', enum: MessageAiIntent, nullable: true })
  aiIntent: MessageAiIntent | null;

  @Column({ type: 'real', nullable: true })
  aiConfidence: number | null;

  @Column({ type: 'text', nullable: true })
  aiSummary: string | null;

  @Column({ type: 'text', nullable: true })
  aiSuggestedReply: string | null;

  @Column({ type: 'jsonb', default: [] })
  aiSuggestedReplyOptions: ChannelIntentOption[];

  @Column({
    type: 'enum',
    enum: MessageAiProcessingStatus,
    default: MessageAiProcessingStatus.NONE,
  })
  aiProcessingStatus: MessageAiProcessingStatus;

  @Column({ type: 'boolean', default: false })
  aiAutoAcked: boolean;

  /** Loose reference (no FK) to a draft Quote this message's classification spawned — same style as `contactId`. */
  @Column({ type: 'uuid', nullable: true })
  aiCreatedQuoteId: string | null;
}
