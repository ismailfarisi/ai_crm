import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export enum ChannelProviderType {
  WHATSAPP_META = 'WHATSAPP_META',
  TELEGRAM = 'TELEGRAM',
  EMAIL_SMTP = 'EMAIL_SMTP',
  EMAIL_RESEND = 'EMAIL_RESEND',
}

export enum ChannelStatus {
  UNCONFIGURED = 'unconfigured',
  CONFIGURED = 'configured',
  ERROR = 'error',
}

@Entity('channel_configs')
@Unique(['organizationId', 'provider'])
export class ChannelConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column({ type: 'enum', enum: ChannelProviderType })
  provider: ChannelProviderType;

  @Column({ type: 'boolean', default: false })
  isEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  encryptedCredentials: string | null;

  @Column({ type: 'varchar', nullable: true })
  webhookSecret: string | null;

  @Column({
    type: 'enum',
    enum: ChannelStatus,
    default: ChannelStatus.UNCONFIGURED,
  })
  status: ChannelStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastTestedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
