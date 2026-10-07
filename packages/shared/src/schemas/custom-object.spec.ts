import { describe, it, expect } from 'vitest';
import {
  createCustomObjectSchema,
  createCustomAttributeSchema,
  createCustomRelationshipSchema,
} from './custom-object';
import { CUSTOM_OBJECT_PERMISSIONS } from '../rbac/permissions/custom-objects';
import { PERMISSIONS } from '../rbac/permissions';

describe('Custom Object Schemas & Permissions', () => {
  it('validates a valid custom object creation payload', () => {
    const valid = {
      name: 'Packaging Machinery',
      singularName: 'Packaging Machine',
      slug: 'packaging-machinery',
      icon: 'Box',
      description: 'Factory floor automated packaging units',
      primaryAttributeSlug: 'serial-number',
    };
    const result = createCustomObjectSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects custom object with invalid slug', () => {
    const invalid = {
      name: 'Packaging Machinery',
      singularName: 'Packaging Machine',
      slug: 'Packaging Machinery!', // spaces and symbols not allowed
      primaryAttributeSlug: 'name',
    };
    const result = createCustomObjectSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('validates a custom attribute definition', () => {
    const validAttr = {
      name: 'Power Rating (kW)',
      slug: 'power-rating',
      type: 'number',
      isRequired: true,
      isUnique: false,
      isSearchable: true,
      validationRules: { min: 0, max: 500 },
    };
    const result = createCustomAttributeSchema.safeParse(validAttr);
    expect(result.success).toBe(true);
  });

  it('validates relationship definition', () => {
    const validRel = {
      name: 'Installed Equipment',
      slug: 'installed-equipment',
      targetType: 'core_entity',
      targetCoreEntity: 'customer',
      cardinality: 'many_to_one',
    };
    const result = createCustomRelationshipSchema.safeParse(validRel);
    expect(result.success).toBe(true);
  });

  it('defines custom object permissions in global PERMISSIONS catalog', () => {
    expect(CUSTOM_OBJECT_PERMISSIONS.CUSTOM_OBJECT_MANAGE).toBe('custom_object:manage');
    expect(PERMISSIONS.CUSTOM_OBJECT_MANAGE).toBe('custom_object:manage');
    expect(PERMISSIONS.CUSTOM_RECORD_READ).toBe('custom_record:read');
    expect(PERMISSIONS.CUSTOM_RECORD_CREATE).toBe('custom_record:create');
  });
});
