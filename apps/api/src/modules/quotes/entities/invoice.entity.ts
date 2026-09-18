import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { QuoteLineItem, TaxBreakdownLine } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

export enum InvoiceStatus {
  ISSUED = 'ISSUED',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

@Entity('invoices')
@Index('idx_invoices_tenant_id', ['tenantId'])
@Index('idx_invoices_quote', ['quoteId'])
@Index('idx_invoices_sales_order', ['salesOrderId'])
// One invoice per billing stage. This took over from the old one-invoice-per-
// quote index as the thing that stops a raced approval billing twice.
@Index('uq_invoices_delivery_note', ['deliveryNoteId'], {
  unique: true,
  where: '"delivery_note_id" IS NOT NULL',
})
@Index('uq_invoices_billing_line', ['billingScheduleLineId'], {
  unique: true,
  where: '"billing_schedule_line_id" IS NOT NULL',
})
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId: string | null;

  @Column({ name: 'billing_schedule_line_id', type: 'uuid', nullable: true })
  billingScheduleLineId: string | null;

  /** "30% deposit" — printed on the invoice so a customer knows which stage it is. */
  @Column({ name: 'stage_label', type: 'varchar', length: 120, nullable: true })
  stageLabel: string | null;

  /** Set when the invoice bills what one delivery carried. */
  @Column({ name: 'delivery_note_id', type: 'uuid', nullable: true })
  deliveryNoteId: string | null;

  /** Net and tax per code, as posted. Null on invoices from before tax codes. */
  @Column({ name: 'tax_breakdown', type: 'jsonb', nullable: true })
  taxBreakdown: TaxBreakdownLine[] | null;

  /** Sum of issued credit notes. */
  @Column({
    name: 'credited_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  creditedAmount: number;

  /** Money paid back to the customer against credit notes on this invoice. */
  @Column({
    name: 'refunded_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  refundedAmount: number;

  @Column({ name: 'invoice_number', type: 'varchar' })
  invoiceNumber: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({
    name: 'customer_name',
    type: 'varchar',
    length: 255,
    default: 'General Customer',
  })
  customerName: string;

  @Column({
    name: 'customer_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  customerEmail: string | null;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'jsonb', default: [] })
  items: QuoteLineItem[];

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
    name: 'discount_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  discountAmount: number;

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
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    enumName: 'invoices_status_enum',
    default: InvoiceStatus.ISSUED,
  })
  status: InvoiceStatus;

  @Column({
    name: 'payment_terms',
    type: 'varchar',
    length: 50,
    default: 'immediate',
  })
  paymentTerms: string;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({
    name: 'paid_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null | undefined) => value,
      from: (value: string | number | null | undefined) =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  paidAmount: number | null;

  @Column({ name: 'paid_via_account_id', type: 'uuid', nullable: true })
  paidViaAccountId: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'voided_by_id', type: 'uuid', nullable: true })
  voidedById: string | null;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null;

  @Column({ name: 'overdue_notified_at', type: 'timestamptz', nullable: true })
  overdueNotifiedAt: Date | null;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  /**
   * Base currency per unit of this document's currency, as it was posted.
   * Stays as it was: a report rerun next year must say what it said today.
   */
  @Column({
    name: 'fx_rate',
    type: 'numeric',
    precision: 18,
    scale: 8,
    default: 1,
    transformer: numericTransformer,
  })
  fxRate: number;

  /**
   * The quote's own document number, joined in for display.
   *
   * Not a column: the invoices list used to print `quoteId` — a raw UUID —
   * in a column labelled "Quote ID", where every other screen in the product
   * shows `QT-2026-0001`. Populated by the list and single-invoice reads.
   */
  quoteNumber?: string | null;
}
