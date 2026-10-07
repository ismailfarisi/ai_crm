import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { RelationshipTargetType } from '@saas/shared';
import { CustomRecord } from './custom-record.entity';
import { CustomRelationshipDefinition } from './custom-relationship-definition.entity';

@Entity('custom_record_links')
@Unique('uq_record_links_unique_edge', ['relationshipId', 'sourceRecordId', 'targetRecordId'])
@Index('idx_record_links_source', ['tenantId', 'relationshipId', 'sourceRecordId'])
@Index('idx_record_links_target', ['tenantId', 'targetRecordId'])
export class CustomRecordLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'relationship_id' })
  relationshipId: string;

  @ManyToOne(() => CustomRelationshipDefinition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'relationship_id' })
  relationship?: CustomRelationshipDefinition;

  @Column({ type: 'uuid', name: 'source_record_id' })
  sourceRecordId: string;

  @ManyToOne(() => CustomRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_record_id' })
  sourceRecord?: CustomRecord;

  @Column({ type: 'varchar', length: 30, name: 'target_type' })
  targetType: RelationshipTargetType;

  @Column({ type: 'uuid', name: 'target_record_id' })
  targetRecordId: string;

  @Column({ type: 'timestamp with time zone', default: () => 'now()', name: 'created_at' })
  createdAt: Date;
}
