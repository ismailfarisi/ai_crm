import { Column, Entity, Index } from 'typeorm';
import { TenantSoftDeletableEntity } from '@/common/entities/base.entity';
import type { SavedViewConfig, ViewLayoutType } from '@saas/shared';

@Entity('saved_views')
@Index('idx_saved_views_tenant_entity', ['tenantId', 'entityType', 'isShared'])
@Index('idx_saved_views_user', ['tenantId', 'userId'])
export class SavedView extends TenantSoftDeletableEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  entityType: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'table' })
  viewType: ViewLayoutType;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', default: false })
  isShared: boolean;

  @Column({ type: 'jsonb', default: {} })
  config: SavedViewConfig;
}
