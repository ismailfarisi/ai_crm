import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { NotificationChannel } from '@saas/shared';

/** A user's notification choices; `userId` null is the organisation default. */
@Entity('notification_preferences')
@Index('uq_notification_preferences_user', ['tenantId', 'userId'], {
  unique: true,
  where: 'user_id IS NOT NULL',
})
@Index('uq_notification_preferences_org', ['tenantId'], {
  unique: true,
  where: 'user_id IS NULL',
})
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'approval_channels', type: 'text', array: true })
  approvalChannels: NotificationChannel[];

  @Column({ name: 'outcome_channels', type: 'text', array: true })
  outcomeChannels: NotificationChannel[];

  @Column({
    name: 'quiet_hours_start',
    type: 'varchar',
    length: 5,
    nullable: true,
  })
  quietHoursStart: string | null;

  @Column({
    name: 'quiet_hours_end',
    type: 'varchar',
    length: 5,
    nullable: true,
  })
  quietHoursEnd: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  timezone: string | null;

  /** Organisation row only. */
  @Column({ name: 'reminder_delay_minutes', type: 'int', nullable: true })
  reminderDelayMinutes: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
