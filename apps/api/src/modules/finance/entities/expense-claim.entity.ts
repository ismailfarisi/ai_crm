import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { ExpenseStatus, ExpenseItemDto } from '@saas/shared';
import { numericTransformer } from './finance-account.entity';

@Entity('expense_claims')
export class ExpenseClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_expense_claims_tenant_id')
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  claimNumber: string;

  @Column({ type: 'varchar', length: 255 })
  employeeId: string;

  @Column({ type: 'varchar', length: 255 })
  employeeName: string;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({
    type: 'enum',
    enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'],
    enumName: 'expense_claims_status_enum',
    default: 'DRAFT',
  })
  status: ExpenseStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  merchantName: string | null;

  @Column({ type: 'timestamptz' })
  expenseDate: Date;

  @Column({ type: 'text', nullable: true })
  receiptUrl: string | null;

  /** What the claimant wrote: the business purpose, who was there. */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reimbursedAt: Date | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  temporalWorkflowId: string | null;

  @Column({ type: 'jsonb', default: [] })
  items: ExpenseItemDto[];

  /** The customer order this expense was for, so it counts against that job. */
  @Column({ type: 'uuid', nullable: true })
  @Index('idx_expense_claims_sales_order')
  salesOrderId: string | null;

  /**
   * The purchase tax code for the VAT on the receipt. Null means no VAT: the
   * whole amount is cost, as on every claim from before claims carried tax.
   */
  @Column({ type: 'uuid', nullable: true })
  taxCodeId: string | null;

  /** The VAT inside `amount`, as the receipt shows it. */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  taxAmount: number;

  /** The supplier's tax number (TRN) from the receipt. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  supplierTaxId: string | null;

  /**
   * The VAT that went to the tax account when the claim was approved. Fixed
   * then, so the tax report states what was posted even if the code changes.
   */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  recoverableTax: number;

  /** VAT self-assessed at approval on a reverse-charge code. */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  reverseChargeTax: number;

  /** Base currency per unit of `currency` the claim was posted at. */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 8,
    default: 1,
    transformer: numericTransformer,
  })
  fxRate: number;

  /**
   * When the claim reached the books. The tax return takes the claim in the
   * period this falls in, the way a bill is taken when it is approved.
   */
  @Column({ type: 'timestamptz', nullable: true })
  taxPostedAt: Date | null;

  /** When an approved claim was rejected and its posting reversed. */
  @Column({ type: 'timestamptz', nullable: true })
  taxReversedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
