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
import { FinanceAccount, numericTransformer } from './finance-account.entity';

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
    enum: ['MONTHLY', 'ANNUAL'],
    enumName: 'recurring_expenses_billing_interval_enum',
    default: 'MONTHLY',
  })
  billingInterval: 'MONTHLY' | 'ANNUAL';

  @Column({ type: 'timestamptz' })
  nextBillingDate: Date;

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
