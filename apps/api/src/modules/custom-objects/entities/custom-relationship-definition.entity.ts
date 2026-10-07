import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { TenantSoftDeletableEntity } from '@/common/entities/base.entity';
import type { RelationshipCardinality, RelationshipCoreEntity, RelationshipTargetType } from '@saas/shared';
import { CustomObjectDefinition } from './custom-object-definition.entity';

@Entity('custom_relationship_definitions')
@Unique('uq_custom_rel_source_slug', ['sourceObjectId', 'slug'])
export class CustomRelationshipDefinition extends TenantSoftDeletableEntity {
  @Column({ type: 'uuid', name: 'source_object_id' })
  sourceObjectId: string;

  @ManyToOne(() => CustomObjectDefinition, (obj) => obj.relationships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_object_id' })
  sourceObject?: CustomObjectDefinition;

  @Column({ type: 'varchar', length: 30, name: 'target_type' })
  targetType: RelationshipTargetType;

  @Column({ type: 'uuid', nullable: true, name: 'target_object_id' })
  targetObjectId?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'target_core_entity' })
  targetCoreEntity?: RelationshipCoreEntity | null;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'varchar', length: 30, default: 'many_to_one' })
  cardinality: RelationshipCardinality = 'many_to_one';
}
