import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A month's pension contributions paid to the fund (Dr 2420 / Cr bank).
 * At most one live (non-voided) remittance per period.
 */
@Entity('pension_remittances')
@Index('uq_pension_remittances_live', ['tenantId', 'period'], {
  unique: true,
  where: '"voided_at" IS NULL',
})
export class PensionRemittance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** 'YYYY-MM'. */
  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ name: 'finance_account_id', type: 'uuid' })
  financeAccountId: string;

  @Column({ name: 'paid_at', type: 'timestamptz' })
  paidAt: Date;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @Column({ name: 'void_journal_entry_id', type: 'uuid', nullable: true })
  voidJournalEntryId: string | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
