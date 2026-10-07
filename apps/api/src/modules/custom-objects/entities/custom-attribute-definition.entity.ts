import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { TenantSoftDeletableEntity } from '@/common/entities/base.entity';
import type { AttributeOption, AttributeValidationRules, CustomAttributeType } from '@saas/shared';
import { CustomObjectDefinition } from './custom-object-definition.entity';

@Entity('custom_attribute_definitions')
@Unique('uq_custom_attributes_object_slug', ['objectId', 'slug'])
@Index('idx_custom_attributes_object', ['objectId', 'sortOrder'])
export class CustomAttributeDefinition extends TenantSoftDeletableEntity {
  @Column({ type: 'uuid', name: 'object_id' })
  objectId: string;

  @ManyToOne(() => CustomObjectDefinition, (obj) => obj.attributes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'object_id' })
  object?: CustomObjectDefinition;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'varchar', length: 30 })
  type: CustomAttributeType;

  @Column({ type: 'boolean', default: false, name: 'is_required' })
  isRequired: boolean = false;

  @Column({ type: 'boolean', default: false, name: 'is_unique' })
  isUnique: boolean = false;

  @Column({ type: 'boolean', default: true, name: 'is_searchable' })
  isSearchable: boolean = true;

  @Column({ type: 'jsonb', nullable: true, name: 'default_value' })
  defaultValue?: any;

  @Column({ type: 'jsonb', nullable: true })
  options?: AttributeOption[];

  @Column({ type: 'jsonb', nullable: true, name: 'validation_rules' })
  validationRules?: AttributeValidationRules;

  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder: number = 0;
}
