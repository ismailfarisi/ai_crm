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
}
