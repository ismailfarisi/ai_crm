import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { PensionBase } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';

/**
 * A pension fund's contribution rates (GPSSA, ADPF, …), assigned to nationals.
 * Presets are seeded inactive; an admin activates one after checking it.
 * An assigned scheme can be deactivated but not deleted (FK from employees).
 */
@Entity('pension_schemes')
@Index('idx_pension_schemes_tenant', ['tenantId'])
@Index('uq_pension_schemes_tenant_preset', ['tenantId', 'presetKey'], {
  unique: true,
  where: '"preset_key" IS NOT NULL',
})
export class PensionScheme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Set on the seeded presets so they are created once per tenant. */
  @Column({ name: 'preset_key', type: 'varchar', length: 40, nullable: true })
  presetKey: string | null;

  @Column({
    name: 'employee_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: numericTransformer,
  })
  employeePct: number;

  @Column({
    name: 'employer_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: numericTransformer,
  })
  employerPct: number;

  /** CHECK lives in the migration. */
  @Column({ type: 'varchar', length: 20 })
  base: PensionBase;

  @Column({
    name: 'min_salary',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  minSalary: number | null;

  @Column({
    name: 'max_salary',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  maxSalary: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
