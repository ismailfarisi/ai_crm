import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ChannelAgentKind } from '@saas/shared';

/**
 * An agent an organization defines: what it handles, how it behaves, the
 * model it runs on, the tools it may use and the channels it answers on.
 *
 * Distinct from `ai_agents`, which are fixed rules (one intent, one action).
 */
@Entity('channel_agents')
@Index('idx_channel_agents_name', ['organizationId', 'name'], { unique: true })
export class ChannelAgent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** One line saying what this agent handles; the router picks an agent by it. */
  @Column({ type: 'varchar', length: 300 })
  description: string;

  @Column({ type: 'text' })
  instructions: string;

  @Column({ type: 'varchar', length: 20 })
  kind: ChannelAgentKind;

  /** Null runs on the organization's default provider. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  provider: string | null;

  /** Null runs on the organization's default model. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  /** Names of the chat skills this agent may use. */
  @Column({ type: 'jsonb', default: [] })
  skills: string[];

  /** Channel providers this agent answers on. */
  @Column({ type: 'jsonb', default: [] })
  channels: string[];

  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
