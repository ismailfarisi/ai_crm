import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/** Where the absorption debited: WIP for an open job, COGS for a completed one. */
export type WorkOrderLabourAccount = 'WIP' | 'COGS';
/** Where WIP labour went later: COGS on completion, back to expense on cancel. */
export type WorkOrderLabourClearedTo = 'COGS' | 'EXPENSE';

/**
 * One employee's absorbed labour on one work order from one payroll run.
 * Written by the run's approval, deleted by its void.
 *
 * Foreign keys and CHECKs (account, cleared_to) live in the migration.
 */
@Entity('work_order_labour')
@Index('idx_work_order_labour_work_order', ['workOrderId'])
@Index('idx_work_order_labour_run', ['runId'])
export class WorkOrderLabour {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'work_order_id', type: 'uuid' })
  workOrderId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Column({ name: 'run_line_id', type: 'uuid' })
  runLineId: string;

  /** 'YYYY-MM'. */
  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({
    type: 'numeric',
    precision: 7,
    scale: 2,
    transformer: numericTransformer,
  })
  hours: number;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 4,
    transformer: numericTransformer,
  })
  rate: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'varchar', length: 4 })
  account: WorkOrderLabourAccount;

  @Column({ name: 'cleared_to', type: 'varchar', length: 7, nullable: true })
  clearedTo: WorkOrderLabourClearedTo | null;

  @Column({ name: 'cleared_at', type: 'timestamptz', nullable: true })
  clearedAt: Date | null;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
