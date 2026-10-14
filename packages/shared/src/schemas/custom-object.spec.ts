import { describe, it, expect } from 'vitest';
import {
  createCustomObjectSchema,
  createCustomAttributeSchema,
  createCustomRelationshipSchema,
  createCustomRecordLinkSchema,
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

  describe('createCustomRecordLinkSchema', () => {
    const valid = {
      relationshipId: '3f1c9a52-7d0e-4b8a-9b55-0a4f0f8e1a11',
      sourceRecordId: '6a7b8c9d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
      targetRecordId: '0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a',
    };

    it('accepts a link payload of uuids', () => {
      expect(createCustomRecordLinkSchema.safeParse(valid).success).toBe(true);
    });

    it('strips caller-controlled fields such as tenantId, id and actorUserId', () => {
      const parsed = createCustomRecordLinkSchema.parse({
        ...valid,
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        actorUserId: 'someone-else',
        createdAt: '2020-01-01',
      });
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed).not.toHaveProperty('id');
      expect(parsed).not.toHaveProperty('actorUserId');
      expect(parsed).not.toHaveProperty('createdAt');
    });

    it('rejects non-uuid ids and unknown target types', () => {
      expect(
        createCustomRecordLinkSchema.safeParse({ ...valid, sourceRecordId: 'rec-1' }).success,
      ).toBe(false);
      expect(
        createCustomRecordLinkSchema.safeParse({ ...valid, targetType: 'customer' }).success,
      ).toBe(false);
      expect(
        createCustomRecordLinkSchema.safeParse({ ...valid, targetType: 'core_entity' }).success,
      ).toBe(true);
    });
  });
});
