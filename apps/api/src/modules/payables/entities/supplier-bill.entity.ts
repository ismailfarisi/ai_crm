import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BillMatchStatus, BillStatus } from '@saas/shared';
import { BaseEntity, SoftDeletableEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';

/**
 * What a supplier says they are owed.
 *
 * Nothing posts to the ledger until approval. A draft is a claim being
 * checked; an approved bill is a liability.
 */
@Entity('supplier_bills')
@Index('idx_supplier_bills_tenant', ['tenantId'])
@Index('idx_supplier_bills_po', ['purchaseOrderId'])
@Index('uq_supplier_bills_tenant_number', ['tenantId', 'billNumber'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
// Entering the same supplier invoice twice is the commonest way to pay twice.
@Index(
  'uq_supplier_bills_supplier_invoice',
  ['tenantId', 'supplierId', 'supplierInvoiceNumber'],
  { unique: true, where: '"deletedAt" IS NULL AND "status" <> \'CANCELLED\'' },
)
export class SupplierBill extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** Ours: BILL-2026-0001. */
  @Column({ name: 'bill_number', type: 'varchar', length: 40 })
  billNumber: string;

  /** Theirs, as printed on the invoice. */
  @Column({ name: 'supplier_invoice_number', type: 'varchar', length: 80 })
  supplierInvoiceNumber: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'supplier_name', type: 'varchar', length: 120 })
  supplierName: string;

  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: BillStatus;

  @Column({
    name: 'match_status',
    type: 'varchar',
    length: 20,
    default: 'UNMATCHED',
  })
  matchStatus: BillMatchStatus;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ name: 'bill_date', type: 'timestamptz' })
  billDate: Date;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date | null;

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
    name: 'tax_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  taxAmount: number;

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalAmount: number;

  @Column({
    name: 'paid_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  paidAmount: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById: string | null;

  /** Set when a variance was accepted, so an auditor can see it was a decision. */
  @Column({ name: 'variance_approved', type: 'boolean', default: false })
  varianceApproved: boolean;

  @Column({ name: 'dispute_reason', type: 'text', nullable: true })
  disputeReason: string | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @OneToMany(() => SupplierBillLine, (line) => line.bill, {
    cascade: ['insert'],
    eager: true,
  })
  lines: SupplierBillLine[];
}

@Entity('supplier_bill_lines')
@Index('idx_supplier_bill_lines_bill', ['billId'])
@Index('idx_supplier_bill_lines_po_line', ['purchaseOrderLineId'])
export class SupplierBillLine extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'bill_id', type: 'uuid' })
  billId: string;

  @ManyToOne(() => SupplierBill, (bill) => bill.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bill_id' })
  bill: SupplierBill;

  @Column({ name: 'purchase_order_line_id', type: 'uuid', nullable: true })
  purchaseOrderLineId: string | null;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  qty: number;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  unitCost: number;

  /** The ordered price at entry — what GRNI was credited at when the goods arrived. */
  @Column({
    name: 'order_unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  orderUnitCost: number | null;

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

/**
 * Money out against a bill. Reversal stamps `reversedAt` rather than deleting,
 * so the history of what was paid stays readable.
 */
@Entity('bill_payments')
@Index('idx_bill_payments_bill', ['billId'])
export class BillPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'bill_id', type: 'uuid' })
  billId: string;

  @Column({ name: 'finance_account_id', type: 'uuid' })
  financeAccountId: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ name: 'paid_at', type: 'timestamptz' })
  paidAt: Date;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  @Column({ name: 'recorded_by_id', type: 'uuid', nullable: true })
  recordedById: string | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'reversed_by_id', type: 'uuid', nullable: true })
  reversedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
