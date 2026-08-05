import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Role } from '@/modules/rbac/entities/role.entity';
import { Team } from '@/modules/teams/entities/team.entity';
import { User } from '@/modules/users/entities/user.entity';

/** The tenant boundary. Every other row in the CRM hangs off one of these. */
@Entity('organizations')
export class Organization extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index('uq_organizations_slug', { unique: true })
  @Column({ type: 'varchar', length: 140 })
  slug: string;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => Role, (role) => role.organization)
  roles: Role[];

  @OneToMany(() => Contact, (contact) => contact.organization)
  contacts: Contact[];

  @OneToMany(() => Team, (team) => team.organization)
  teams: Team[];
}
