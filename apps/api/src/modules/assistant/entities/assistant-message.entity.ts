import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AssistantMessageRole } from '@saas/shared';

/** Transcript row and stream event. Ordered by `seq`, which is the SSE event id. */
@Entity('assistant_messages')
@Index('idx_assistant_messages_conversation_seq', ['conversationId', 'seq'])
@Index('uq_assistant_messages_turn_event', ['turnId', 'eventKey'], { unique: true })
export class AssistantMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'turn_id', type: 'uuid', nullable: true })
  turnId: string | null;

  @Column({ name: 'event_key', type: 'varchar', length: 200, nullable: true })
  eventKey: string | null;

  /** bigint arrives from pg as a string; convert with Number() at the DTO boundary. */
  @Column({ type: 'bigint' })
  @Generated('increment')
  seq: string;

  @Column({ type: 'varchar', length: 16 })
  role: AssistantMessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'tool_name', type: 'varchar', length: 120, nullable: true })
  toolName: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
