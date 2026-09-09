import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ChannelProviderType } from './channel-config.entity';

/**
 * Maps an inbound channel identity (a phone number, Telegram chat id, or
 * email address) to the internal staff `User` allowed to send quote-approval
 * commands on it. Created via a one-time linking code, never by the channel
 * message itself — see ChannelCommandService.
 */
@Entity('staff_channel_identities')
@Index('idx_staff_channel_identities_user_id', ['userId'])
@Index(
  'uq_staff_channel_identities_org_provider_identifier',
  ['organizationId', 'provider', 'identifier'],
  { unique: true },
)
export class StaffChannelIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column({ type: 'enum', enum: ChannelProviderType })
  provider: ChannelProviderType;

  @Column({ type: 'varchar', length: 255 })
  identifier: string;

  @Column('uuid')
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}
