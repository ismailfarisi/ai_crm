import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One reconciliation decision: these statement lines are these journal
 * entries.
 *
 * Usually one of each. A deposit of three cheques is one line and three
 * entries; a payroll booked once and paid out per person is many lines and
 * one entry. The lines point here through `bank_statement_lines.match_id`;
 * the entries are `BankMatchEntry` rows. Created in migration
 * 1790900000000-BankMatchGroups.
 */
@Entity('bank_matches')
@Index('idx_bank_matches_account', ['tenantId', 'financeAccountId'])
export class BankMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'finance_account_id', type: 'uuid' })
  financeAccountId: string;

  @Column({ name: 'matched_at', type: 'timestamptz', default: () => 'now()' })
  matchedAt: Date;

  @Column({ name: 'matched_by_id', type: 'uuid', nullable: true })
  matchedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** A journal entry a match covers. Each entry is reconciled once per account. */
@Entity('bank_match_entries')
@Index('idx_bank_match_entries_match', ['matchId'])
@Index('uq_bank_match_entries_entry', ['financeAccountId', 'journalEntryId'], {
  unique: true,
})
export class BankMatchEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'match_id', type: 'uuid' })
  matchId: string;

  @Column({ name: 'finance_account_id', type: 'uuid' })
  financeAccountId: string;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;
}
