import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ApprovalItemType =
  'QUOTE' | 'AUTOMATION_APPROVAL' | 'ASSISTANT_ACTION';
export type ApprovalRequestStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED';

/**
 * One thing waiting for a decision, as the notifier sees it: who may decide
 * (`permissions`, all required, or a single `recipientUserId`), who asked,
 * and when the one reminder is due. At most one PENDING row per item.
 */
@Entity('approval_requests')
@Index(
  'uq_approval_requests_pending_item',
  ['tenantId', 'itemType', 'itemId'],
  {
    unique: true,
    where: "status = 'PENDING'",
  },
)
@Index('idx_approval_requests_status_remind_at', ['status', 'remindAt'])
export class ApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_type', type: 'varchar', length: 30 })
  itemType: ApprovalItemType;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  permissions: string[];

  @Column({ name: 'recipient_user_id', type: 'uuid', nullable: true })
  recipientUserId: string | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  link: string | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  /** False when the asker is watching already (the assistant): only remind. */
  @Column({ name: 'notify_now', type: 'boolean', default: true })
  notifyNow: boolean;

  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'now()' })
  requestedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'remind_at', type: 'timestamptz', nullable: true })
  remindAt: Date | null;

  @Column({ name: 'reminded_at', type: 'timestamptz', nullable: true })
  remindedAt: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: ApprovalRequestStatus;

  @Column({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;
}
