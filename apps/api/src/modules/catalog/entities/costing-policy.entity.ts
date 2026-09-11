import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * One row per tenant holding the commercial floors on quoting.
 *
 * `enforce` defaults to false so switching the costing engine on does not
 * retroactively block quotes that were acceptable the day before. The tenant
 * turns it on once their numbers are loaded and trusted.
 */
@Entity('costing_policies')
@Index('uq_costing_policies_tenant', ['tenantId'], { unique: true })
export class CostingPolicy extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** Fraction of the untaxed subtotal, 0-1. */
  @Column({
    name: 'min_margin_pct',
    type: 'numeric',
    precision: 5,
    scale: 4,
    default: 0.2,
    transformer: numericTransformer,
  })
  minMarginPct: number;

  /** Percentage on a single line, 0-100 — matches `QuoteLineItem.discount`. */
  @Column({
    name: 'max_discount_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 20,
    transformer: numericTransformer,
  })
  maxDiscountPct: number;

  @Column({ name: 'require_known_cost', type: 'boolean', default: false })
  requireKnownCost: boolean;

  @Column({ type: 'boolean', default: false })
  enforce: boolean;
}
