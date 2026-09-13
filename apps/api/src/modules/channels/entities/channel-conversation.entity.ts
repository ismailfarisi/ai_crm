import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ChannelConversationStatus,
  ChannelResultType,
  ChannelSkillName,
} from '@saas/shared';
import { ChannelProviderType } from './channel-config.entity';

/**
 * A staff chat command in progress.
 *
 * Generalises `PendingChannelCommand`, which could only hold a quote id and
 * only ever had one question to ask ("yes or no?"). Building a purchase order
 * needs somewhere to keep what has already been gathered while the remaining
 * slots are asked about one at a time.
 *
 * One live row per (organization, provider, sender) — a second command from
 * the same person supersedes the first rather than racing it.
 */
@Entity('channel_conversations')
@Index('idx_channel_conversations_lookup', [
  'organizationId',
  'provider',
  'senderIdentifier',
  'status',
])
export class ChannelConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: ChannelProviderType,
    enumName: 'channel_conversations_provider_enum',
  })
  provider: ChannelProviderType;

  @Column({ name: 'sender_identifier', type: 'varchar', length: 255 })
  senderIdentifier: string;

  @Column({ name: 'skill_name', type: 'varchar', length: 60 })
  skillName: ChannelSkillName;

  /** Slots gathered so far. Shape is the skill's own, validated on every read. */
  @Column({ type: 'jsonb', default: {} })
  slots: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: [
      'COLLECTING',
      'AWAITING_CONFIRM',
      'CONFIRMED',
      'CANCELLED',
      'EXPIRED',
    ],
    enumName: 'channel_conversations_status_enum',
    default: 'COLLECTING',
  })
  status: ChannelConversationStatus;

  /**
   * The single open question, so that a bare reply ("SRA2", "500") is
   * interpretable without re-routing it as a fresh command.
   */
  @Column({ name: 'pending_question', type: 'text', nullable: true })
  pendingQuestion: string | null;

  @Column({ name: 'result_type', type: 'varchar', length: 30, nullable: true })
  resultType: ChannelResultType | null;

  @Column({ name: 'result_id', type: 'uuid', nullable: true })
  resultId: string | null;

  /**
   * Guards against a provider redelivering a webhook it believes failed. A
   * retried "yes" must not raise a second purchase order, so execution takes
   * this unique key inside the transaction that moves the row out of
   * `AWAITING_CONFIRM`.
   */
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 120,
    nullable: true,
    unique: true,
  })
  idempotencyKey: string | null;

  /* ---- provenance carried onto whatever the skill creates ---- */

  @Column({
    name: 'origin_message_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originMessageId: string | null;

  @Column({
    name: 'origin_model',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  originModel: string | null;

  @Column({
    name: 'origin_prompt_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  originPromptVersion: string | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  confidence: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
