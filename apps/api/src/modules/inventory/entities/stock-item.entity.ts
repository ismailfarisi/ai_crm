import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';

/**
 * What is on the shelf, per material per location.
 *
 * A cached projection of `stock_movements`, kept because every quote and
 * reorder check would otherwise replay the whole ledger. `replayMovements`
 * is what proves the two still agree.
 */
@Entity('stock_items')
@Index('idx_stock_items_tenant', ['tenantId'])
@Index(
  'uq_stock_items_material_location',
  ['tenantId', 'materialId', 'locationId'],
  {
    unique: true,
  },
)
export class StockItem extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({
    name: 'qty_on_hand',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyOnHand: number;

  /** Spoken for by released work, but not yet issued. */
  @Column({
    name: 'qty_reserved',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyReserved: number;

  /** Outstanding on purchase orders, so one shortage is not ordered twice. */
  @Column({
    name: 'qty_on_order',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyOnOrder: number;

  @Column({
    name: 'avg_unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  avgUnitCost: number;

  @Column({
    name: 'reorder_point',
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  reorderPoint: number | null;

  @Column({
    name: 'reorder_qty',
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  reorderQty: number | null;
}
