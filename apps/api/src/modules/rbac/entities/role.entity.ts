import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { CUSTOM_ROLE_LEVEL } from '@saas/shared';
import { BaseEntity } from '@/common/entities/base.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Permission } from './permission.entity';

/**
 * Roles are per-organization: each tenant gets its own copy of the system roles
 * at signup, so an admin can retune `member` without affecting anyone else.
 */
@Entity('roles')
@Index('uq_roles_org_slug', ['organizationId', 'slug'], { unique: true })
export class Role extends BaseEntity {
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, (org) => org.roles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 60 })
  slug: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  description: string;

  /** System roles cannot be deleted, and `owner` cannot be edited at all. */
  @Column({ type: 'boolean', default: false })
  isSystem: boolean;

  /**
   * Lower is more powerful. A user can never grant a role at or above their own
   * highest level — that is what stops an admin promoting themselves to owner.
   */
  @Column({ type: 'int', default: CUSTOM_ROLE_LEVEL })
  level: number;

  /**
   * `owner` carries this flag instead of an explicit permission list, so new
   * permissions added in a later release are granted automatically.
   */
  @Column({ type: 'boolean', default: false })
  grantsAllPermissions: boolean;

  @ManyToMany(() => Permission, (permission) => permission.roles, { cascade: false })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'roleId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permissionId', referencedColumnName: 'id' },
  })
  permissions: Permission[];

  @ManyToMany(() => User, (user) => user.roles)
  users: User[];
}
