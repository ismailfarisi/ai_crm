import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { ExecutionTriggerSource } from '@saas/shared';
import { AutomationWorkflow } from './automation-workflow.entity';

export type AutomationExecutionStatus =
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN';

export enum AutomationExecutionStatusEnum {
  RUNNING = 'RUNNING',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  UNKNOWN = 'UNKNOWN',
}

@Entity('automation_executions')
@Index('uq_automation_executions_source_event', ['workflowId', 'sourceEventId'], {
  unique: true,
  where: '"sourceEventId" IS NOT NULL',
})
@Index(
  'uq_automation_executions_idempotency_key',
  ['workflowId', 'idempotencyKey'],
  { unique: true, where: '"idempotencyKey" IS NOT NULL' },
)
export class AutomationExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_automation_executions_tenant_id')
  tenantId: string;

  @Column({ type: 'uuid' })
  @Index('idx_automation_executions_workflow_id')
  workflowId: string;

  @ManyToOne(() => AutomationWorkflow, (workflow) => workflow.executions, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'workflowId' })
  workflow?: AutomationWorkflow;

  /** The outbox event that triggered this run; one run per (workflow, event). */
  @Column({ type: 'uuid', nullable: true })
  sourceEventId: string | null;

  /**
   * The caller's key for "this is the same request again" (a webhook's
   * `Idempotency-Key`, a schedule tick's time); one run per (workflow, key)
   * while the key is remembered.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'varchar', length: 150 })
  temporalWorkflowId: string;

  @Column({
    type: 'enum',
    enum: ['RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'],
    enumName: 'automation_executions_status_enum',
    default: 'RUNNING',
  })
  status: AutomationExecutionStatus;

  /** What started the run; null for runs recorded before this was kept. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  triggerSource: ExecutionTriggerSource | null;

  @Column({ type: 'jsonb', default: {} })
  triggerPayload: Record<string, any>;

  @Column({ type: 'jsonb', default: {} })
  nodeResults: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;
}
