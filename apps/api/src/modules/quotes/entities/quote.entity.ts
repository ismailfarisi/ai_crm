import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BillingStage, QuoteLineItem } from '@saas/shared';

export enum QuoteCreatedBy {
  AI = 'AI',
  HUMAN = 'HUMAN',
}

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('quotes')
@Index('idx_quotes_tenant_id', ['tenantId'])
@Index('idx_quotes_tenant_number', ['tenantId', 'quoteNumber'])
@Index('idx_quotes_parent', ['parentQuoteId'])
@Index('uq_quotes_acceptance_token', ['acceptanceTokenHash'], {
  unique: true,
  where: '"acceptance_token_hash" IS NOT NULL',
})
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'quote_number', type: 'varchar', length: 60, nullable: true })
  quoteNumber: string | null;

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

  @Column({
    type: 'enum',
    enum: QuoteCreatedBy,
    enumName: 'quotes_created_by_enum',
    default: QuoteCreatedBy.HUMAN,
  })
  createdBy: QuoteCreatedBy;

  @Column({
    type: 'enum',
    enum: QuoteStatus,
    enumName: 'quotes_status_enum',
    default: QuoteStatus.DRAFT,
  })
  status: QuoteStatus;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Column({
    name: 'payment_terms',
    type: 'varchar',
    length: 50,
    default: 'immediate',
  })
  paymentTerms: string;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  @Column({ type: 'jsonb', default: [] })
  items: QuoteLineItem[];

  @Column({
    name: 'subtotal_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  subtotalAmount: number;

  @Column({
    name: 'discount_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  discountAmount: number;

  @Column({
    name: 'tax_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  taxAmount: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'terms_and_conditions', type: 'text', nullable: true })
  termsAndConditions: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'workflow_id', type: 'varchar', nullable: true })
  workflowId: string | null;

  /** Null means the default: everything, invoiced on approval. */
  @Column({ name: 'billing_schedule', type: 'jsonb', nullable: true })
  billingSchedule: BillingStage[] | null;

  /**
   * SHA-256 of the customer's acceptance link token. The token itself is
   * never stored: anyone who can read this table must not be able to accept
   * a quote on a customer's behalf.
   */
  @Column({
    name: 'acceptance_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  acceptanceTokenHash: string | null;

  @Column({
    name: 'acceptance_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  acceptanceExpiresAt: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({
    name: 'accepted_by_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  acceptedByName: string | null;

  @Column({ name: 'accepted_ip', type: 'varchar', length: 64, nullable: true })
  acceptedIp: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'parent_quote_id', type: 'uuid', nullable: true })
  parentQuoteId: string | null;

  /** Set when a revision replaced this quote. A superseded quote cannot be accepted or approved. */
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
