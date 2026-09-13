import { Column, Entity, Index, OneToMany } from 'typeorm';
import type { PurchaseOrderStatus, RecordOrigin } from '@saas/shared';
import { SoftDeletableEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';

/**
 * An order placed on a supplier.
 *
 * Lines live in their own table rather than a `jsonb` column, which is the
 * deliberate departure from `Quote.items` and `Invoice.items`: those snapshots
 * are never partially fulfilled, and purchase order lines are received a few
 * at a time.
 */
@Entity('purchase_orders')
@Index('idx_purchase_orders_tenant', ['tenantId'])
@Index('uq_purchase_orders_tenant_number', ['tenantId', 'poNumber'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class PurchaseOrder extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'po_number', type: 'varchar', length: 40 })
  poNumber: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  /** Snapshot, as `invoice.customerName` is — the order records what was agreed. */
  @Column({ name: 'supplier_name', type: 'varchar', length: 120 })
  supplierName: string;

  @Column({
    type: 'enum',
    enum: [
      'DRAFT',
      'AWAITING_APPROVAL',
      'APPROVED',
      'SENT',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED',
    ],
    enumName: 'purchase_orders_status_enum',
    default: 'DRAFT',
  })
  status: PurchaseOrderStatus;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ name: 'order_date', type: 'timestamptz', default: () => 'now()' })
  orderDate: Date;

  @Column({ name: 'expected_date', type: 'timestamptz', nullable: true })
  expectedDate: Date | null;

  @Column({
    name: 'subtotal_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  subtotalAmount: number;

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalAmount: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /* ---- provenance ----------------------------------------------------
   * Generalises the `QuoteCreatedBy = 'AI' | 'HUMAN'` pattern. Without
   * these, an AI-drafted order that turns out wrong is unexplainable after
   * the fact: you cannot tell whether the model misread the message, the
   * prompt changed, or the person confirmed something they had not read.
   * ------------------------------------------------------------------ */

  @Column({
    type: 'enum',
    enum: ['HUMAN', 'AI_ASSISTED', 'AI_DRAFTED'],
    enumName: 'record_origin_enum',
    default: 'HUMAN',
  })
  origin: RecordOrigin;

  @Column({
    name: 'origin_channel',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  originChannel: string | null;

  @Column({
    name: 'origin_message_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originMessageId: string | null;

  @Column({
    name: 'origin_model',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  originModel: string | null;

  @Column({
    name: 'origin_prompt_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  originPromptVersion: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @OneToMany(() => PurchaseOrderLine, (line) => line.purchaseOrder, {
    cascade: ['insert'],
    eager: true,
  })
  lines: PurchaseOrderLine[];
}
