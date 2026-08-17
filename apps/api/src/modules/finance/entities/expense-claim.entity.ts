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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
