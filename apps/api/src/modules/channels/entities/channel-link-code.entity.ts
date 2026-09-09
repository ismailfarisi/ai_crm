import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * A short-lived, one-time code a logged-in user generates in Settings and
 * then sends as a message on the channel they want to link. Consuming it is
 * the only way a `StaffChannelIdentity` row gets created.
 */
@Entity('channel_link_codes')
@Index('idx_channel_link_codes_code', ['code'])
export class ChannelLinkCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 8 })
  code: string;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
