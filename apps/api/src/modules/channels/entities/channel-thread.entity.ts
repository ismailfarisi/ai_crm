import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ChannelHandoverReason, ChannelThreadState } from '@saas/shared';

/**
 * Who is answering one customer conversation: the AI or a person.
 *
 * One row per (organization, channel, contact). The AI only acts while
 * `state` is AI; a handover moves it to NEEDS_HUMAN and it stays quiet until
 * someone returns the conversation or resolves it.
 */
@Entity('channel_threads')
@Index('idx_channel_threads_unique', ['organizationId', 'provider', 'contactId'], {
  unique: true,
})
export class ChannelThread {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 30 })
  provider: string;

  @Column({ type: 'uuid' })
  contactId: string;

  @Column({ type: 'varchar', length: 20, default: 'AI' })
  state: ChannelThreadState;

  @Column({ type: 'uuid', nullable: true })
  assigneeUserId: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  handoverReason: ChannelHandoverReason | null;

  /** What the AI understood before it stopped, for whoever picks this up. */
  @Column({ type: 'text', nullable: true })
  handoverSummary: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  handedOverAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
