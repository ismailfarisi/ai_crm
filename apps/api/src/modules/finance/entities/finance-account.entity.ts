import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { AccountType } from '@saas/shared';

export const numericTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | number | null | undefined): number => {
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return isNaN(parsed) ? 0 : parsed;
  },
};

@Entity('finance_accounts')
export class FinanceAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_finance_accounts_tenant_id')
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: ['BANK', 'CASH', 'CREDIT_CARD', 'CLEARING'],
    enumName: 'finance_accounts_account_type_enum',
    default: 'BANK',
  })
  accountType: AccountType;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  balance: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  accountNumber: string | null;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  /**
   * The chart-of-accounts row this cash account posts through.
   *
   * Nullable only so the backfill can run; `LedgerService.ensureCashLedgerAccount`
   * creates one on first use for any account that somehow lacks it.
   */
  @Column({ name: 'ledger_account_id', type: 'uuid', nullable: true })
  ledgerAccountId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
