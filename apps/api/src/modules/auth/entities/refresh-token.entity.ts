import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { User } from '@/modules/users/entities/user.entity';

/**
 * Refresh tokens are stored hashed and rotated on every use. If a rotated token
 * is presented a second time we treat it as theft and revoke the whole family.
 */
@Entity('refresh_tokens')
export class RefreshToken extends BaseEntity {
  @Index('idx_refresh_tokens_user')
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index('uq_refresh_tokens_hash', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  tokenHash: string;

  /** All descendants of one login share a family id, so we can revoke together. */
  @Index('idx_refresh_tokens_family')
  @Column({ type: 'uuid' })
  familyId: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;
}
