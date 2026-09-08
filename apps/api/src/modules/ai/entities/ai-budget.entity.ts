import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { numericTransformer } from '@/modules/finance/entities/finance-account.entity';

@Entity('ai_budgets')
export class AiBudget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_ai_budgets_organization_id', { unique: true })
  organizationId: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  monthlyBudgetUsd: number;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 80,
    transformer: numericTransformer,
  })
  alertThresholdPercent: number;

  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
