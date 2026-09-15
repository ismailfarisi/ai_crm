import { Column, Entity, Index } from 'typeorm';
import type {
  BillingKind,
  BillingTrigger,
  SalesOrderStatus,
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

/**
 * What the customer has committed to buy.
 *
 * Created once per quote, when the quote is approved. The quote stays the
 * commercial document the customer saw; the order is what production and
 * billing work from, and it does not change when someone edits a draft
 * revision of the quote afterwards.
 *
 * Lines and billing stages are plain columns rather than TypeORM relations:
 * a relation would have TypeORM invent its own foreign-key names and report
 * the migration's names as drift.
 */
@Entity('sales_orders')
@Index('idx_sales_orders_tenant', ['tenantId'])
// One order per quote. This is what makes approval idempotent across the
// synchronous path and the Temporal activity, which can both try.
@Index('uq_sales_orders_quote', ['quoteId'], { unique: true })
@Index('uq_sales_orders_tenant_number', ['tenantId', 'orderNumber'], {
  unique: true,
})
export class SalesOrder extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'order_number', type: 'varchar', length: 40 })
  orderNumber: string;

  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @Column({ name: 'quote_number', type: 'varchar', length: 60, nullable: true })
  quoteNumber: string | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255 })
  customerName: string;

  @Column({
    name: 'customer_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  customerEmail: string | null;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: SalesOrderStatus;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({
    name: 'payment_terms',
    type: 'varchar',
    length: 50,
    default: 'immediate',
  })
  paymentTerms: string;

  @Column(money('subtotal_amount'))
  subtotalAmount: number;

  @Column(money('discount_amount'))
  discountAmount: number;

  @Column(money('tax_amount'))
  taxAmount: number;

  @Column(money('total_amount'))
  totalAmount: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;
}

@Entity('sales_order_lines')
@Index('idx_sales_order_lines_order', ['salesOrderId'])
export class SalesOrderLine extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sales_order_id', type: 'uuid' })
  salesOrderId: string;

  @Column({ type: 'int' })
  sequence: number;

  /** The quote line's own id, so a line can be traced back to what was quoted. */
  @Column({
    name: 'quote_line_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  quoteLineId: string | null;

  @Column({ name: 'catalog_item_id', type: 'uuid', nullable: true })
  catalogItemId: string | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  uom: string | null;

  @Column({
    name: 'qty_ordered',
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  qtyOrdered: number;

  @Column({
    name: 'qty_fulfilled',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyFulfilled: number;

  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  unitPrice: number;

  @Column(money('line_total'))
  lineTotal: number;
}

/**
 * One stage of an order's billing: a deposit, a milestone, the balance.
 *
 * Amounts are fixed when the order is created, from the quote's totals, so
 * the customer is invoiced exactly what they agreed to even if tax rates or
 * prices change before the last stage is raised.
 */
@Entity('billing_schedule_lines')
@Index('uq_billing_schedule_lines_order_seq', ['salesOrderId', 'sequence'], {
  unique: true,
})
export class BillingScheduleLine extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sales_order_id', type: 'uuid' })
  salesOrderId: string;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'varchar', length: 20 })
  kind: BillingKind;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({
    type: 'numeric',
    precision: 7,
    scale: 3,
    transformer: numericTransformer,
  })
  percent: number;

  @Column({ type: 'varchar', length: 20 })
  trigger: BillingTrigger;

  @Column(money('subtotal_amount'))
  subtotalAmount: number;

  @Column(money('discount_amount'))
  discountAmount: number;

  @Column(money('tax_amount'))
  taxAmount: number;

  @Column(money('total_amount'))
  totalAmount: number;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ name: 'invoiced_at', type: 'timestamptz', nullable: true })
  invoicedAt: Date | null;
}
