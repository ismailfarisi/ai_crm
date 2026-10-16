import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/** A bill line booked to prepaid expenses, released to its expense account one month at a time. */
@Entity('prepaid_schedules')
@Index('idx_prepaid_schedules_tenant', ['tenantId'])
@Index('uq_prepaid_schedules_bill_line', ['billLineId'], { unique: true })
export class PrepaidSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'bill_id', type: 'uuid' })
  billId: string;

  @Column({ name: 'bill_line_id', type: 'uuid' })
  billLineId: string;

  @Column({ name: 'expense_role', type: 'varchar', length: 40 })
  expenseRole: string;

  /** Exactly what was debited to 1400, in base currency, so the account clears to zero. */
  @Column({
    name: 'total_base',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  totalBase: number;

  @Column({ name: 'first_month', type: 'date' })
  firstMonth: string;

  @Column({ type: 'int' })
  months: number;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'COMPLETED' | 'ENDED_EARLY';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** One month released from a prepaid schedule; unique per (schedule, month). */
@Entity('prepaid_amortizations')
@Index('uq_prepaid_amortization_month', ['scheduleId', 'month'], {
  unique: true,
})
@Index('idx_prepaid_amortizations_tenant', ['tenantId'])
export class PrepaidAmortization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @Column({ type: 'date' })
  month: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
