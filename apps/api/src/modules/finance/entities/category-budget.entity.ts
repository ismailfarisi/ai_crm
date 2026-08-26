import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { BudgetPeriod } from '@saas/shared';
import { numericTransformer } from './finance-account.entity';

@Entity('category_budgets')
export class CategoryBudget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_category_budgets_tenant_id')
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({
    type: 'enum',
    enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL'],
    enumName: 'category_budgets_period_enum',
    default: 'MONTHLY',
  })
  period: BudgetPeriod;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  budgetAmount: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  spentAmount: number;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 80,
    transformer: numericTransformer,
  })
  alertThresholdPercent: number;

  @Column({ type: 'timestamptz' })
  startDate: Date;

  @Column({ type: 'timestamptz' })
  endDate: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
