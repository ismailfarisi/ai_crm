export const CUSTOM_ATTRIBUTE_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'currency',
  'url',
  'email',
  'phone',
] as const;

export type CustomAttributeType = (typeof CUSTOM_ATTRIBUTE_TYPES)[number];

export type RelationshipTargetType = 'custom_object' | 'core_entity';

export const RELATIONSHIP_CORE_ENTITIES = [
  'customer',
  'contact',
  'quote',
  'order',
  'work_order',
  'purchase_order',
] as const;

export type RelationshipCoreEntity = (typeof RELATIONSHIP_CORE_ENTITIES)[number];

export type RelationshipCardinality = 'many_to_one' | 'many_to_many';

export interface AttributeOption {
  label: string;
  value: string;
  color?: string;
}

export interface AttributeValidationRules {
  min?: number;
  max?: number;
  pattern?: string;
}

export interface CustomAttributeDefinitionDto {
  id: string;
  tenantId: string;
  objectId: string;
  name: string;
  slug: string;
  type: CustomAttributeType;
  isRequired: boolean;
  isUnique: boolean;
  isSearchable: boolean;
  defaultValue?: any;
  options?: AttributeOption[];
  validationRules?: AttributeValidationRules;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRelationshipDefinitionDto {
  id: string;
  tenantId: string;
  sourceObjectId: string;
  targetType: RelationshipTargetType;
  targetObjectId?: string;
  targetCoreEntity?: RelationshipCoreEntity;
  name: string;
  slug: string;
  cardinality: RelationshipCardinality;
  createdAt: string;
  updatedAt: string;
}

export interface CustomObjectDefinitionDto {
  id: string;
  tenantId: string;
  name: string;
  singularName: string;
  slug: string;
  icon: string;
  description?: string;
  primaryAttributeSlug: string;
  isArchived: boolean;
  attributes?: CustomAttributeDefinitionDto[];
  relationships?: CustomRelationshipDefinitionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomRecordDto {
  id: string;
  tenantId: string;
  objectId: string;
  ownerId?: string | null;
  owner?: { id: string; fullName: string; email?: string } | null;
  values: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRecordLinkDto {
  id: string;
  tenantId: string;
  relationshipId: string;
  sourceRecordId: string;
  targetType: RelationshipTargetType;
  targetRecordId: string;
  targetSummary?: Record<string, any>;
  createdAt: string;
}
