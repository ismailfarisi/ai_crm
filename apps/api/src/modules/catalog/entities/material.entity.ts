import { Column, Entity, Index } from 'typeorm';
import type { GrainDirection, MaterialUom } from '@saas/shared';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from './numeric.transformer';

/**
 * Raw stock the shop buys: board, paper, ribbon, magnets, glue.
 *
 * `costPerUom` is `numeric(14,4)` rather than the `(12,2)` used for prices. A
 * unit cost gets divided (sheets into pieces, kilos into grams) and rounding
 * to two places there compounds once it is multiplied back up by an order
 * quantity.
 */
@Entity('catalog_materials')
@Index('idx_catalog_materials_tenant', ['tenantId'])
@Index('uq_catalog_materials_tenant_sku', ['tenantId', 'sku'], {
  unique: true,
  where: '"sku" IS NOT NULL AND "deletedAt" IS NULL',
})
export class Material extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  sku: string | null;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  uom: MaterialUom;

  @Column({
    name: 'cost_per_uom',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  costPerUom: number;

  @Column({
    name: 'sheet_width_mm',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  sheetWidthMm: number | null;

  @Column({
    name: 'sheet_height_mm',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  sheetHeightMm: number | null;

  @Column({ type: 'varchar', length: 10, default: 'NONE' })
  grain: GrainDirection;

  @Column({
    name: 'waste_pct',
    type: 'numeric',
    precision: 5,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  wastePct: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
