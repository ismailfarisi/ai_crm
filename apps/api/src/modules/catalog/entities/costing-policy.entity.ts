import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import type { OverheadRateBasis } from '@saas/shared';
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

  /** How far a job's actual cost may pass its quoted cost before it is flagged, as a fraction (0.1 = 10%). */
  @Column({
    name: 'over_budget_alert_pct',
    type: 'numeric',
    precision: 5,
    scale: 4,
    // A raw default: TypeORM compares a fractional number default as '0.1',
    // which Postgres never reports back, so it would read as drift.
    default: () => '0.1',
    transformer: numericTransformer,
  })
  overBudgetAlertPct: number;

  /**
   * The shop-wide overhead rate on direct cost, 0-1. Templates whose own
   * overhead is null use it. 0 until the owner sets it, so nothing changes
   * on the day this ships.
   */
  @Column({
    name: 'default_overhead_pct',
    type: 'numeric',
    precision: 5,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  defaultOverheadPct: number;

  /** `BOOKS` when accepted from the suggestion, `TYPED` when entered by hand. */
  @Column({
    name: 'default_overhead_source',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  defaultOverheadSource: 'BOOKS' | 'TYPED' | null;

  @Column({
    name: 'default_overhead_set_at',
    type: 'timestamptz',
    nullable: true,
  })
  defaultOverheadSetAt: Date | null;

  /** The months, accounts and totals behind a rate taken from the books. */
  @Column({ name: 'default_overhead_basis', type: 'jsonb', nullable: true })
  defaultOverheadBasis: OverheadRateBasis | null;

  /** The owner chose to ignore the suggestion from the books. */
  @Column({
    name: 'overhead_suggestion_hidden',
    type: 'boolean',
    default: false,
  })
  overheadSuggestionHidden: boolean;
}
