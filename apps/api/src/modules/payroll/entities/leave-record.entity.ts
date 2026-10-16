import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LeaveType } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A dated absence recorded by HR. Feeds the run lines (sick, unpaid, half-pay
 * days) and the leave ledger (annual days taken). Calendar days; `days` may be
 * edited below the calendar count for half days. CHECKs live in the migration.
 */
@Entity('leave_records')
@Index('idx_leave_records_employee', ['tenantId', 'employeeId'])
export class LeaveRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ type: 'varchar', length: 20 })
  type: LeaveType;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    transformer: numericTransformer,
  })
  days: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
