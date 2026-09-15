import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  CreditNoteStatus,
  DeliveryNoteStatus,
  TaxBreakdownLine,
} from '@saas/shared';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

const money = (name: string) =>
  ({
    name,
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  }) as const;

@Entity('credit_notes')
@Index('idx_credit_notes_tenant', ['tenantId'])
@Index('idx_credit_notes_invoice', ['invoiceId'])
@Index('uq_credit_notes_tenant_number', ['tenantId', 'creditNoteNumber'], {
  unique: true,
  where: '"credit_note_number" IS NOT NULL',
})
export class CreditNote extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** Allocated on issue, so a discarded draft leaves no gap in the numbering. */
  @Column({
    name: 'credit_note_number',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  creditNoteNumber: string | null;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: CreditNoteStatus;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255 })
  customerName: string;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'text' })
  reason: string;

  @Column(money('subtotal_amount'))
  subtotalAmount: number;

  @Column(money('tax_amount'))
  taxAmount: number;

  @Column(money('total_amount'))
  totalAmount: number;

  @Column(money('refunded_amount'))
  refundedAmount: number;

  @Column({ name: 'tax_breakdown', type: 'jsonb', default: [] })
  taxBreakdown: TaxBreakdownLine[];

  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt: Date | null;

  @Column({ name: 'issued_by_id', type: 'uuid', nullable: true })
  issuedById: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;
}

@Entity('credit_note_lines')
@Index('idx_credit_note_lines_note', ['creditNoteId'])
export class CreditNoteLine extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'credit_note_id', type: 'uuid' })
  creditNoteId: string;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  qty: number;

  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  unitPrice: number;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  net: number;

  @Column({
    name: 'tax_rate',
    type: 'numeric',
    precision: 7,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  taxRate: number;

  @Column({ name: 'tax_code_id', type: 'uuid', nullable: true })
  taxCodeId: string | null;

  @Column({ name: 'tax_code', type: 'varchar', length: 20, nullable: true })
  taxCode: string | null;

  @Column({ name: 'reverse_charge', type: 'boolean', default: false })
  reverseCharge: boolean;
}

@Entity('credit_note_refunds')
@Index('idx_credit_note_refunds_note', ['creditNoteId'])
export class CreditNoteRefund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'credit_note_id', type: 'uuid' })
  creditNoteId: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'finance_account_id', type: 'uuid' })
  financeAccountId: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  @Column({ name: 'refunded_at', type: 'timestamptz' })
  refundedAt: Date;

  @Column({ name: 'recorded_by_id', type: 'uuid', nullable: true })
  recordedById: string | null;
}

@Entity('delivery_notes')
@Index('idx_delivery_notes_order', ['salesOrderId'])
@Index('uq_delivery_notes_tenant_number', ['tenantId', 'deliveryNoteNumber'], {
  unique: true,
})
export class DeliveryNote extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'delivery_note_number', type: 'varchar', length: 40 })
  deliveryNoteNumber: string;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: DeliveryNoteStatus;

  @Column({ name: 'sales_order_id', type: 'uuid' })
  salesOrderId: string;

  @Column({ name: 'customer_name', type: 'varchar', length: 255 })
  customerName: string;

  @Column({ name: 'ship_to', type: 'text', nullable: true })
  shipTo: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  carrier: string | null;

  @Column({
    name: 'tracking_reference',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  trackingReference: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @Column({ name: 'dispatched_by_id', type: 'uuid', nullable: true })
  dispatchedById: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;
}

@Entity('delivery_note_lines')
@Index('idx_delivery_note_lines_note', ['deliveryNoteId'])
@Index('idx_delivery_note_lines_order_line', ['salesOrderLineId'])
export class DeliveryNoteLine extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'delivery_note_id', type: 'uuid' })
  deliveryNoteId: string;

  @Column({ name: 'sales_order_line_id', type: 'uuid' })
  salesOrderLineId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  uom: string | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  qty: number;

  @Column({ name: 'stock_material_id', type: 'uuid', nullable: true })
  stockMaterialId: string | null;

  @Column({ name: 'stock_movement_id', type: 'uuid', nullable: true })
  stockMovementId: string | null;
}
