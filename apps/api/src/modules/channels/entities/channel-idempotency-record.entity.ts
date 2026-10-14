import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ChannelIdempotencyStatus = 'STARTED' | 'COMPLETED';

/**
 * One row per side effect that must happen at most once even though the
 * code that performs it can be retried — a Temporal activity attempt that
 * timed out while its work was still running, or a worker that died after
 * the work but before reporting it.
 *
 * The row is claimed (STARTED) before the side effect and completed with its
 * result after, so a retry returns the recorded result instead of repeating
 * the work. See `ChannelIdempotencyService`.
 */
@Entity('channel_idempotency_records')
@Index('uq_channel_idempotency_records_tenant_key', ['tenantId', 'key'], {
  unique: true,
})
export class ChannelIdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 200 })
  key: string;

  @Column({ type: 'varchar', length: 20, default: 'STARTED' })
  status: ChannelIdempotencyStatus;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
