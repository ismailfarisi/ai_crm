import { Column, Entity, Index } from 'typeorm';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A one-time, reusable cost: a cutting die, a print plate, a foiling block.
 *
 * `reusable` is what stops a repeat order being charged for a die the
 * customer already paid for — the resolver passes the ids they own and the
 * costing engine zeroes those lines.
 */
@Entity('catalog_tooling')
@Index('idx_catalog_tooling_tenant', ['tenantId'])
export class Tooling extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  cost: number;

  /** True folds the cost into the unit price; false bills it as its own line. */
  @Column({ type: 'boolean', default: true })
  amortize: boolean;

  @Column({ type: 'boolean', default: true })
  reusable: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
