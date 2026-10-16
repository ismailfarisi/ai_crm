import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { LeaveEntryKind } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';

/**
 * Movements in one employee's leave balance. Balance (days) = Σ days; the
 * leave salary provision carried for them (2410) = Σ amount. Append-only: a
 * void writes REVERSAL rows rather than deleting.
 */
@Entity('leave_ledger_entries')
@Index('idx_leave_ledger_employee', ['tenantId', 'employeeId'])
export class LeaveLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  /** CHECK lives in the migration. */
  @Column({ type: 'varchar', length: 20 })
  kind: LeaveEntryKind;

  /** Signed: TAKEN and ENCASHMENT are negative. */
  @Column({
    type: 'numeric',
    precision: 7,
    scale: 2,
    transformer: numericTransformer,
  })
  days: number;

  /** The provision value posted with this row, signed; null when none was. */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  amount: number | null;

  @Column({ name: 'as_of', type: 'date' })
  asOf: string;

  @Column({ name: 'run_line_id', type: 'uuid', nullable: true })
  runLineId: string | null;

  @Column({ name: 'settlement_id', type: 'uuid', nullable: true })
  settlementId: string | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
