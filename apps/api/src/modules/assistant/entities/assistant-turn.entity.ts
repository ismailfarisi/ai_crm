import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AssistantPendingAction, AssistantTurnStatus } from '@saas/shared';

/** One agentReActWorkflow run, started by one user message. */
@Entity('assistant_turns')
@Index('uq_assistant_turns_one_active_per_conversation', ['conversationId'], {
  unique: true,
  where: `"status" IN ('RUNNING', 'AWAITING_APPROVAL')`,
})
export class AssistantTurn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'user_message_id', type: 'uuid', nullable: true })
  userMessageId: string | null;

  @Column({ name: 'workflow_id', type: 'varchar', length: 200 })
  workflowId: string;

  @Column({ type: 'varchar', length: 20, default: 'RUNNING' })
  status: AssistantTurnStatus;

  @Column({ name: 'pending_action', type: 'jsonb', nullable: true })
  pendingAction: AssistantPendingAction | null;

  @Column({ type: 'int', default: 0 })
  steps: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'last_progress_at', type: 'timestamptz', default: () => 'now()' })
  lastProgressAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
