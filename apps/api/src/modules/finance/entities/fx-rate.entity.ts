import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from './finance-account.entity';

/** One day's rate for one currency, as base currency per unit of it. */
@Entity('fx_rates')
@Index(
  'uq_fx_rates_tenant_currency_date',
  ['tenantId', 'currency', 'rateDate'],
  {
    unique: true,
  },
)
export class FxRate extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  /** A calendar day, not an instant: rates are quoted per day. */
  @Column({ name: 'rate_date', type: 'date' })
  rateDate: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 8,
    transformer: numericTransformer,
  })
  rate: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  source: string | null;
}
