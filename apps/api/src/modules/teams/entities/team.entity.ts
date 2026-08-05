import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { User } from '@/modules/users/entities/user.entity';

/**
 * A named, org-scoped group of members led by one person. Team leaders
 * (`manager` role) see the contacts owned by their team's members.
 */
@Entity('teams')
export class Team extends SoftDeletableEntity {
  @Index('idx_teams_org_name', ['organizationId', 'name'], { unique: true })
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, (org) => org.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** The team leader. Null when nobody is leading the team yet. */
  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leadId' })
  lead: User | null;

  @OneToMany(() => User, (user) => user.team)
  members: User[];
}
