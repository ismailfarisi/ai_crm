import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { User } from '@/modules/users/entities/user.entity';

/**
 * An email-based invite to join an organization. Only the SHA-256 hash of the
 * invite token is stored (mirroring refresh tokens), so a database leak does
 * not expose working invite links. The raw token is delivered by email.
 */
@Entity('invitations')
export class Invitation extends BaseEntity {
  @Index('idx_invitations_org')
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, (org) => org.invitations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 80 })
  firstName: string;

  @Column({ type: 'varchar', length: 80 })
  lastName: string;

  /** Role ids granted on acceptance. Stored as JSON so the invite survives role churn. */
  @Column({ type: 'jsonb' })
  roleIds: string[];

  /** Team the invitee joins on acceptance, if one was chosen. */
  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @Index('uq_invitations_hash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'uuid' })
  invitedById: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invitedById' })
  invitedBy: User;

  /** Set when the invitee accepts; pending invites are those with this null. */
  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;
}
