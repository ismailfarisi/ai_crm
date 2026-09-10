import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ChannelProviderType } from './channel-config.entity';

/**
 * Per-organization singleton config for the multi-turn intent-clarifying
 * agent (`channelConversationWorkflow`) — styled after `AiBudget`, one row
 * per org, editable without a deploy.
 */
@Entity('intent_agent_configs')
export class IntentAgentConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_intent_agent_configs_organization_id', { unique: true })
  organizationId: string;

  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

  @Column({ type: 'int', default: 5 })
  maxTurns: number;

  @Column({ type: 'int', default: 15 })
  replyTimeoutMinutes: number;

  /** Overrides IntentClassifierAgent's built-in system prompt when set. */
  @Column({ type: 'text', nullable: true })
  systemPrompt: string | null;

  @Column({ type: 'jsonb', default: ['TELEGRAM', 'WHATSAPP_META'] })
  eligibleProviders: ChannelProviderType[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
