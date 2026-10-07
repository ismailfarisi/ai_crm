import { Column, Entity, Index, OneToMany, Unique } from 'typeorm';
import { TenantSoftDeletableEntity } from '@/common/entities/base.entity';
import { CustomAttributeDefinition } from './custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from './custom-relationship-definition.entity';

@Entity('custom_object_definitions')
@Unique('uq_custom_objects_tenant_slug', ['tenantId', 'slug'])
@Index('idx_custom_objects_tenant', ['tenantId', 'isArchived'])
export class CustomObjectDefinition extends TenantSoftDeletableEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 80, name: 'singular_name' })
  singularName: string;

  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'varchar', length: 40, default: 'Box' })
  icon: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 80, name: 'primary_attribute_slug' })
  primaryAttributeSlug: string;

  @Column({ type: 'boolean', default: false, name: 'is_archived' })
  isArchived: boolean = false;

  @OneToMany(() => CustomAttributeDefinition, (attr) => attr.object, { cascade: true })
  attributes?: CustomAttributeDefinition[];

  @OneToMany(() => CustomRelationshipDefinition, (rel) => rel.sourceObject, { cascade: true })
  relationships?: CustomRelationshipDefinition[];
}
