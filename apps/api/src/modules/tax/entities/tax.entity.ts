import { Column, Entity, Index } from 'typeorm';
import type { TaxKind } from '@saas/shared';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

@Entity('tax_codes')
@Index('uq_tax_codes_tenant_kind_code', ['tenantId', 'kind', 'code'], {
  unique: true,
})
export class TaxCode extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({
    type: 'numeric',
    precision: 7,
    scale: 4,
    transformer: numericTransformer,
  })
  rate: number;

  @Column({ type: 'varchar', length: 20 })
  kind: TaxKind;

  @Column({ name: 'is_reverse_charge', type: 'boolean', default: false })
  isReverseCharge: boolean;

  @Column({ name: 'ledger_account_id', type: 'uuid', nullable: true })
  ledgerAccountId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}

@Entity('tax_rules')
@Index(
  'uq_tax_rules_tenant_match',
  ['tenantId', 'kind', 'country', 'requiresTaxId'],
  { unique: true },
)
export class TaxRule extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 20 })
  kind: TaxKind;

  /** ISO alpha-2, `EU`, or `*`. */
  @Column({ type: 'varchar', length: 2 })
  country: string;

  @Column({ name: 'requires_tax_id', type: 'boolean', default: false })
  requiresTaxId: boolean;

  @Column({ name: 'tax_code_id', type: 'uuid' })
  taxCodeId: string;

  @Column({ type: 'int', default: 0 })
  priority: number;
}
