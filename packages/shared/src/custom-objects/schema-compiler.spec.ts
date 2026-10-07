import { describe, it, expect } from 'vitest';
import { buildDynamicRecordSchema } from './schema-compiler';
import type { CustomAttributeDefinitionDto } from './types';

describe('buildDynamicRecordSchema', () => {
  const sampleAttributes: CustomAttributeDefinitionDto[] = [
    {
      id: 'a1',
      tenantId: 't1',
      objectId: 'obj1',
      name: 'Serial Number',
      slug: 'serialNumber',
      type: 'text',
      isRequired: true,
      isUnique: true,
      isSearchable: true,
      sortOrder: 1,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'a2',
      tenantId: 't1',
      objectId: 'obj1',
      name: 'Voltage Rating',
      slug: 'voltage',
      type: 'number',
      isRequired: false,
      isUnique: false,
      isSearchable: false,
      validationRules: { min: 110, max: 480 },
      sortOrder: 2,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'a3',
      tenantId: 't1',
      objectId: 'obj1',
      name: 'Status',
      slug: 'status',
      type: 'select',
      isRequired: true,
      isUnique: false,
      isSearchable: true,
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Maintenance', value: 'maintenance' },
      ],
      sortOrder: 3,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'a4',
      tenantId: 't1',
      objectId: 'obj1',
      name: 'Is Certified',
      slug: 'isCertified',
      type: 'boolean',
      isRequired: false,
      isUnique: false,
      isSearchable: false,
      sortOrder: 4,
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('validates matching valid record payload', () => {
    const schema = buildDynamicRecordSchema(sampleAttributes);
    const valid = {
      serialNumber: 'SN-2026-99',
      voltage: 220,
      status: 'active',
      isCertified: true,
    };
    const res = schema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it('fails when required attribute is missing', () => {
    const schema = buildDynamicRecordSchema(sampleAttributes);
    const missing = {
      voltage: 220,
      status: 'active',
    };
    const res = schema.safeParse(missing);
    expect(res.success).toBe(false);
  });

  it('fails when number is outside validation min/max', () => {
    const schema = buildDynamicRecordSchema(sampleAttributes);
    const outOfBounds = {
      serialNumber: 'SN-001',
      voltage: 600, // max is 480
      status: 'active',
    };
    const res = schema.safeParse(outOfBounds);
    expect(res.success).toBe(false);
  });

  it('fails when select value is not in options', () => {
    const schema = buildDynamicRecordSchema(sampleAttributes);
    const badOption = {
      serialNumber: 'SN-001',
      status: 'decommissioned', // invalid option
    };
    const res = schema.safeParse(badOption);
    expect(res.success).toBe(false);
  });

  it('rejects undeclared attributes', () => {
    const schema = buildDynamicRecordSchema(sampleAttributes);
    const withExtra = {
      serialNumber: 'SN-001',
      status: 'active',
      unregisteredField: 'malicious',
    };
    const res = schema.safeParse(withExtra);
    expect(res.success).toBe(false);
  });
});
