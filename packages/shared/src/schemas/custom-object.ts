import { z } from 'zod';
import {
  CUSTOM_ATTRIBUTE_TYPES,
  RELATIONSHIP_CORE_ENTITIES,
} from '../custom-objects/types';

export const createCustomObjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  singularName: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  }),
  icon: z.string().trim().max(40).default('Box'),
  description: z.string().trim().max(500).optional(),
  primaryAttributeSlug: z.string().trim().min(1).max(80),
});

export const updateCustomObjectSchema = createCustomObjectSchema.partial().omit({ slug: true });

export const createCustomAttributeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  type: z.enum(CUSTOM_ATTRIBUTE_TYPES),
  isRequired: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  isSearchable: z.boolean().default(true),
  defaultValue: z.any().optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        color: z.string().optional(),
      }),
    )
    .optional(),
  validationRules: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
  sortOrder: z.number().int().default(0),
});

export const updateCustomAttributeSchema = createCustomAttributeSchema.partial().omit({ slug: true, type: true });

export const createCustomRelationshipSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  targetType: z.enum(['custom_object', 'core_entity']),
  targetObjectId: z.string().uuid().optional(),
  targetCoreEntity: z.enum(RELATIONSHIP_CORE_ENTITIES).optional(),
  cardinality: z.enum(['many_to_one', 'many_to_many']).default('many_to_one'),
});

export const createCustomRecordPayloadSchema = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  values: z.record(z.string(), z.any()),
});

export const updateCustomRecordPayloadSchema = createCustomRecordPayloadSchema.partial();

export type CreateCustomObjectPayload = z.infer<typeof createCustomObjectSchema>;
export type UpdateCustomObjectPayload = z.infer<typeof updateCustomObjectSchema>;
export type CreateCustomAttributePayload = z.infer<typeof createCustomAttributeSchema>;
export type UpdateCustomAttributePayload = z.infer<typeof updateCustomAttributeSchema>;
export type CreateCustomRelationshipPayload = z.infer<typeof createCustomRelationshipSchema>;
export type CreateCustomRecordPayload = z.infer<typeof createCustomRecordPayloadSchema>;
export type UpdateCustomRecordPayload = z.infer<typeof updateCustomRecordPayloadSchema>;
