import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';

/**
 * What one supplier charges for one material.
 *
 * `unitCost` is `numeric(14,4)` rather than the `(12,2)` used for prices, for
 * the same reason `Material.costPerUom` is: a unit cost gets divided before it
 * is multiplied back up by an order quantity, and rounding to two places there
 * compounds.
 */
@Entity('supplier_materials')
@Index('idx_supplier_materials_tenant', ['tenantId'])
@Index(
  'uq_supplier_materials_supplier_material',
  ['supplierId', 'materialId'],
  { unique: true },
)
export class SupplierMaterial extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @Column({ name: 'supplier_sku', type: 'varchar', length: 60, nullable: true })
  supplierSku: string | null;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  unitCost: number;

  /**
   * The smallest quantity this supplier will sell. A chat message asking for
   * 500 of something sold in boxes of 250 becomes a question, not a silent
   * rounding.
   */
  @Column({
    name: 'min_order_qty',
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  minOrderQty: number | null;

  @Column({ name: 'lead_time_days', type: 'int', nullable: true })
  leadTimeDays: number | null;

  /** Which supplier to propose when a message names a material but no supplier. */
  @Column({ name: 'is_preferred', type: 'boolean', default: false })
  isPreferred: boolean;
}
