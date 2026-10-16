import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from './finance-account.entity';

/**
 * One period of a recurring expense. The unique (recurringExpenseId,
 * periodStart) row is the claim: whoever inserts it generates the bill, so two
 * replicas or a re-run can never bill a period twice.
 */
@Entity('recurring_expense_occurrences')
@Index(
  'uq_recurring_occurrence_period',
  ['recurringExpenseId', 'periodStart'],
  { unique: true },
)
@Index('idx_recurring_occurrences_tenant', ['tenantId'])
export class RecurringExpenseOccurrence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  recurringExpenseId: string;

  @Column({ type: 'int' })
  occurrenceIndex: number;

  @Column({ type: 'date' })
  periodStart: string;

  @Column({ type: 'date' })
  periodEnd: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'uuid', nullable: true })
  billId: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: 'GENERATED' | 'FAILED';

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
