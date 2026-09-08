import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { numericTransformer } from '@/modules/finance/entities/finance-account.entity';

@Entity('ai_usage_logs')
export class AiUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  /** Free-text feature tag, e.g. 'expense.scan_receipt' — no enum, so new features/models never need a migration. */
  @Column({ type: 'varchar', length: 100 })
  @Index()
  feature: string;

  @Column({ type: 'varchar', length: 50 })
  provider: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'int', default: 0 })
  inputTokens: number;

  @Column({ type: 'int', default: 0 })
  outputTokens: number;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 6,
    default: 0,
    transformer: numericTransformer,
  })
  estimatedCostUsd: number;

  @Column({ type: 'boolean', default: true })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
