import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ChannelProviderType } from './channel-config.entity';

export enum PendingChannelCommandAction {
  APPROVE = 'APPROVE',
  APPROVE_AND_SEND = 'APPROVE_AND_SEND',
}

export enum PendingChannelCommandStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/**
 * Tracks a quote-approval command awaiting the sender's yes/no reply on the
 * same channel thread it was proposed on. Short-lived (see `expiresAt`) —
 * this is the "confirm before acting" safety net for ChannelCommandService.
 */
@Entity('pending_channel_commands')
@Index('idx_pending_channel_commands_lookup', [
  'organizationId',
  'provider',
  'senderIdentifier',
  'status',
])
export class PendingChannelCommand {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  userId: string;

  @Column({ type: 'enum', enum: ChannelProviderType })
  provider: ChannelProviderType;

  @Column({ type: 'varchar', length: 255 })
  senderIdentifier: string;

  @Column({ type: 'enum', enum: PendingChannelCommandAction })
  action: PendingChannelCommandAction;

  @Column('uuid')
  quoteId: string;

  @Column({
    type: 'enum',
    enum: PendingChannelCommandStatus,
    default: PendingChannelCommandStatus.PENDING,
  })
  status: PendingChannelCommandStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  resolvedAt: Date | null;
}
