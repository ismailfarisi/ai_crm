import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { TimesheetIndirectCategory, TimesheetSource } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * Hours one employee spent on one day: on a work order's operation (direct)
 * or on an indirect category. `runLineId` is set when the month's payroll
 * absorbs them, and from then on the entry is locked until a void.
 *
 * Foreign keys and CHECKs (one of operation / indirect category, hours in
 * (0, 24]) live in the migration.
 */
@Entity('timesheet_entries')
@Index('idx_timesheet_entries_employee_date', [
  'tenantId',
  'employeeId',
  'workDate',
])
@Index('idx_timesheet_entries_operation', ['operationId'])
@Index('idx_timesheet_entries_work_order', ['workOrderId'])
export class TimesheetEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  /** 'YYYY-MM-DD'. */
  @Column({ name: 'work_date', type: 'date' })
  workDate: string;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: numericTransformer,
  })
  hours: number;

  @Column({ name: 'work_order_id', type: 'uuid', nullable: true })
  workOrderId: string | null;

  @Column({ name: 'operation_id', type: 'uuid', nullable: true })
  operationId: string | null;

  @Column({
    name: 'indirect_category',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  indirectCategory: TimesheetIndirectCategory | null;

  @Column({ type: 'varchar', length: 10, default: 'MANUAL' })
  source: TimesheetSource;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** The payroll run line that absorbed this entry; null until approval. */
  @Column({ name: 'run_line_id', type: 'uuid', nullable: true })
  runLineId: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
