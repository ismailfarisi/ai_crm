import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { JournalLineDto, JournalReferenceType } from '@saas/shared';
import { numericTransformer } from './finance-account.entity';

/**
 * At most one entry per (tenant, reference) for the postings that are
 * single by nature: an expense claim's accrual (`referenceId` = claim id) and
 * its reimbursement (`<claim id>:reimbursement`), and an account's opening
 * balance (`opening-balance:<account id>`). Other reference types legitimately
 * post several entries per reference — an invoice's payments and their
 * reversals, a revaluation and its reversal, a work order's stages — so the
 * index is partial. Created in migration 1789100000000-EnforceLedgerIntegrity.
 */
export const JOURNAL_SINGLE_POSTING_INDEX = 'uq_journal_entries_single_posting';

@Entity('journal_entries')
@Index(
  JOURNAL_SINGLE_POSTING_INDEX,
  ['tenantId', 'referenceType', 'referenceId'],
  {
    unique: true,
    where: `"referenceType" = 'EXPENSE' OR ("referenceType" = 'MANUAL' AND "referenceId" LIKE 'opening-balance:%')`,
  },
)
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_journal_entries_tenant_id')
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  entryNumber: string;

  @Column({
    type: 'enum',
    enum: [
      'EXPENSE',
      'INVOICE',
      'TRANSFER',
      'MANUAL',
      'STOCK',
      'BILL',
      'WORK_ORDER',
      'CREDIT_NOTE',
      'PREPAID',
    ],
    enumName: 'journal_entries_reference_type_enum',
    default: 'MANUAL',
  })
  referenceType: JournalReferenceType;

  @Column({ type: 'varchar', length: 255 })
  referenceId: string;

  @Column({ type: 'timestamptz' })
  entryDate: Date;

  /**
   * Debits must equal credits (rounded to the cent). Enforced by the
   * `journal_entries_enforce_balance` trigger as well as `LedgerService`, and
   * the row is append-only: an UPDATE is refused, corrections post a reversal.
   */
  @Column({ type: 'jsonb', default: [] })
  lines: JournalLineDto[];

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalAmount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** The currency the source document was in; null for entries from before multi-currency. */
  @Column({ type: 'char', length: 3, nullable: true })
  currency: string | null;

  /** Rate the lines were converted at. Lines themselves are always base currency. */
  @Column({
    name: 'fx_rate',
    type: 'numeric',
    precision: 18,
    scale: 8,
    default: 1,
    transformer: numericTransformer,
  })
  fxRate: number;
}
