import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import type {
  AutomationTriggerType,
  AutomationNode,
  AutomationEdge,
} from '@saas/shared';
import { AutomationExecution } from './automation-execution.entity';

export enum AutomationWorkflowStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
}

@Entity('automation_workflows')
export class AutomationWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_automation_workflows_tenant_id')
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: ['DRAFT', 'ACTIVE', 'PAUSED'],
    enumName: 'automation_workflows_status_enum',
    default: 'DRAFT',
  })
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';

  @Column({
    type: 'varchar',
    length: 50,
    default: 'MANUAL',
  })
  triggerType: AutomationTriggerType;

  @Column({ type: 'jsonb', default: {} })
  triggerConfig: Record<string, any>;

  @Column({ type: 'jsonb', default: [] })
  nodes: AutomationNode[];

  @Column({ type: 'jsonb', default: [] })
  edges: AutomationEdge[];

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    unique: true,
  })
  webhookSlug: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => AutomationExecution, (execution) => execution.workflow)
  executions?: AutomationExecution[];
}
