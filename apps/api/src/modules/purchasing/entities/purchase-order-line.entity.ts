import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { MaterialUom } from '@saas/shared';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { PurchaseOrder } from './purchase-order.entity';

/**
 * One line of a purchase order.
 *
 * `qtyOrdered` and `qtyReceived` are separate because a line is received in
 * instalments — that difference is the whole reason lines are a table rather
 * than a `jsonb` snapshot.
 */
@Entity('purchase_order_lines')
@Index('idx_purchase_order_lines_po', ['purchaseOrderId'])
export class PurchaseOrderLine extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'purchase_order_id', type: 'uuid' })
  purchaseOrderId: string;

  @ManyToOne(() => PurchaseOrder, (po) => po.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder: PurchaseOrder;

  /** Null for a free-text line — a delivery charge, a one-off part. */
  @Column({ name: 'material_id', type: 'uuid', nullable: true })
  materialId: string | null;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({
    name: 'qty_ordered',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyOrdered: number;

  @Column({
    name: 'qty_received',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyReceived: number;

  @Column({ type: 'varchar', length: 10 })
  uom: MaterialUom;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  unitCost: number;

  @Column({
    name: 'line_total',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  lineTotal: number;
}
