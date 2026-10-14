import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { TenantSoftDeletableEntity } from '@/common/entities/base.entity';
import { CustomObjectDefinition } from './custom-object-definition.entity';

@Entity('custom_records')
@Index('idx_custom_records_tenant_obj', ['tenantId', 'objectId', 'createdAt'])
@Index('idx_custom_records_owner', ['tenantId', 'ownerId'])
// Target of same-tenant composite FKs (migration 1789500000000).
@Unique('uq_custom_records_tenant_id_id', ['tenantId', 'id'])
export class CustomRecord extends TenantSoftDeletableEntity {
  @Column({ type: 'uuid', name: 'object_id' })
  objectId: string;

  @ManyToOne(() => CustomObjectDefinition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'object_id' })
  object?: CustomObjectDefinition;

  @Column({ type: 'uuid', nullable: true, name: 'owner_id' })
  ownerId?: string | null;

  @Column({ type: 'jsonb', default: {} })
  values: Record<string, any> = {};
}
