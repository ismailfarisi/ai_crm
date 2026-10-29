import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type {
  AutomationApprovalKind,
  AutomationApprovalStatus,
} from '@saas/shared';
import { AutomationExecution } from './automation-execution.entity';

/** One approval a run is waiting on (or has had decided), listed in the inbox. */
@Entity('automation_approvals')
@Index('idx_automation_approvals_tenant_status_requested', [
  'tenantId',
  'status',
  'requestedAt',
])
@Index('uq_automation_approvals_pending_node', ['executionId', 'nodeId'], {
  unique: true,
  where: "status = 'PENDING'",
})
export class AutomationApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  @Index('idx_automation_approvals_execution_id')
  executionId: string;

  @ManyToOne(() => AutomationExecution, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'executionId' })
  execution?: AutomationExecution;

  @Column({ type: 'uuid' })
  workflowId: string;

  @Column({ type: 'varchar', length: 150 })
  nodeId: string;

  @Column({ type: 'varchar', length: 20 })
  kind: AutomationApprovalKind;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: AutomationApprovalStatus;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;
}
