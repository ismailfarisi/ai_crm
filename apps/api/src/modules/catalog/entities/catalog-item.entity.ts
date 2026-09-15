import { Column, Entity, Index } from 'typeorm';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A flat sellable item — the degenerate case of a product template: fixed
 * price, fixed cost, no parameters. Buy-and-resell stock, a standing service,
 * a delivery charge.
 *
 * Anything whose cost depends on its dimensions belongs in `product_templates`
 * instead.
 */
@Entity('catalog_items')
@Index('idx_catalog_items_tenant', ['tenantId'])
@Index('uq_catalog_items_tenant_sku', ['tenantId', 'sku'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class CatalogItem extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 60 })
  sku: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 40, default: 'Units' })
  uom: string;

  @Column({
    name: 'list_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  listPrice: number;

  @Column({
    name: 'standard_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  standardCost: number;

  /** Percentage, matching `QuoteLineItem.taxRate`. */
  @Column({
    name: 'tax_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  taxRate: number;

  @Column({ name: 'lead_time_days', type: 'integer', default: 0 })
  leadTimeDays: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** The item's own tax treatment. A customer rule can still override it, e.g. reverse charge. */
  @Column({ name: 'tax_code_id', type: 'uuid', nullable: true })
  taxCodeId: string | null;

  /**
   * Set when this item is sold from stock: dispatching it on a delivery note
   * takes this material off the shelf. Null for services and made-to-order
   * goods, which are costed through work orders instead.
   */
  @Column({ name: 'stock_material_id', type: 'uuid', nullable: true })
  stockMaterialId: string | null;
}
