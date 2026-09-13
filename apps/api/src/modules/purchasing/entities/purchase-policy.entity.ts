import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * One row per tenant, holding the limits they set on their own buying.
 *
 * Modelled on `costing_policies`, including the stance that matters most:
 * `enforce` is false until someone configures it, so switching purchasing on
 * does not retroactively block orders that were fine yesterday.
 */
@Entity('purchase_policies')
@Index('uq_purchase_policies_tenant', ['tenantId'], { unique: true })
export class PurchasePolicyEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** Above this, approval also needs `purchase_order:approve_above_threshold`. */
  @Column({
    name: 'approval_threshold',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 500,
    transformer: numericTransformer,
  })
  approvalThreshold: number;

  @Column({ name: 'require_preferred_supplier', type: 'boolean', default: false })
  requirePreferredSupplier: boolean;

  /** How far a supplier's bill may drift from the ordered price, 0-1. Used from sprint 4. */
  @Column({
    name: 'variance_tolerance_pct',
    type: 'numeric',
    precision: 5,
    scale: 4,
    default: 0.05,
    transformer: numericTransformer,
  })
  varianceTolerancePct: number;

  @Column({ type: 'boolean', default: false })
  enforce: boolean;
}
