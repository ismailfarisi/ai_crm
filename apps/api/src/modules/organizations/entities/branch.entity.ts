import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Emirate } from '@saas/shared';

/**
 * A place the tenant does business from. The VAT201 splits sales by emirate,
 * so each branch carries one. Exactly one head office per tenant (created
 * with the organization); `invoicePrefix`, when set, is unique per tenant.
 *
 * The tenant foreign key and the emirate CHECK live in the migration.
 */
@Entity('branches')
@Index('uq_branches_tenant_head_office', ['tenantId'], {
  unique: true,
  where: '"is_head_office"',
})
@Index('uq_branches_tenant_invoice_prefix', ['tenantId', 'invoicePrefix'], {
  unique: true,
  where: '"invoice_prefix" IS NOT NULL',
})
export class Branch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({
    name: 'address_line1',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  addressLine1: string | null;

  @Column({
    name: 'address_line2',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  addressLine2: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  emirate: Emirate | null;

  @Column({ name: 'is_head_office', type: 'boolean', default: false })
  isHeadOffice: boolean;

  @Column({
    name: 'invoice_prefix',
    type: 'varchar',
    length: 6,
    nullable: true,
  })
  invoicePrefix: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
