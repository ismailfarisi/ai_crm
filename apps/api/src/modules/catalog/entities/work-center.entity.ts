import { Column, Entity, Index } from 'typeorm';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A machine or bench that consumes time: press, laminator, die-cutter,
 * wrapping bench, assembly.
 *
 * `setupMinutes` is the make-ready and is charged once per operation whatever
 * the order quantity — it is the reason a run of 100 costs far more per piece
 * than a run of 2,500.
 */
@Entity('catalog_work_centers')
@Index('idx_catalog_work_centers_tenant', ['tenantId'])
export class WorkCenter extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({
    name: 'setup_minutes',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  setupMinutes: number;

  @Column({
    name: 'machine_cost_per_hour',
    type: 'numeric',
    precision: 12,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  machineCostPerHour: number;

  @Column({
    name: 'labor_cost_per_hour',
    type: 'numeric',
    precision: 12,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  laborCostPerHour: number;

  /** Rework and spoilage, applied as a time uplift on run minutes. */
  @Column({
    name: 'scrap_pct',
    type: 'numeric',
    precision: 5,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  scrapPct: number;

  /** Nobody books the press for four minutes. */
  @Column({
    name: 'min_charge_minutes',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  minChargeMinutes: number;

  /** Drives lead time, not cost. Four benches means four times a shift. */
  @Column({
    name: 'daily_capacity_minutes',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 480,
    transformer: numericTransformer,
  })
  dailyCapacityMinutes: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
