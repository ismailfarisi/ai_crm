import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';

/**
 * A company (or person) the organization sells to. Tenant-scoped like every
 * other entity; the combination of tenant + company name is unique. Invoices
 * will hang off this table in a later change.
 */
@Entity('customers')
@Index('idx_customers_org_created', ['organizationId', 'createdAt'])
@Index('uq_customers_org_company', ['organizationId', 'companyName'], {
  unique: true,
})
export class Customer extends SoftDeletableEntity {
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, (org) => org.customers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'varchar', length: 120 })
  companyName: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  contactName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  addressLine1: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  addressLine2: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  postalCode: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  taxId: string | null;

  /** ISO 4217 code; null until the first invoice is raised against this customer. */
  @Column({ type: 'char', length: 3, nullable: true })
  currency: string | null;

  @Column({ type: 'int', nullable: true })
  paymentTermsDays: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
