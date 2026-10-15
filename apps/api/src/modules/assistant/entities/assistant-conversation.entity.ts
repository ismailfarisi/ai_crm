import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { AssistantPageContext } from '@saas/shared';

/** One user's private chat with the in-app assistant. */
@Entity('assistant_conversations')
@Index('idx_assistant_conversations_owner_recent', ['tenantId', 'userId', 'updatedAt'])
export class AssistantConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 200, default: 'New chat' })
  title: string;

  @Column({ type: 'jsonb', nullable: true })
  context: AssistantPageContext | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
}
