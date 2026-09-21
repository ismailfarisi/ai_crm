import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { ChannelProviderType } from './channel-config.entity';
import { MessageAiIntent } from './channel-message.entity';

/** Hand-synced with `AiAgentActionTypeEnum` in @saas/shared — keep in sync by hand. */
export enum AiAgentActionType {
  AUTO_ACK = 'AUTO_ACK',
  CREATE_DRAFT_QUOTE = 'CREATE_DRAFT_QUOTE',
}

/**
 * A per-organization, database-configurable dispatch rule: which intent
 * triggers which action-type handler, with what template/threshold/eligible
 * providers. Styled directly after `AiConfig` (per-org provider rows) — the
 * action *handlers* themselves stay a small fixed code catalog (see
 * agents/action-handler.registry.ts), since some actions (drafting a quote)
 * are inherently code, not data.
 */
@Entity('ai_agents')
@Unique(['organizationId', 'intent'])
export class AiAgent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'enum', enum: MessageAiIntent })
  intent: MessageAiIntent;

  @Column({ type: 'enum', enum: AiAgentActionType })
  actionType: AiAgentActionType;

  /** Action-specific parameters, e.g. `{ template: string }` for AUTO_ACK. */
  @Column({ type: 'jsonb', default: {} })
  config: Record<string, any>;

  @Column({ type: 'real', default: 0.75 })
  confidenceThreshold: number;

  @Column({ type: 'jsonb', default: ['EMAIL_SMTP', 'EMAIL_RESEND'] })
  eligibleProviders: ChannelProviderType[];

  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

  /**
   * The model this agent runs on, or null for the provider's default.
   *
   * Nullable rather than defaulted: a default here would be a second opinion
   * about which model is current, and the provider already holds that one.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
