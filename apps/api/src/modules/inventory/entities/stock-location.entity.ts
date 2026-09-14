import { Column, Entity, Index } from 'typeorm';
import { SoftDeletableEntity } from '@/common/entities/base.entity';

/**
 * Somewhere stock physically sits.
 *
 * Most shops have exactly one, and the service creates it on demand. Modelled
 * now rather than later because retrofitting a location onto an existing
 * `stock_items` table means deciding what every historic quantity referred to.
 */
@Entity('stock_locations')
@Index('idx_stock_locations_tenant', ['tenantId'])
export class StockLocation extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;
}
