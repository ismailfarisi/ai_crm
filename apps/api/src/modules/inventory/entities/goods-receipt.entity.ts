import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity, SoftDeletableEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A delivery, booked in against a purchase order.
 *
 * Immutable once created: receiving the wrong quantity is corrected by a
 * further movement, not by editing history. The stock ledger and the journal
 * both already depend on this row having happened.
 */
@Entity('goods_receipts')
@Index('idx_goods_receipts_tenant', ['tenantId'])
@Index('idx_goods_receipts_po', ['purchaseOrderId'])
export class GoodsReceipt extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'receipt_number', type: 'varchar', length: 40 })
  receiptNumber: string;

  @Column({ name: 'purchase_order_id', type: 'uuid' })
  purchaseOrderId: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'received_by_id', type: 'uuid', nullable: true })
  receivedById: string | null;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  /** The supplier's own delivery note reference, for matching against their bill. */
  @Column({
    name: 'supplier_reference',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  supplierReference: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Total value received, at the price on the order. Posts to the ledger. */
  @Column({
    name: 'total_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalValue: number;

  /** The journal entry this receipt produced: Dr Inventory, Cr GRNI. */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @OneToMany(() => GoodsReceiptLine, (line) => line.goodsReceipt, {
    cascade: ['insert'],
    eager: true,
  })
  lines: GoodsReceiptLine[];
}

@Entity('goods_receipt_lines')
@Index('idx_goods_receipt_lines_receipt', ['goodsReceiptId'])
export class GoodsReceiptLine extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'goods_receipt_id', type: 'uuid' })
  goodsReceiptId: string;

  @ManyToOne(() => GoodsReceipt, (receipt) => receipt.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'goods_receipt_id' })
  goodsReceipt: GoodsReceipt;

  @Column({ name: 'purchase_order_line_id', type: 'uuid' })
  purchaseOrderLineId: string;

  @Column({ name: 'material_id', type: 'uuid', nullable: true })
  materialId: string | null;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({
    name: 'qty_received',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyReceived: number;

  /**
   * Arrived but refused — damaged, wrong spec.
   *
   * Recorded separately rather than netted off, because the supplier still
   * sent it and their bill will say so.
   */
  @Column({
    name: 'qty_rejected',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyRejected: number;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  unitCost: number;

  @Column({ name: 'stock_movement_id', type: 'uuid', nullable: true })
  stockMovementId: string | null;
}
