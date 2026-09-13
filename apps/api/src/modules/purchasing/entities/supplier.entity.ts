import { Column, Entity, Index } from 'typeorm';
import { SoftDeletableEntity } from '@/common/entities/base.entity';

/**
 * A company the shop buys from.
 *
 * Mirrors `Customer` field for field where the two overlap — same address
 * shape, same nullable `currency` and `paymentTermsDays` — so the two sides
 * of the ledger stay legible to anyone who has read one of them. The
 * additions are `leadTimeDays`, which drives the expected date on a purchase
 * order, and `isActive`.
 */
@Entity('suppliers')
@Index('idx_suppliers_tenant', ['tenantId'])
@Index('uq_suppliers_tenant_name', ['tenantId', 'companyName'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class Supplier extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'company_name', type: 'varchar', length: 120 })
  companyName: string;

  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  contactName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({
    name: 'address_line1',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  addressLine1: string | null;

  @Column({
    name: 'address_line2',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  addressLine2: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  country: string | null;

  @Column({ name: 'tax_id', type: 'varchar', length: 40, nullable: true })
  taxId: string | null;

  /** ISO 4217. Null until the first order is raised against this supplier. */
  @Column({ type: 'char', length: 3, nullable: true })
  currency: string | null;

  @Column({ name: 'payment_terms_days', type: 'int', nullable: true })
  paymentTermsDays: number | null;

  /** Days from order to delivery. Used to propose an expected date. */
  @Column({ name: 'lead_time_days', type: 'int', nullable: true })
  leadTimeDays: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
