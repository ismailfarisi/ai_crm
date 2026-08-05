import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { Role } from '@/modules/rbac/entities/role.entity';
import { Team } from '@/modules/teams/entities/team.entity';
import { RefreshToken } from '@/modules/auth/entities/refresh-token.entity';

@Entity('users')
@Index('uq_users_email', ['email'], { unique: true })
export class User extends BaseEntity {
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, (org) => org.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  /**
   * The team this member belongs to. The team leader's manager is usually null
   * (they report to admin/owner), while team members report to their lead.
   */
  @Index('idx_users_team')
  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamId' })
  team: Team | null;

  /** Direct reporting line — the user who manages this member. */
  @Index('idx_users_manager')
  @Column({ type: 'uuid', nullable: true })
  managerId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'managerId' })
  manager: User | null;

  @OneToMany(() => User, (user) => user.manager)
  directReports: User[];

  /** Globally unique — a person signs in with just their email, no tenant picker. */
  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** Never selected by default; the auth service opts in explicitly. */
  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 80 })
  firstName: string;

  @Column({ type: 'varchar', length: 80 })
  lastName: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /**
   * Bumped whenever the user's password changes or an admin revokes access.
   * Access tokens minted before this instant are rejected, which gives us
   * immediate logout-everywhere without a token blocklist.
   */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  credentialsChangedAt: Date;

  @ManyToMany(() => Role, (role) => role.users)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  roles: Role[];

  @OneToMany(() => RefreshToken, (token) => token.user)
  refreshTokens: RefreshToken[];

  @OneToMany(() => Contact, (contact) => contact.owner)
  ownedContacts: Contact[];

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
