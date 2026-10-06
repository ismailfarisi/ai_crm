import { Column, Entity, Index } from 'typeorm';
import type { ProductionBoardColumn } from '@saas/shared';
import { TenantBaseEntity } from '@/common/entities/base.entity';

@Entity('production_board_settings')
@Index('idx_production_board_settings_tenant', ['tenantId'], { unique: true })
export class ProductionBoardSetting extends TenantBaseEntity {
  @Column({ type: 'jsonb', default: [] })
  columns: ProductionBoardColumn[];
}
