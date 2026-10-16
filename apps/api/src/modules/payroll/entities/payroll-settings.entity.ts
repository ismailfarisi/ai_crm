import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { WpsEmployerIdType } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A tenant's payroll profile: WPS employer details, the annual leave
 * entitlement and the monthly standard hours. One row per tenant, created
 * the first time it is read. CHECKs (employer ID type, leave days 30..60,
 * standard hours 100..320) live in the migration.
 */
@Entity('payroll_settings')
@Index('uq_payroll_settings_tenant', ['tenantId'], { unique: true })
export class PayrollSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'wps_enabled', type: 'boolean', default: false })
  wpsEnabled: boolean;

  @Column({
    name: 'employer_id_type',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  employerIdType: WpsEmployerIdType | null;

  /** 13 digits for MOHRE; free text for a free zone. */
  @Column({ name: 'employer_id', type: 'varchar', length: 20, nullable: true })
  employerId: string | null;

  @Column({
    name: 'payer_routing_code',
    type: 'char',
    length: 9,
    nullable: true,
  })
  payerRoutingCode: string | null;

  /** Calendar days per year of service; an employee may override it. */
  @Column({ name: 'annual_leave_days', type: 'int', default: 30 })
  annualLeaveDays: number;

  /** Hours in a full month, for the labour rate; 100..320 (CHECK in the migration). */
  @Column({
    name: 'monthly_standard_hours',
    type: 'numeric',
    precision: 6,
    scale: 2,
    default: 208,
    transformer: numericTransformer,
  })
  monthlyStandardHours: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
