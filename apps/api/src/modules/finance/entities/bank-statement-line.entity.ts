import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BankStatementLineStatus } from '@saas/shared';
import { numericTransformer } from './finance-account.entity';

/**
 * One line of a bank statement, imported to be reconciled against the ledger.
 *
 * Matched to at most one journal entry per account: the entry that moved this
 * account's ledger account by the same amount. `fingerprint` is the date,
 * amount, description and reference hashed together, so importing a
 * statement that overlaps the last one skips the lines already there.
 * Created in migration 1790500000000-AccountingCore.
 */
@Entity('bank_statement_lines')
@Index('idx_bank_statement_lines_account', [
  'tenantId',
  'financeAccountId',
  'statementDate',
])
@Index(
  'uq_bank_statement_lines_fingerprint',
  ['tenantId', 'financeAccountId', 'fingerprint'],
  { unique: true },
)
@Index(
  'uq_bank_statement_lines_entry',
  ['financeAccountId', 'journalEntryId'],
  { unique: true, where: '"journal_entry_id" IS NOT NULL' },
)
export class BankStatementLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'finance_account_id', type: 'uuid' })
  financeAccountId: string;

  @Column({ name: 'statement_date', type: 'date' })
  statementDate: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  /** Money in is positive. In the account's own currency. */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  /** CHECK in the migration. */
  @Column({ type: 'varchar', length: 20, default: 'UNMATCHED' })
  status: BankStatementLineStatus;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'matched_at', type: 'timestamptz', nullable: true })
  matchedAt: Date | null;

  @Column({ name: 'matched_by_id', type: 'uuid', nullable: true })
  matchedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
