import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { GratuityEntryKind } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * Movements in one employee's end-of-service provision. Balance = Σ amount.
 * Append-only: a void writes REVERSAL rows rather than deleting. The CHECK in
 * the migration also admits SETTLEMENT, reserved for the final-settlement work.
 */
@Entity('gratuity_ledger_entries')
@Index('idx_gratuity_ledger_employee', ['tenantId', 'employeeId'])
export class GratuityLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ type: 'varchar', length: 20 })
  kind: GratuityEntryKind | 'SETTLEMENT';

  /** Signed: a true-up after a pay cut is negative. */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ name: 'as_of', type: 'date' })
  asOf: string;

  @Column({ name: 'run_line_id', type: 'uuid', nullable: true })
  runLineId: string | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
