import { Column, Entity, Index } from 'typeorm';
import type { LedgerAccountType, LedgerRole } from '@saas/shared';
import { SoftDeletableEntity } from '@/common/entities/base.entity';

/**
 * One line of a tenant's chart of accounts.
 *
 * Distinct from `FinanceAccount`, which models a real bank, cash or card
 * balance the business can move money between. A cash account points at its
 * ledger account; every other ledger account (receivable, payable, sales,
 * COGS) has no cash behind it at all.
 */
@Entity('ledger_accounts')
@Index('idx_ledger_accounts_tenant', ['tenantId'])
@Index('uq_ledger_accounts_tenant_code', ['tenantId', 'code'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('uq_ledger_accounts_tenant_role', ['tenantId', 'role'], {
  unique: true,
  where: '"role" IS NOT NULL AND "deletedAt" IS NULL',
})
export class LedgerAccount extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({
    type: 'enum',
    enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'],
    enumName: 'ledger_accounts_type_enum',
  })
  type: LedgerAccountType;

  /**
   * The well-known handle the application posts against, or null for an
   * account a tenant added themselves.
   *
   * Unique per tenant where set: two accounts both claiming to be
   * `ACCOUNTS_PAYABLE` would make resolution non-deterministic, and the
   * failure would look like money going to the wrong place rather than an
   * error.
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  role: LedgerRole | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  /** System accounts cannot be deleted or have their role reassigned. */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
