import { Column, Entity, Index, ManyToMany } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { Role } from './role.entity';

/**
 * A global catalog row, seeded from `@saas/shared`'s PERMISSIONS map on boot.
 * Permissions are NOT tenant-scoped — every organization draws from the same list.
 */
@Entity('permissions')
export class Permission extends BaseEntity {
  /** Full permission string, e.g. `contact:create`. */
  @Index('uq_permissions_key', { unique: true })
  @Column({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'varchar', length: 50 })
  subject: string;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description: string;

  @ManyToMany(() => Role, (role) => role.permissions)
  roles: Role[];
}
