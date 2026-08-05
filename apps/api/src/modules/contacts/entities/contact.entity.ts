import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CONTACT_SOURCES, CONTACT_STATUSES, type ContactSource, type ContactStatus } from '@saas/shared';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { User } from '@/modules/users/entities/user.entity';

@Entity('contacts')
@Index('idx_contacts_org_created', ['organizationId', 'createdAt'])
@Index('idx_contacts_org_owner', ['organizationId', 'ownerId'])
export class Contact extends SoftDeletableEntity {
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, (org) => org.contacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'varchar', length: 80 })
  firstName: string;

  @Column({ type: 'varchar', length: 80 })
  lastName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  jobTitle: string | null;

  @Column({ type: 'enum', enum: [...CONTACT_STATUSES], enumName: 'contact_status', default: 'lead' })
  status: ContactStatus;

  @Column({ type: 'enum', enum: [...CONTACT_SOURCES], enumName: 'contact_source', default: 'other' })
  source: ContactSource;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** The rep who owns this relationship. Drives `contact:read` vs `contact:read_all`. */
  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;

  @ManyToOne(() => User, (user) => user.ownedContacts, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'ownerId' })
  owner: User | null;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
