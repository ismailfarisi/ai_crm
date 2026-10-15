import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { RecurringInterval } from '@saas/shared';
import { FinanceAccount, numericTransformer } from './finance-account.entity';
import { Supplier } from '../../purchasing/entities/supplier.entity';

@Entity('recurring_expenses')
export class RecurringExpense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_recurring_expenses_tenant_id')
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  vendorName: string;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({ type: 'uuid', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'],
    enumName: 'recurring_expenses_billing_interval_enum',
    default: 'MONTHLY',
  })
  billingInterval: RecurringInterval;

  @Column({ type: 'timestamptz' })
  nextBillingDate: Date;

  /** Anchor every occurrence is computed from. */
  @Column({ type: 'date' })
  startDate: string;

  /** No occurrence on or after this date. */
  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'uuid', nullable: true })
  taxCodeId: string | null;

  @Column({ type: 'boolean', default: false })
  autoApprove: boolean;

  /** Who switched auto-approve on; approvals run as them, with their current permissions. */
  @Column({ type: 'uuid', nullable: true })
  autoApproveById: string | null;

  @Column({ type: 'boolean', default: false })
  spreadOverPeriod: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'uuid', nullable: true })
  financeAccountId: string | null;

  @ManyToOne(() => FinanceAccount, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'financeAccountId' })
  financeAccount?: FinanceAccount;

  @Column({
    type: 'enum',
    enum: ['ACTIVE', 'PAUSED', 'CANCELLED'],
    enumName: 'recurring_expenses_status_enum',
    default: 'ACTIVE',
  })
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
