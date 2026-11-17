import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ApprovalNoticeEvent, NotificationChannel } from '@saas/shared';

export type ApprovalDeliveryStatus =
  'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED' | 'DEFERRED';

/** One notice to one person on one channel. Unique, so it is sent once. */
@Entity('approval_deliveries')
@Index(
  'uq_approval_deliveries_once',
  ['requestId', 'userId', 'event', 'channel'],
  {
    unique: true,
  },
)
@Index('idx_approval_deliveries_status_due_at', ['status', 'dueAt'])
export class ApprovalDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  event: ApprovalNoticeEvent;

  @Column({ type: 'varchar', length: 20 })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 20 })
  status: ApprovalDeliveryStatus;

  /** For a DEFERRED notice: the end of the recipient's quiet hours. */
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
