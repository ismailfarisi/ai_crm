import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { VatFrequency } from '@saas/shared';

/**
 * A tenant's UAE VAT registration: how often it files, where its periods are
 * anchored, when it registered and when VAT started, and its tax agent. One
 * row per tenant. The period-frequency CHECK lives in the migration.
 */
@Entity('vat_settings')
@Index('uq_vat_settings_tenant', ['tenantId'], { unique: true })
export class VatSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'period_frequency', type: 'varchar', length: 10 })
  periodFrequency: VatFrequency;

  /** 'YYYY-MM-DD', the 1st of a month: the anchor every period counts from. */
  @Column({ name: 'first_period_start', type: 'date' })
  firstPeriodStart: string;

  /** 'YYYY-MM-DD'. */
  @Column({ name: 'registration_date', type: 'date' })
  registrationDate: string;

  /** 'YYYY-MM-DD', the first day of a tax period. */
  @Column({ name: 'vat_start_date', type: 'date' })
  vatStartDate: string;

  @Column({
    name: 'tax_agent_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  taxAgentName: string | null;

  @Column({
    name: 'tax_agency_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  taxAgencyName: string | null;

  /** Tax agent number. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  tan: string | null;

  /** Tax agency number. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  taan: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
