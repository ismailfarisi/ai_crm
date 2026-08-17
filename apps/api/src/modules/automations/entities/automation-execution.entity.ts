import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AutomationWorkflow } from './automation-workflow.entity';

export type AutomationExecutionStatus =
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export enum AutomationExecutionStatusEnum {
  RUNNING = 'RUNNING',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('automation_executions')
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

  @Column({ type: 'varchar', length: 150 })
  temporalWorkflowId: string;

  @Column({
    type: 'enum',
    enum: ['RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'],
    enumName: 'automation_executions_status_enum',
    default: 'RUNNING',
  })
  status: AutomationExecutionStatus;

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
