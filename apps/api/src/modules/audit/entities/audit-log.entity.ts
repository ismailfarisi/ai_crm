import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AuditChannel, AuditOrigin } from '@saas/shared';

/**
 * One recorded change. Deliberately not a `BaseEntity`: there is no
 * `updatedAt` because a row is never updated, and no `deletedAt` because a
 * trail you can quietly delete from is not a trail.
 */
@Entity('audit_logs')
@Index('idx_audit_logs_subject', ['tenantId', 'subjectType', 'subjectId'])
@Index('idx_audit_logs_actor', ['tenantId', 'actorId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  /** Denormalised: the row must stay readable after the user is gone. */
  @Column({ name: 'actor_name', type: 'varchar', length: 180, nullable: true })
  actorName: string | null;

  /** `quote.update`, `invoice.void`, `auth.login`. */
  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ name: 'subject_type', type: 'varchar', length: 40 })
  subjectType: string;

  @Column({ name: 'subject_id', type: 'uuid', nullable: true })
  subjectId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  summary: string | null;

  @Column({ name: 'changed_fields', type: 'jsonb', nullable: true })
  changedFields: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  /* ---- provenance: who or what decided, and on what evidence ---- */

  @Column({ type: 'varchar', length: 20, default: 'HUMAN' })
  origin: AuditOrigin;

  @Column({
    name: 'origin_channel',
    type: 'varchar',
    length: 20,
    default: 'WEB',
  })
  originChannel: AuditChannel;

  @Column({
    name: 'origin_message_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originMessageId: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  @Column({
    name: 'prompt_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  promptVersion: string | null;

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
}
