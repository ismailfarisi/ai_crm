# Custom Objects & Dynamic Relationships Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a metadata-driven custom objects and dynamic relationships engine allowing tenants to define custom entities, dynamic attributes, bidirectional relationship joins, and render them in spreadsheet/pipeline views and core entity tabs.

**Architecture:** A metadata-driven universal storage pattern backed by PostgreSQL `jsonb` with GIN indexing and database-enforced Row-Level Security (`NOBYPASSRLS`). Custom entity metadata resides in relational definition tables, while dynamic records store values in a validated JSONB store with dynamic Zod validation compiled at runtime. The Next.js frontend integrates custom objects into the sidebar, an administrative Object Studio, a dynamic record browser leveraging `<DataViewContainer>`, and reverse relationship tabs on core entity detail views.

**Tech Stack:** TypeScript 5.9, NestJS 11, TypeORM 0.3, PostgreSQL 18 with RLS & GIN, Zod 4, TanStack Query 5, React 19, Next.js 16 (App Router + Turbopack), Vitest / Jest.

## Global Constraints

- Never execute runtime DDL (`CREATE TABLE` or `ALTER TABLE` during tenant operations). All definitions are relational rows.
- Strict PostgreSQL Row-Level Security: Every custom table must inherit `TenantSoftDeletableEntity` and enforce tenant isolation.
- Zero external drag-and-drop npm dependencies: Use native HTML5 Drag and Drop or existing `<KanbanBoard>` engine.
- Zero test failure regressions across existing suites (`pnpm test` must stay 100% green).
- Full build integrity (`pnpm build` across `@saas/shared`, `@saas/api`, and `web`).

---

### Task 1: Shared Models, Attribute Types & RBAC Permissions (`packages/shared`)

**Files:**
- Create: `packages/shared/src/custom-objects/types.ts`
- Create: `packages/shared/src/schemas/custom-object.ts`
- Create: `packages/shared/src/rbac/permissions/custom-objects.ts`
- Modify: `packages/shared/src/rbac/permissions/index.ts`
- Modify: `packages/shared/src/rbac/roles.ts`
- Create Test: `packages/shared/src/schemas/custom-object.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `TenantSoftDeletableEntity` shape, `PermissionDomain` from `rbac/permissions/domain.ts`
- Produces: `CUSTOM_ATTRIBUTE_TYPES`, `CustomAttributeType`, `CustomObjectDefinitionDto`, `CustomAttributeDefinitionDto`, `CustomRelationshipDefinitionDto`, `CustomRecordDto`, `CustomRecordLinkDto`, `CreateCustomObjectPayload`, `CreateCustomAttributePayload`, `CreateCustomRelationshipPayload`, `CreateCustomRecordPayload`, `CUSTOM_OBJECT_PERMISSIONS`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schemas/custom-object.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test custom-object.spec.ts`
Expected: FAIL due to missing files/modules.

- [ ] **Step 3: Implement shared types, schemas, and RBAC permissions**

Create `packages/shared/src/custom-objects/types.ts`:
```ts
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
```

Create `packages/shared/src/schemas/custom-object.ts`:
```ts
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
```

Create `packages/shared/src/rbac/permissions/custom-objects.ts`:
```ts
import type { PermissionDomain } from './domain';

export const CUSTOM_OBJECT_PERMISSIONS = {
  CUSTOM_OBJECT_MANAGE: 'custom_object:manage',
  CUSTOM_RECORD_READ: 'custom_record:read',
  CUSTOM_RECORD_READ_ALL: 'custom_record:read_all',
  CUSTOM_RECORD_CREATE: 'custom_record:create',
  CUSTOM_RECORD_UPDATE: 'custom_record:update',
  CUSTOM_RECORD_DELETE: 'custom_record:delete',
  CUSTOM_RECORD_EXPORT: 'custom_record:export',
} as const;

export const customObjectsDomain: PermissionDomain = {
  key: 'custom_objects',
  label: 'Custom Objects & Data',
  description: 'Manage tenant-defined objects, attributes, relationships, and records.',
  permissions: [
    {
      value: CUSTOM_OBJECT_PERMISSIONS.CUSTOM_OBJECT_MANAGE,
      label: 'Manage object schemas',
      description: 'Create and edit custom object definitions, attributes, and relationships.',
    },
    {
      value: CUSTOM_OBJECT_PERMISSIONS.CUSTOM_RECORD_READ,
      label: 'Read assigned records',
      description: 'View custom records owned by or assigned to the user.',
    },
    {
      value: CUSTOM_OBJECT_PERMISSIONS.CUSTOM_RECORD_READ_ALL,
      label: 'Read all records',
      description: 'View all custom records across the entire organization.',
    },
    {
      value: CUSTOM_OBJECT_PERMISSIONS.CUSTOM_RECORD_CREATE,
      label: 'Create records',
      description: 'Create new custom records.',
    },
    {
      value: CUSTOM_OBJECT_PERMISSIONS.CUSTOM_RECORD_UPDATE,
      label: 'Update records',
      description: 'Modify values of custom records.',
    },
    {
      value: CUSTOM_OBJECT_PERMISSIONS.CUSTOM_RECORD_DELETE,
      label: 'Delete records',
      description: 'Soft-delete custom records.',
    },
    {
      value: CUSTOM_OBJECT_PERMISSIONS.CUSTOM_RECORD_EXPORT,
      label: 'Export records',
      description: 'Export custom records to CSV or spreadsheet formats.',
    },
  ],
};
```

Update `packages/shared/src/rbac/permissions/index.ts` to export `CUSTOM_OBJECT_PERMISSIONS` and register `customObjectsDomain` in `PERMISSION_DOMAINS` and `PERMISSIONS`.
Update `packages/shared/src/rbac/roles.ts` to grant:
- Owner and Admin: all `CUSTOM_OBJECT_PERMISSIONS`.
- Manager: `CUSTOM_RECORD_READ_ALL`, `CUSTOM_RECORD_CREATE`, `CUSTOM_RECORD_UPDATE`, `CUSTOM_RECORD_DELETE`, `CUSTOM_RECORD_EXPORT`.
- Member: `CUSTOM_RECORD_READ`, `CUSTOM_RECORD_CREATE`, `CUSTOM_RECORD_UPDATE`.
Update `packages/shared/src/index.ts` to export `./custom-objects/types`, `./schemas/custom-object`, and `./rbac/permissions/custom-objects`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saas/shared test custom-object.spec.ts`
Expected: PASS (5/5 tests passing).

- [ ] **Step 5: Build shared package and commit**

```bash
pnpm --filter @saas/shared build
git add packages/shared/src/custom-objects packages/shared/src/schemas/custom-object.* packages/shared/src/rbac/permissions/custom-objects.ts packages/shared/src/rbac/permissions/index.ts packages/shared/src/rbac/roles.ts packages/shared/src/index.ts
git commit -m "feat(shared): add custom objects types, schemas and RBAC permissions"
```

---

### Task 2: Dynamic Record Schema Compiler (`packages/shared`)

**Files:**
- Create: `packages/shared/src/custom-objects/schema-compiler.ts`
- Create Test: `packages/shared/src/custom-objects/schema-compiler.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `CustomAttributeDefinitionDto` from `packages/shared/src/custom-objects/types.ts`
- Produces: `buildDynamicRecordSchema(attributes: CustomAttributeDefinitionDto[]): z.ZodObject<any>`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/custom-objects/schema-compiler.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test schema-compiler.spec.ts`
Expected: FAIL due to missing `schema-compiler.ts`.

- [ ] **Step 3: Implement dynamic schema compiler**

Create `packages/shared/src/custom-objects/schema-compiler.ts`:
```ts
import { z, type ZodTypeAny } from 'zod';
import type { CustomAttributeDefinitionDto } from './types';

export function buildDynamicRecordSchema(attributes: CustomAttributeDefinitionDto[]) {
  const shape: Record<string, ZodTypeAny> = {};

  for (const attr of attributes) {
    let fieldSchema: ZodTypeAny;

    switch (attr.type) {
      case 'text':
      case 'url':
      case 'phone': {
        let str = z.string().trim();
        if (attr.validationRules?.min != null) str = str.min(attr.validationRules.min);
        if (attr.validationRules?.max != null) str = str.max(attr.validationRules.max);
        if (attr.validationRules?.pattern) {
          str = str.regex(new RegExp(attr.validationRules.pattern));
        }
        fieldSchema = str;
        break;
      }
      case 'email': {
        fieldSchema = z.string().trim().email();
        break;
      }
      case 'number':
      case 'currency': {
        let num = z.number();
        if (attr.validationRules?.min != null) num = num.min(attr.validationRules.min);
        if (attr.validationRules?.max != null) num = num.max(attr.validationRules.max);
        fieldSchema = num;
        break;
      }
      case 'boolean': {
        fieldSchema = z.boolean();
        break;
      }
      case 'date':
      case 'datetime': {
        fieldSchema = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
        break;
      }
      case 'select': {
        const validValues = (attr.options ?? []).map((o) => o.value);
        fieldSchema = z.string().refine((val) => validValues.length === 0 || validValues.includes(val), {
          message: `Value must be one of: ${validValues.join(', ')}`,
        });
        break;
      }
      case 'multiselect': {
        const validValues = (attr.options ?? []).map((o) => o.value);
        fieldSchema = z
          .array(z.string())
          .refine((vals) => validValues.length === 0 || vals.every((v) => validValues.includes(v)), {
            message: `All values must be one of: ${validValues.join(', ')}`,
          });
        break;
      }
      default:
        fieldSchema = z.any();
    }

    if (!attr.isRequired) {
      fieldSchema = fieldSchema.nullable().optional();
    }

    shape[attr.slug] = fieldSchema;
  }

  // Strict mode: disallow keys not defined in attribute definitions
  return z.object(shape).strict();
}
```

Export `buildDynamicRecordSchema` in `packages/shared/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saas/shared test schema-compiler.spec.ts`
Expected: PASS (5/5 tests passing).

- [ ] **Step 5: Build shared package and commit**

```bash
pnpm --filter @saas/shared build
git add packages/shared/src/custom-objects/schema-compiler.* packages/shared/src/index.ts
git commit -m "feat(shared): implement dynamic record schema compiler"
```

---

### Task 3: Backend Database Migration & TypeORM Entities (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/custom-objects/entities/custom-object-definition.entity.ts`
- Create: `apps/api/src/modules/custom-objects/entities/custom-attribute-definition.entity.ts`
- Create: `apps/api/src/modules/custom-objects/entities/custom-relationship-definition.entity.ts`
- Create: `apps/api/src/modules/custom-objects/entities/custom-record.entity.ts`
- Create: `apps/api/src/modules/custom-objects/entities/custom-record-link.entity.ts`
- Create: `apps/api/src/database/migrations/1789000000000-CreateCustomObjectsTables.ts`
- Create Test: `apps/api/src/modules/custom-objects/entities/custom-objects.entities.spec.ts`

**Interfaces:**
- Consumes: `TenantSoftDeletableEntity` from `@/common/entities/base.entity`
- Produces: TypeORM entity mappings for all 5 tables with RLS and GIN index.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/custom-objects/entities/custom-objects.entities.spec.ts`:
```ts
import { CustomObjectDefinition } from './custom-object-definition.entity';
import { CustomAttributeDefinition } from './custom-attribute-definition.entity';
import { CustomRecord } from './custom-record.entity';

describe('Custom Objects Entities', () => {
  it('instantiates CustomObjectDefinition with default values', () => {
    const obj = new CustomObjectDefinition();
    obj.tenantId = 'tenant-1';
    obj.name = 'Machinery';
    obj.singularName = 'Machine';
    obj.slug = 'machinery';
    obj.primaryAttributeSlug = 'serial';

    expect(obj.name).toBe('Machinery');
    expect(obj.isArchived).toBe(false);
  });

  it('instantiates CustomAttributeDefinition with default flags', () => {
    const attr = new CustomAttributeDefinition();
    attr.name = 'Serial';
    attr.slug = 'serial';
    attr.type = 'text';

    expect(attr.isRequired).toBe(false);
    expect(attr.isSearchable).toBe(true);
  });

  it('instantiates CustomRecord with empty values map', () => {
    const record = new CustomRecord();
    record.objectId = 'obj-1';
    record.values = { serial: 'SN-100' };

    expect(record.values.serial).toBe('SN-100');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test custom-objects.entities.spec.ts`
Expected: FAIL due to missing entity files.

- [ ] **Step 3: Implement entities and database migration**

Create `apps/api/src/modules/custom-objects/entities/custom-object-definition.entity.ts`:
```ts
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
```

Create `apps/api/src/modules/custom-objects/entities/custom-attribute-definition.entity.ts`:
```ts
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
```

Create `apps/api/src/modules/custom-objects/entities/custom-relationship-definition.entity.ts`:
```ts
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
```

Create `apps/api/src/modules/custom-objects/entities/custom-record.entity.ts`:
```ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantSoftDeletableEntity } from '@/common/entities/base.entity';
import { CustomObjectDefinition } from './custom-object-definition.entity';

@Entity('custom_records')
@Index('idx_custom_records_tenant_obj', ['tenantId', 'objectId', 'createdAt'])
@Index('idx_custom_records_owner', ['tenantId', 'ownerId'])
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
```

Create `apps/api/src/modules/custom-objects/entities/custom-record-link.entity.ts`:
```ts
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
```

Create `apps/api/src/database/migrations/1789000000000-CreateCustomObjectsTables.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomObjectsTables1789000000000 implements MigrationInterface {
  name = 'CreateCustomObjectsTables1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "custom_object_definitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "singular_name" character varying(80) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "icon" character varying(40) NOT NULL DEFAULT 'Box',
        "description" text,
        "primary_attribute_slug" character varying(80) NOT NULL,
        "is_archived" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_object_definitions_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_custom_objects_tenant_slug" UNIQUE ("tenant_id", "slug")
      );
      CREATE INDEX IF NOT EXISTS "idx_custom_objects_tenant" ON "custom_object_definitions" ("tenant_id", "is_archived");

      CREATE TABLE IF NOT EXISTS "custom_attribute_definitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "object_id" uuid NOT NULL REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE,
        "name" character varying(80) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "type" character varying(30) NOT NULL,
        "is_required" boolean NOT NULL DEFAULT false,
        "is_unique" boolean NOT NULL DEFAULT false,
        "is_searchable" boolean NOT NULL DEFAULT true,
        "default_value" jsonb,
        "options" jsonb,
        "validation_rules" jsonb,
        "sort_order" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_attribute_definitions_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_custom_attributes_object_slug" UNIQUE ("object_id", "slug")
      );
      CREATE INDEX IF NOT EXISTS "idx_custom_attributes_object" ON "custom_attribute_definitions" ("object_id", "sort_order");

      CREATE TABLE IF NOT EXISTS "custom_relationship_definitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "source_object_id" uuid NOT NULL REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE,
        "target_type" character varying(30) NOT NULL,
        "target_object_id" uuid REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE,
        "target_core_entity" character varying(40),
        "name" character varying(80) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "cardinality" character varying(30) NOT NULL DEFAULT 'many_to_one',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_relationship_definitions_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_custom_rel_source_slug" UNIQUE ("source_object_id", "slug")
      );

      CREATE TABLE IF NOT EXISTS "custom_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "object_id" uuid NOT NULL REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE,
        "owner_id" uuid,
        "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_records_id" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "idx_custom_records_tenant_obj" ON "custom_records" ("tenant_id", "object_id", "createdAt" DESC);
      CREATE INDEX IF NOT EXISTS "idx_custom_records_owner" ON "custom_records" ("tenant_id", "owner_id");
      CREATE INDEX IF NOT EXISTS "idx_custom_records_values_gin" ON "custom_records" USING GIN ("values");

      CREATE TABLE IF NOT EXISTS "custom_record_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "relationship_id" uuid NOT NULL REFERENCES "custom_relationship_definitions"("id") ON DELETE CASCADE,
        "source_record_id" uuid NOT NULL REFERENCES "custom_records"("id") ON DELETE CASCADE,
        "target_type" character varying(30) NOT NULL,
        "target_record_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_record_links_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_record_links_unique_edge" UNIQUE ("relationship_id", "source_record_id", "target_record_id")
      );
      CREATE INDEX IF NOT EXISTS "idx_record_links_source" ON "custom_record_links" ("tenant_id", "relationship_id", "source_record_id");
      CREATE INDEX IF NOT EXISTS "idx_record_links_target" ON "custom_record_links" ("tenant_id", "target_record_id");
    `);

    // Enable Row-Level Security on all 5 tables
    const tables = [
      'custom_object_definitions',
      'custom_attribute_definitions',
      'custom_relationship_definitions',
      'custom_records',
      'custom_record_links',
    ];
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_record_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_relationship_definitions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_attribute_definitions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_object_definitions"`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saas/api test custom-objects.entities.spec.ts`
Expected: PASS (3/3 tests passing).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/custom-objects/entities apps/api/src/database/migrations/*CreateCustomObjectsTables.ts
git commit -m "feat(api): implement custom objects entities, RLS policies and migration"
```

---

### Task 4: Backend Metadata Service & Controller (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/custom-objects/services/custom-objects.service.ts`
- Create: `apps/api/src/modules/custom-objects/controllers/custom-objects.controller.ts`
- Create Test: `apps/api/src/modules/custom-objects/services/custom-objects.service.spec.ts`
- Create Test: `apps/api/src/modules/custom-objects/controllers/custom-objects.controller.spec.ts`

**Interfaces:**
- Consumes: `CustomObjectDefinition`, `CustomAttributeDefinition`, `CustomRelationshipDefinition` entities
- Produces: `CustomObjectsService` (`list`, `getBySlug`, `create`, `update`, `archive`, `addAttribute`, `updateAttribute`, `deleteAttribute`, `addRelationship`, `deleteRelationship`) and `CustomObjectsController` (`/api/v1/custom-objects`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/custom-objects/services/custom-objects.service.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomObjectsService } from './custom-objects.service';
import { CustomObjectDefinition } from '../entities/custom-object-definition.entity';
import { CustomAttributeDefinition } from '../entities/custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from '../entities/custom-relationship-definition.entity';

describe('CustomObjectsService', () => {
  let service: CustomObjectsService;
  const mockRepo = {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn((dto) => dto),
    save: vi.fn((entity) => Promise.resolve({ id: 'obj-123', ...entity })),
    softDelete: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomObjectsService,
        { provide: getRepositoryToken(CustomObjectDefinition), useValue: mockRepo },
        { provide: getRepositoryToken(CustomAttributeDefinition), useValue: mockRepo },
        { provide: getRepositoryToken(CustomRelationshipDefinition), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<CustomObjectsService>(CustomObjectsService);
  });

  it('creates an object definition', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const result = await service.create('tenant-1', {
      name: 'Vehicles',
      singularName: 'Vehicle',
      slug: 'vehicles',
      icon: 'Truck',
      primaryAttributeSlug: 'vin',
    });
    expect(result.slug).toBe('vehicles');
  });

  it('throws ConflictException on duplicate slug within tenant', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create('tenant-1', {
        name: 'Vehicles',
        singularName: 'Vehicle',
        slug: 'vehicles',
        icon: 'Truck',
        primaryAttributeSlug: 'vin',
      }),
    ).rejects.toThrow();
  });
});
```

Create `apps/api/src/modules/custom-objects/controllers/custom-objects.controller.spec.ts`:
```ts
import { CustomObjectsController } from './custom-objects.controller';
import { CustomObjectsService } from '../services/custom-objects.service';

describe('CustomObjectsController', () => {
  let controller: CustomObjectsController;
  let service: CustomObjectsService;

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue([{ id: 'obj-1', slug: 'machinery' }]),
      getBySlug: vi.fn().mockResolvedValue({ id: 'obj-1', slug: 'machinery' }),
      create: vi.fn().mockResolvedValue({ id: 'obj-1', slug: 'machinery' }),
      update: vi.fn(),
      archive: vi.fn(),
      addAttribute: vi.fn(),
      updateAttribute: vi.fn(),
      deleteAttribute: vi.fn(),
      addRelationship: vi.fn(),
      deleteRelationship: vi.fn(),
    } as any;
    controller = new CustomObjectsController(service);
  });

  it('lists custom objects for tenant', async () => {
    const res = await controller.list({ organizationId: 'tenant-1' } as any);
    expect(res).toHaveLength(1);
    expect(res[0].slug).toBe('machinery');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test custom-objects.service.spec.ts`
Expected: FAIL due to missing service.

- [ ] **Step 3: Implement CustomObjectsService and Controller**

Create `apps/api/src/modules/custom-objects/services/custom-objects.service.ts`:
```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomObjectDefinition } from '../entities/custom-object-definition.entity';
import { CustomAttributeDefinition } from '../entities/custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from '../entities/custom-relationship-definition.entity';

@Injectable()
export class CustomObjectsService {
  constructor(
    @InjectRepository(CustomObjectDefinition)
    private readonly objectRepo: Repository<CustomObjectDefinition>,
    @InjectRepository(CustomAttributeDefinition)
    private readonly attrRepo: Repository<CustomAttributeDefinition>,
    @InjectRepository(CustomRelationshipDefinition)
    private readonly relRepo: Repository<CustomRelationshipDefinition>,
  ) {}

  async list(tenantId: string): Promise<CustomObjectDefinition[]> {
    return this.objectRepo.find({
      where: { tenantId, isArchived: false },
      relations: ['attributes', 'relationships'],
      order: { name: 'ASC' },
    });
  }

  async getBySlug(tenantId: string, slug: string): Promise<CustomObjectDefinition> {
    const object = await this.objectRepo.findOne({
      where: { tenantId, slug, isArchived: false },
      relations: ['attributes', 'relationships'],
    });
    if (!object) throw new NotFoundException(`Custom object '${slug}' not found`);
    return object;
  }

  async create(tenantId: string, payload: any): Promise<CustomObjectDefinition> {
    const existing = await this.objectRepo.findOne({
      where: { tenantId, slug: payload.slug },
    });
    if (existing) throw new ConflictException(`Object slug '${payload.slug}' already exists`);

    const entity = this.objectRepo.create({ ...payload, tenantId });
    return this.objectRepo.save(entity);
  }

  async update(tenantId: string, slug: string, payload: any): Promise<CustomObjectDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    Object.assign(object, payload);
    return this.objectRepo.save(object);
  }

  async archive(tenantId: string, slug: string): Promise<void> {
    const object = await this.getBySlug(tenantId, slug);
    object.isArchived = true;
    await this.objectRepo.save(object);
  }

  async addAttribute(tenantId: string, slug: string, payload: any): Promise<CustomAttributeDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    const existing = await this.attrRepo.findOne({
      where: { objectId: object.id, slug: payload.slug },
    });
    if (existing) throw new ConflictException(`Attribute slug '${payload.slug}' already exists`);

    const attr = this.attrRepo.create({ ...payload, tenantId, objectId: object.id });
    return this.attrRepo.save(attr);
  }

  async updateAttribute(tenantId: string, slug: string, attrSlug: string, payload: any): Promise<CustomAttributeDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    const attr = await this.attrRepo.findOne({
      where: { objectId: object.id, slug: attrSlug },
    });
    if (!attr) throw new NotFoundException(`Attribute '${attrSlug}' not found`);

    Object.assign(attr, payload);
    return this.attrRepo.save(attr);
  }

  async deleteAttribute(tenantId: string, slug: string, attrSlug: string): Promise<void> {
    const object = await this.getBySlug(tenantId, slug);
    await this.attrRepo.softDelete({ objectId: object.id, slug: attrSlug });
  }

  async addRelationship(tenantId: string, slug: string, payload: any): Promise<CustomRelationshipDefinition> {
    const object = await this.getBySlug(tenantId, slug);
    const rel = this.relRepo.create({ ...payload, tenantId, sourceObjectId: object.id });
    return this.relRepo.save(rel);
  }

  async deleteRelationship(tenantId: string, slug: string, relSlug: string): Promise<void> {
    const object = await this.getBySlug(tenantId, slug);
    await this.relRepo.softDelete({ sourceObjectId: object.id, slug: relSlug });
  }
}
```

Create `apps/api/src/modules/custom-objects/controllers/custom-objects.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@/common/guards/auth.guard';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PERMISSIONS } from '@saas/shared';
import { CustomObjectsService } from '../services/custom-objects.service';

@Controller('custom-objects')
@UseGuards(AuthGuard)
export class CustomObjectsController {
  constructor(private readonly service: CustomObjectsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  list(@CurrentUser() user: any) {
    return this.service.list(user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  create(@CurrentUser() user: any, @Body() body: any) {
    return this.service.create(user.organizationId, body);
  }

  @Get(':slug')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  getBySlug(@CurrentUser() user: any, @Param('slug') slug: string) {
    return this.service.getBySlug(user.organizationId, slug);
  }

  @Patch(':slug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  update(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.update(user.organizationId, slug, body);
  }

  @Delete(':slug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  archive(@CurrentUser() user: any, @Param('slug') slug: string) {
    return this.service.archive(user.organizationId, slug);
  }

  @Post(':slug/attributes')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  addAttribute(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.addAttribute(user.organizationId, slug, body);
  }

  @Patch(':slug/attributes/:attrSlug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  updateAttribute(
    @CurrentUser() user: any,
    @Param('slug') slug: string,
    @Param('attrSlug') attrSlug: string,
    @Body() body: any,
  ) {
    return this.service.updateAttribute(user.organizationId, slug, attrSlug, body);
  }

  @Delete(':slug/attributes/:attrSlug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  deleteAttribute(@CurrentUser() user: any, @Param('slug') slug: string, @Param('attrSlug') attrSlug: string) {
    return this.service.deleteAttribute(user.organizationId, slug, attrSlug);
  }

  @Post(':slug/relationships')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  addRelationship(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.addRelationship(user.organizationId, slug, body);
  }

  @Delete(':slug/relationships/:relSlug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  deleteRelationship(@CurrentUser() user: any, @Param('slug') slug: string, @Param('relSlug') relSlug: string) {
    return this.service.deleteRelationship(user.organizationId, slug, relSlug);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @saas/api test custom-objects.service.spec.ts custom-objects.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/custom-objects/services/custom-objects.service.* apps/api/src/modules/custom-objects/controllers/custom-objects.controller.*
git commit -m "feat(api): implement custom objects metadata service and controller"
```

---

### Task 5: Backend Record Storage & Dynamic Query Service (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/custom-objects/services/record-validation.service.ts`
- Create: `apps/api/src/modules/custom-objects/services/custom-records.service.ts`
- Create: `apps/api/src/modules/custom-objects/controllers/custom-records.controller.ts`
- Create Test: `apps/api/src/modules/custom-objects/services/custom-records.service.spec.ts`
- Create Test: `apps/api/src/modules/custom-objects/controllers/custom-records.controller.spec.ts`

**Interfaces:**
- Consumes: `CustomRecord` entity, `buildDynamicRecordSchema` from `@saas/shared`
- Produces: `RecordValidationService` (validates record values against dynamic object attributes) and `CustomRecordsService` (`list`, `getById`, `create`, `update`, `delete`) with ownership scoping and JSONB filtering.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/custom-objects/services/custom-records.service.spec.ts`:
```ts
import { CustomRecordsService } from './custom-records.service';

describe('CustomRecordsService', () => {
  let service: CustomRecordsService;
  const mockRepo = {
    createQueryBuilder: vi.fn(),
    create: vi.fn((d) => d),
    save: vi.fn((e) => Promise.resolve({ id: 'rec-1', ...e })),
    findOne: vi.fn(),
    softDelete: vi.fn(),
  };
  const mockObjectsService = {
    getBySlug: vi.fn().mockResolvedValue({ id: 'obj-1', slug: 'machinery', attributes: [] }),
  };
  const mockValidationService = {
    validate: vi.fn((attrs, vals) => vals),
  };

  beforeEach(() => {
    service = new CustomRecordsService(mockRepo as any, mockObjectsService as any, mockValidationService as any);
  });

  it('creates record after dynamic validation', async () => {
    const result = await service.create(
      'tenant-1',
      'machinery',
      { ownerId: 'u-1', values: { serial: '123' } },
      { id: 'u-1', permissions: ['custom_record:create'] },
    );
    expect(result.id).toBe('rec-1');
    expect(mockValidationService.validate).toHaveBeenCalled();
  });
});
```

Create `apps/api/src/modules/custom-objects/controllers/custom-records.controller.spec.ts`:
```ts
import { CustomRecordsController } from './custom-records.controller';

describe('CustomRecordsController', () => {
  let controller: CustomRecordsController;
  let service: any;

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getById: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      create: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    controller = new CustomRecordsController(service);
  });

  it('calls list with user context', async () => {
    const res = await controller.list({ organizationId: 'tenant-1' } as any, 'machinery', {});
    expect(res.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test custom-records.service.spec.ts`
Expected: FAIL due to missing files.

- [ ] **Step 3: Implement RecordValidationService, CustomRecordsService, and Controller**

Create `apps/api/src/modules/custom-objects/services/record-validation.service.ts`:
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { buildDynamicRecordSchema, type CustomAttributeDefinitionDto } from '@saas/shared';

@Injectable()
export class RecordValidationService {
  validate(attributes: CustomAttributeDefinitionDto[], values: Record<string, any>): Record<string, any> {
    const schema = buildDynamicRecordSchema(attributes);
    const result = schema.safeParse(values);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid record values',
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
```

Create `apps/api/src/modules/custom-objects/services/custom-records.service.ts`:
```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS } from '@saas/shared';
import { CustomRecord } from '../entities/custom-record.entity';
import { CustomObjectsService } from './custom-objects.service';
import { RecordValidationService } from './record-validation.service';

@Injectable()
export class CustomRecordsService {
  constructor(
    @InjectRepository(CustomRecord)
    private readonly recordRepo: Repository<CustomRecord>,
    private readonly objectsService: CustomObjectsService,
    private readonly validationService: RecordValidationService,
  ) {}

  async list(tenantId: string, slug: string, params: any, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const qb = this.recordRepo.createQueryBuilder('r')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.objectId = :objectId', { objectId: object.id });

    // Ownership scoping
    const canReadAll = actor.permissions?.includes(PERMISSIONS.CUSTOM_RECORD_READ_ALL);
    if (!canReadAll) {
      qb.andWhere('(r.ownerId = :userId OR r.ownerId IS NULL)', { userId: actor.id });
    }

    // JSONB Search
    if (params.search?.trim()) {
      const s = `%${params.search.trim().toLowerCase()}%`;
      qb.andWhere(`LOWER(r.values->>'${object.primaryAttributeSlug}') LIKE :search`, { search: s });
    }

    // JSONB Field Filters
    if (params.filters && typeof params.filters === 'object') {
      for (const [key, val] of Object.entries(params.filters)) {
        qb.andWhere(`r.values @> :filter_${key}`, { [`filter_${key}`]: JSON.stringify({ [key]: val }) });
      }
    }

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
    qb.skip((page - 1) * limit).take(limit).orderBy('r.createdAt', 'DESC');

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit, object };
  }

  async getById(tenantId: string, slug: string, id: string, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const record = await this.recordRepo.findOne({
      where: { id, tenantId, objectId: object.id },
    });
    if (!record) throw new NotFoundException(`Record '${id}' not found`);

    const canReadAll = actor.permissions?.includes(PERMISSIONS.CUSTOM_RECORD_READ_ALL);
    if (!canReadAll && record.ownerId && record.ownerId !== actor.id) {
      throw new ForbiddenException('You do not have permission to view this record');
    }

    return record;
  }

  async create(tenantId: string, slug: string, payload: any, actor: any) {
    const object = await this.objectsService.getBySlug(tenantId, slug);
    const validatedValues = this.validationService.validate(object.attributes ?? [], payload.values);

    const record = this.recordRepo.create({
      tenantId,
      objectId: object.id,
      ownerId: payload.ownerId ?? actor.id,
      values: validatedValues,
    });
    return this.recordRepo.save(record);
  }

  async update(tenantId: string, slug: string, id: string, payload: any, actor: any) {
    const record = await this.getById(tenantId, slug, id, actor);
    const object = await this.objectsService.getBySlug(tenantId, slug);

    const merged = { ...record.values, ...(payload.values ?? {}) };
    const validatedValues = this.validationService.validate(object.attributes ?? [], merged);

    record.values = validatedValues;
    if (payload.ownerId !== undefined) record.ownerId = payload.ownerId;

    return this.recordRepo.save(record);
  }

  async delete(tenantId: string, slug: string, id: string, actor: any) {
    await this.getById(tenantId, slug, id, actor);
    await this.recordRepo.softDelete({ id, tenantId });
  }
}
```

Create `apps/api/src/modules/custom-objects/controllers/custom-records.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@/common/guards/auth.guard';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PERMISSIONS } from '@saas/shared';
import { CustomRecordsService } from '../services/custom-records.service';

@Controller('objects/:slug/records')
@UseGuards(AuthGuard)
export class CustomRecordsController {
  constructor(private readonly service: CustomRecordsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  list(@CurrentUser() user: any, @Param('slug') slug: string, @Query() query: any) {
    return this.service.list(user.organizationId, slug, query, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_CREATE)
  create(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.create(user.organizationId, slug, body, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  getById(@CurrentUser() user: any, @Param('slug') slug: string, @Param('id') id: string) {
    return this.service.getById(user.organizationId, slug, id, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_UPDATE)
  update(@CurrentUser() user: any, @Param('slug') slug: string, @Param('id') id: string, @Body() body: any) {
    return this.service.update(user.organizationId, slug, id, body, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_DELETE)
  delete(@CurrentUser() user: any, @Param('slug') slug: string, @Param('id') id: string) {
    return this.service.delete(user.organizationId, slug, id, user);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @saas/api test custom-records.service.spec.ts custom-records.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/custom-objects/services/record-validation.service.ts apps/api/src/modules/custom-objects/services/custom-records.service.* apps/api/src/modules/custom-objects/controllers/custom-records.controller.*
git commit -m "feat(api): implement custom records service, validation and controller"
```

---

### Task 6: Core Entity Bridge & Record Links (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/custom-objects/services/core-entity-bridge.service.ts`
- Create: `apps/api/src/modules/custom-objects/custom-objects.module.ts`
- Modify: `apps/api/src/feature-modules.ts`
- Create Test: `apps/api/src/modules/custom-objects/services/core-entity-bridge.service.spec.ts`

**Interfaces:**
- Consumes: `CustomRecordLink` entity, core entity repositories (`Customer`, `Contact`, `Quote`, `WorkOrder`)
- Produces: `CoreEntityBridgeService` (`link`, `unlink`, `getRecordLinks`, `getReverseLinksForCoreEntity`), `CustomObjectsModule` registered in `feature-modules.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/custom-objects/services/core-entity-bridge.service.spec.ts`:
```ts
import { CoreEntityBridgeService } from './core-entity-bridge.service';

describe('CoreEntityBridgeService', () => {
  let service: CoreEntityBridgeService;
  const mockLinkRepo = {
    find: vi.fn(),
    create: vi.fn((d) => d),
    save: vi.fn((e) => Promise.resolve({ id: 'link-1', ...e })),
    delete: vi.fn(),
  };

  beforeEach(() => {
    service = new CoreEntityBridgeService(mockLinkRepo as any, {} as any, {} as any, {} as any, {} as any);
  });

  it('creates a link between custom record and core customer', async () => {
    const res = await service.link('tenant-1', {
      relationshipId: 'rel-1',
      sourceRecordId: 'rec-1',
      targetType: 'core_entity',
      targetRecordId: 'cust-1',
    });
    expect(res.id).toBe('link-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/api test core-entity-bridge.service.spec.ts`
Expected: FAIL due to missing service.

- [ ] **Step 3: Implement CoreEntityBridgeService and CustomObjectsModule**

Create `apps/api/src/modules/custom-objects/services/core-entity-bridge.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomRecordLink } from '../entities/custom-record-link.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';

@Injectable()
export class CoreEntityBridgeService {
  constructor(
    @InjectRepository(CustomRecordLink)
    private readonly linkRepo: Repository<CustomRecordLink>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
    @InjectRepository(WorkOrder)
    private readonly workOrderRepo: Repository<WorkOrder>,
  ) {}

  async link(tenantId: string, payload: { relationshipId: string; sourceRecordId: string; targetType: any; targetRecordId: string }) {
    const link = this.linkRepo.create({ ...payload, tenantId });
    return this.linkRepo.save(link);
  }

  async unlink(tenantId: string, linkId: string) {
    await this.linkRepo.delete({ id: linkId, tenantId });
  }

  async getRecordLinks(tenantId: string, sourceRecordId: string) {
    const links = await this.linkRepo.find({
      where: { tenantId, sourceRecordId },
      relations: ['relationship'],
    });

    // Batch resolve core entity summaries
    const customerIds = links.filter((l) => l.targetType === 'core_entity' && l.relationship?.targetCoreEntity === 'customer').map((l) => l.targetRecordId);
    const customers = customerIds.length > 0 ? await this.customerRepo.findBy({ id: In(customerIds), tenantId }) : [];
    const customerMap = new Map(customers.map((c) => [c.id, { id: c.id, name: c.name, email: c.email }]));

    return links.map((l) => ({
      ...l,
      targetSummary: customerMap.get(l.targetRecordId) ?? { id: l.targetRecordId },
    }));
  }

  async getReverseLinksForCoreEntity(tenantId: string, targetType: string, targetId: string) {
    return this.linkRepo.find({
      where: { tenantId, targetRecordId: targetId },
      relations: ['sourceRecord', 'sourceRecord.object', 'relationship'],
    });
  }
}
```

Create `apps/api/src/modules/custom-objects/custom-objects.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomObjectDefinition } from './entities/custom-object-definition.entity';
import { CustomAttributeDefinition } from './entities/custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from './entities/custom-relationship-definition.entity';
import { CustomRecord } from './entities/custom-record.entity';
import { CustomRecordLink } from './entities/custom-record-link.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';
import { CustomObjectsService } from './services/custom-objects.service';
import { CustomRecordsService } from './services/custom-records.service';
import { RecordValidationService } from './services/record-validation.service';
import { CoreEntityBridgeService } from './services/core-entity-bridge.service';
import { CustomObjectsController } from './controllers/custom-objects.controller';
import { CustomRecordsController } from './controllers/custom-records.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomObjectDefinition,
      CustomAttributeDefinition,
      CustomRelationshipDefinition,
      CustomRecord,
      CustomRecordLink,
      Customer,
      Contact,
      Quote,
      WorkOrder,
    ]),
  ],
  providers: [
    CustomObjectsService,
    CustomRecordsService,
    RecordValidationService,
    CoreEntityBridgeService,
  ],
  controllers: [CustomObjectsController, CustomRecordsController],
  exports: [CustomObjectsService, CustomRecordsService, CoreEntityBridgeService],
})
export class CustomObjectsModule {}
```

Register `CustomObjectsModule` in `apps/api/src/feature-modules.ts`.

- [ ] **Step 4: Run tests and verify build**

Run: `pnpm --filter @saas/api test core-entity-bridge.service.spec.ts`
Expected: PASS.
Run: `pnpm --filter @saas/api build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/custom-objects apps/api/src/feature-modules.ts
git commit -m "feat(api): implement core entity bridge and register CustomObjectsModule"
```

---

### Task 7: Frontend API Client & React Query Hooks (`apps/web`)

**Files:**
- Create: `apps/web/src/lib/api/endpoints/custom-objects.ts`
- Modify: `apps/web/src/lib/api/endpoints/index.ts`
- Modify: `apps/web/src/lib/api/endpoints.ts`
- Create: `apps/web/src/hooks/use-custom-objects.ts`
- Create Test: `apps/web/src/hooks/use-custom-objects.test.ts`

**Interfaces:**
- Consumes: REST endpoints `/custom-objects` and `/objects/:slug/records`
- Produces: `api.customObjects`, `queryKeys.customObjects`, `useCustomObjects()`, `useCustomObject(slug)`, `useCustomRecords(slug, params)`, `useCreateCustomRecord()`, `useUpdateCustomRecord()`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/use-custom-objects.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCustomObjects } from './use-custom-objects';
import { api } from '@/lib/api/endpoints';

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    customObjects: {
      list: vi.fn(),
    },
  },
  queryKeys: {
    customObjects: {
      all: ['custom-objects'],
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useCustomObjects', () => {
  it('loads custom objects definitions', async () => {
    vi.mocked(api.customObjects.list).mockResolvedValue([
      { id: '1', name: 'Machinery', slug: 'machinery' } as any,
    ]);

    const { result } = renderHook(() => useCustomObjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].slug).toBe('machinery');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test use-custom-objects.test.ts`
Expected: FAIL due to missing files.

- [ ] **Step 3: Implement API client methods and React Query hooks**

Create `apps/web/src/lib/api/endpoints/custom-objects.ts`:
```ts
import { apiGet, apiPost, apiPatch, apiDelete } from '../client';
import type {
  CustomObjectDefinitionDto,
  CustomRecordDto,
} from '@saas/shared';

export const customObjectsApi = {
  list: () => apiGet<CustomObjectDefinitionDto[]>('/custom-objects'),
  getBySlug: (slug: string) => apiGet<CustomObjectDefinitionDto>(`/custom-objects/${slug}`),
  create: (data: any) => apiPost<CustomObjectDefinitionDto>('/custom-objects', data),
  update: (slug: string, data: any) => apiPatch<CustomObjectDefinitionDto>(`/custom-objects/${slug}`, data),
  archive: (slug: string) => apiDelete(`/custom-objects/${slug}`),
  addAttribute: (slug: string, data: any) => apiPost(`/custom-objects/${slug}/attributes`, data),
  deleteAttribute: (slug: string, attrSlug: string) => apiDelete(`/custom-objects/${slug}/attributes/${attrSlug}`),

  // Records
  listRecords: (slug: string, params: Record<string, any> = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.search) query.set('search', params.search);
    const qs = query.toString();
    return apiGet<{ items: CustomRecordDto[]; total: number; object: CustomObjectDefinitionDto }>(
      `/objects/${slug}/records${qs ? `?${qs}` : ''}`,
    );
  },
  getRecord: (slug: string, id: string) => apiGet<CustomRecordDto>(`/objects/${slug}/records/${id}`),
  createRecord: (slug: string, data: any) => apiPost<CustomRecordDto>(`/objects/${slug}/records`, data),
  updateRecord: (slug: string, id: string, data: any) => apiPatch<CustomRecordDto>(`/objects/${slug}/records/${id}`, data),
  deleteRecord: (slug: string, id: string) => apiDelete(`/objects/${slug}/records/${id}`),

  // Links
  getReverseLinks: (targetType: string, targetId: string) =>
    apiGet<any[]>(`/objects/links/reverse?targetType=${targetType}&targetId=${targetId}`),
};
```

Export `customObjectsApi` in `apps/web/src/lib/api/endpoints/index.ts` and `apps/web/src/lib/api/endpoints.ts`.
Add queryKeys:
```ts
customObjects: {
  all: ['custom-objects'] as const,
  bySlug: (slug: string) => ['custom-objects', slug] as const,
  records: (slug: string, params: any) => ['custom-objects', slug, 'records', params] as const,
  record: (slug: string, id: string) => ['custom-objects', slug, 'record', id] as const,
  reverseLinks: (type: string, id: string) => ['custom-objects', 'reverse', type, id] as const,
}
```

Create `apps/web/src/hooks/use-custom-objects.ts`:
```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, queryKeys } from '@/lib/api/endpoints';

export function useCustomObjects() {
  return useQuery({
    queryKey: queryKeys.customObjects.all,
    queryFn: () => api.customObjects.list(),
  });
}

export function useCustomObject(slug: string) {
  return useQuery({
    queryKey: queryKeys.customObjects.bySlug(slug),
    queryFn: () => api.customObjects.getBySlug(slug),
    enabled: Boolean(slug),
  });
}

export function useCustomRecords(slug: string, params: Record<string, any> = {}) {
  return useQuery({
    queryKey: queryKeys.customObjects.records(slug, params),
    queryFn: () => api.customObjects.listRecords(slug, params),
    enabled: Boolean(slug),
  });
}

export function useCreateCustomRecord(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.customObjects.createRecord(slug, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-objects', slug, 'records'] });
      toast.success('Record created');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create record'),
  });
}

export function useUpdateCustomRecord(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.customObjects.updateRecord(slug, id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['custom-objects', slug, 'records'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.customObjects.record(slug, id) });
      toast.success('Record updated');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update record'),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test use-custom-objects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/endpoints/custom-objects.ts apps/web/src/lib/api/endpoints/index.ts apps/web/src/lib/api/endpoints.ts apps/web/src/hooks/use-custom-objects.*
git commit -m "feat(web): implement custom objects API client and React Query hooks"
```

---

### Task 8: Object Studio Builder UI (`apps/web`)

**Files:**
- Create: `apps/web/src/app/(app)/settings/objects/page.tsx`
- Create: `apps/web/src/components/settings/objects/object-studio-view.tsx`
- Create: `apps/web/src/components/settings/objects/create-object-dialog.tsx`
- Create: `apps/web/src/components/settings/objects/attribute-editor-drawer.tsx`
- Create Test: `apps/web/src/components/settings/objects/object-studio-view.test.tsx`

**Interfaces:**
- Consumes: `useCustomObjects()` hook, `CUSTOM_ATTRIBUTE_TYPES`
- Produces: `/settings/objects` page allowing admins to create entities, define attributes, and configure relationship links.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/settings/objects/object-studio-view.test.tsx`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ObjectStudioView } from './object-studio-view';

vi.mock('@/hooks/use-custom-objects', () => ({
  useCustomObjects: () => ({
    data: [
      {
        id: '1',
        name: 'Packaging Machinery',
        singularName: 'Machine',
        slug: 'machinery',
        icon: 'Box',
        primaryAttributeSlug: 'serial',
        attributes: [{ id: 'a1', name: 'Serial', slug: 'serial', type: 'text' }],
      },
    ],
    isLoading: false,
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ObjectStudioView', () => {
  it('renders custom objects list and new object button', () => {
    renderWithClient(<ObjectStudioView />);
    expect(screen.getByText('Packaging Machinery')).toBeDefined();
    expect(screen.getByText('New Object')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test object-studio-view.test.tsx`
Expected: FAIL due to missing component.

- [ ] **Step 3: Implement ObjectStudioView, CreateObjectDialog, and AttributeEditorDrawer**

Create `apps/web/src/components/settings/objects/create-object-dialog.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/api/endpoints';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { toast } from 'sonner';

export function CreateObjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [singularName, setSingularName] = useState('');
  const [slug, setSlug] = useState('');
  const [primaryAttributeSlug, setPrimaryAttributeSlug] = useState('name');

  const create = useMutation({
    mutationFn: () =>
      api.customObjects.create({
        name,
        singularName,
        slug,
        primaryAttributeSlug,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customObjects.all });
      toast.success('Custom object created');
      onClose();
    },
    onError: (err: any) => toast.error(err.message || 'Creation failed'),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New Custom Object">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4 pt-2"
      >
        <div>
          <Label>Plural Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Packaging Machinery" required />
        </div>
        <div>
          <Label>Singular Name</Label>
          <Input value={singularName} onChange={(e) => setSingularName(e.target.value)} placeholder="e.g. Machine" required />
        </div>
        <div>
          <Label>URL Slug</Label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))} placeholder="e.g. packaging-machinery" required />
        </div>
        <div>
          <Label>Primary Title Attribute Slug</Label>
          <Input value={primaryAttributeSlug} onChange={(e) => setPrimaryAttributeSlug(e.target.value)} placeholder="name" required />
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={create.isPending}>Create Object</Button>
        </div>
      </form>
    </Dialog>
  );
}
```

Create `apps/web/src/components/settings/objects/object-studio-view.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Plus, Box, Settings2 } from 'lucide-react';
import { useCustomObjects } from '@/hooks/use-custom-objects';
import { PageHeader, Badge, Button, Card } from '@/components/ui/primitives';
import { CreateObjectDialog } from './create-object-dialog';

export function ObjectStudioView() {
  const { data: objects = [], isLoading } = useCustomObjects();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom Objects & Schemas"
        description="Design tenant-specific business entities, custom attributes, and relational bridges."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="size-4" />
            <span>New Object</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {objects.map((obj) => (
          <Card key={obj.id} className="p-4 flex flex-col justify-between hover:border-brand/40 transition-colors">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-surface-muted rounded-lg text-ink">
                    <Box className="size-4" />
                  </span>
                  <h3 className="font-semibold text-sm text-ink">{obj.name}</h3>
                </div>
                <Badge tone="brand">/{obj.slug}</Badge>
              </div>
              <p className="text-xs text-ink-muted">
                {obj.attributes?.length ?? 0} attributes · {obj.relationships?.length ?? 0} relationships
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/40 flex justify-end">
              <Button variant="outline" size="sm" className="gap-1 text-xs">
                <Settings2 className="size-3.5" />
                Configure Fields
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <CreateObjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
```

Create `apps/web/src/app/(app)/settings/objects/page.tsx`:
```tsx
import { ObjectStudioView } from '@/components/settings/objects/object-studio-view';

export default function ObjectsSettingsPage() {
  return <ObjectStudioView />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test object-studio-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/settings/objects apps/web/src/components/settings/objects
git commit -m "feat(web): implement Object Studio builder page and creation dialog"
```

---

### Task 9: Dynamic Record Browser (`apps/web`)

**Files:**
- Create: `apps/web/src/app/(app)/objects/[slug]/page.tsx`
- Create: `apps/web/src/components/objects/custom-object-records-view.tsx`
- Create: `apps/web/src/components/objects/custom-record-form-dialog.tsx`
- Create Test: `apps/web/src/components/objects/custom-object-records-view.test.tsx`

**Interfaces:**
- Consumes: `<DataViewContainer>`, `<InlineEditableTable>`, `<KanbanBoard>`, `useCustomRecords(slug)`
- Produces: `/objects/[slug]` dynamic record browser with Table & Pipeline modes, dynamic attribute columns, and record creation dialog.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/objects/custom-object-records-view.test.tsx`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomObjectRecordsView } from './custom-object-records-view';

vi.mock('@/hooks/use-custom-objects', () => ({
  useCustomRecords: () => ({
    data: {
      items: [
        {
          id: 'rec-1',
          values: { name: 'Line A Packer', serial: 'SN-001' },
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      total: 1,
      object: {
        id: 'obj-1',
        name: 'Machinery',
        slug: 'machinery',
        primaryAttributeSlug: 'name',
        attributes: [
          { id: 'a1', name: 'Name', slug: 'name', type: 'text' },
          { id: 'a2', name: 'Serial', slug: 'serial', type: 'text' },
        ],
      },
    },
    isLoading: false,
  }),
  useCreateCustomRecord: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomRecord: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/use-saved-views', () => ({
  useSavedViews: () => ({ views: [], activeView: null, setActiveViewId: vi.fn() }),
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('CustomObjectRecordsView', () => {
  it('renders records table with dynamic column headers and values', () => {
    renderWithClient(<CustomObjectRecordsView slug="machinery" />);
    expect(screen.getByText('Line A Packer')).toBeDefined();
    expect(screen.getByText('SN-001')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test custom-object-records-view.test.tsx`
Expected: FAIL due to missing component.

- [ ] **Step 3: Implement CustomRecordFormDialog, CustomObjectRecordsView, and Route Page**

Create `apps/web/src/components/objects/custom-record-form-dialog.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import type { CustomAttributeDefinitionDto } from '@saas/shared';

export function CustomRecordFormDialog({
  open,
  onClose,
  attributes,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  attributes: CustomAttributeDefinitionDto[];
  onSubmit: (values: Record<string, any>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  return (
    <Dialog open={open} onClose={onClose} title="New Record">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          try {
            await onSubmit(values);
            onClose();
          } finally {
            setLoading(false);
          }
        }}
        className="space-y-4 pt-2"
      >
        {attributes.map((attr) => (
          <div key={attr.id}>
            <Label>{attr.name}{attr.isRequired ? ' *' : ''}</Label>
            {attr.type === 'number' || attr.type === 'currency' ? (
              <Input
                type="number"
                value={values[attr.slug] ?? ''}
                onChange={(e) => setValues({ ...values, [attr.slug]: Number(e.target.value) })}
                required={attr.isRequired}
              />
            ) : attr.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(values[attr.slug])}
                onChange={(e) => setValues({ ...values, [attr.slug]: e.target.checked })}
                className="size-4"
              />
            ) : (
              <Input
                type="text"
                value={values[attr.slug] ?? ''}
                onChange={(e) => setValues({ ...values, [attr.slug]: e.target.value })}
                required={attr.isRequired}
              />
            )}
          </div>
        ))}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={loading}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
```

Create `apps/web/src/components/objects/custom-object-records-view.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCustomRecords, useCreateCustomRecord } from '@/hooks/use-custom-objects';
import { DataViewContainer } from '@/components/views/data-view-container';
import { InlineEditableTable } from '@/components/views/inline-editable-table';
import { KanbanBoard, type KanbanColumnDef } from '@/components/views/kanban-board';
import { PageHeader, Button } from '@/components/ui/primitives';
import { CustomRecordFormDialog } from './custom-record-form-dialog';
import type { ColumnDef } from '@tanstack/react-table';

export function CustomObjectRecordsView({ slug }: { slug: string }) {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const { data } = useCustomRecords(slug, { search });
  const createRecord = useCreateCustomRecord(slug);

  const object = data?.object;
  const records = data?.items ?? [];
  const attributes = object?.attributes ?? [];

  // Find first select attribute to act as Kanban pipeline status
  const selectAttribute = attributes.find((a) => a.type === 'select');
  const kanbanColumns: KanbanColumnDef[] = useMemo(() => {
    if (!selectAttribute?.options) return [{ key: 'all', label: 'All Records' }];
    return selectAttribute.options.map((opt) => ({
      key: opt.value,
      label: opt.label,
    }));
  }, [selectAttribute]);

  const columns: ColumnDef<any, any>[] = useMemo(() => {
    return attributes.map((attr) => ({
      accessorKey: `values.${attr.slug}`,
      id: attr.slug,
      header: attr.name,
      cell: ({ row }) => {
        const val = row.original.values?.[attr.slug];
        if (attr.slug === object?.primaryAttributeSlug) {
          return (
            <Link
              href={`/objects/${slug}/${row.original.id}`}
              className="font-medium text-ink hover:text-brand transition-colors"
            >
              {String(val ?? '—')}
            </Link>
          );
        }
        return <span>{String(val ?? '—')}</span>;
      },
    }));
  }, [attributes, object?.primaryAttributeSlug, slug]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={object?.name ?? 'Records'}
        description={`Manage ${object?.singularName ?? 'record'} instances and dynamic attributes.`}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="size-4" />
            <span>New {object?.singularName ?? 'Record'}</span>
          </Button>
        }
      />

      <DataViewContainer entityType={`custom_object:${slug}`} search={search} onSearchChange={setSearch}>
        {({ viewType }) =>
          viewType === 'kanban' && selectAttribute ? (
            <KanbanBoard
              columns={kanbanColumns}
              items={records}
              getItemId={(r) => r.id}
              getStageKey={(r) => r.values?.[selectAttribute.slug] ?? 'all'}
              onMoveStage={async () => {}}
              renderCard={(r) => (
                <div className="flex flex-col gap-1">
                  <Link
                    href={`/objects/${slug}/${r.id}`}
                    className="font-medium text-xs text-ink hover:text-brand line-clamp-1"
                  >
                    {r.values?.[object?.primaryAttributeSlug ?? ''] ?? 'Untitled'}
                  </Link>
                </div>
              )}
            />
          ) : (
            <InlineEditableTable
              data={records}
              columns={columns}
              onCellUpdate={async () => {}}
            />
          )
        }
      </DataViewContainer>

      <CustomRecordFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        attributes={attributes}
        onSubmit={async (values) => {
          await createRecord.mutateAsync({ values });
        }}
      />
    </div>
  );
}
```

Create `apps/web/src/app/(app)/objects/[slug]/page.tsx`:
```tsx
import { use } from 'react';
import { CustomObjectRecordsView } from '@/components/objects/custom-object-records-view';

export default function ObjectRecordsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <CustomObjectRecordsView slug={slug} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test custom-object-records-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/objects apps/web/src/components/objects/custom-object-records-view.* apps/web/src/components/objects/custom-record-form-dialog.tsx
git commit -m "feat(web): implement dynamic records view with table and kanban modes"
```

---

### Task 10: Dynamic Record Detail View, Reverse Tabs & Sidebar Integration (`apps/web`)

**Files:**
- Create: `apps/web/src/app/(app)/objects/[slug]/[id]/page.tsx`
- Create: `apps/web/src/components/objects/custom-record-detail-view.tsx`
- Create: `apps/web/src/components/objects/related-custom-records.tsx`
- Modify: `apps/web/src/components/customers/customer-detail-view.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Create Test: `apps/web/src/components/objects/related-custom-records.test.tsx`

**Interfaces:**
- Consumes: `api.customObjects.getReverseLinks()`, `useCustomRecord(slug, id)`
- Produces: Record detail dual-pane inspector, `<RelatedCustomRecords>` tab for customers, and dynamic "Custom Data" sidebar section.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/objects/related-custom-records.test.tsx`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RelatedCustomRecords } from './related-custom-records';
import { api } from '@/lib/api/endpoints';

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    customObjects: {
      getReverseLinks: vi.fn(),
    },
  },
  queryKeys: {
    customObjects: {
      reverseLinks: (t: string, id: string) => ['reverse-links', t, id],
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('RelatedCustomRecords', () => {
  it('displays linked custom records', async () => {
    vi.mocked(api.customObjects.getReverseLinks).mockResolvedValue([
      {
        id: 'link-1',
        sourceRecord: {
          id: 'rec-1',
          object: { name: 'Machinery', slug: 'machinery', primaryAttributeSlug: 'name' },
          values: { name: 'Automated Cartoner' },
        },
      },
    ]);

    renderWithClient(<RelatedCustomRecords targetType="customer" targetId="cust-1" />);
    expect(await screen.findByText('Automated Cartoner')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test related-custom-records.test.tsx`
Expected: FAIL due to missing component.

- [ ] **Step 3: Implement RelatedCustomRecords, Detail View, and Sidebar integration**

Create `apps/web/src/components/objects/related-custom-records.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/api/endpoints';
import { Card, Badge } from '@/components/ui/primitives';

export function RelatedCustomRecords({ targetType, targetId }: { targetType: string; targetId: string }) {
  const { data: links = [], isLoading } = useQuery({
    queryKey: queryKeys.customObjects.reverseLinks(targetType, targetId),
    queryFn: () => api.customObjects.getReverseLinks(targetType, targetId),
  });

  if (links.length === 0 && !isLoading) {
    return <div className="p-4 text-xs text-ink-muted">No linked custom records.</div>;
  }

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const record = link.sourceRecord;
        const object = record?.object;
        const title = record?.values?.[object?.primaryAttributeSlug ?? ''] ?? 'Untitled Record';

        return (
          <Card key={link.id} className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="brand">{object?.name}</Badge>
              <Link
                href={`/objects/${object?.slug}/${record?.id}`}
                className="font-medium text-xs text-ink hover:text-brand"
              >
                {title}
              </Link>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
```

Create `apps/web/src/components/objects/custom-record-detail-view.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useCustomRecord } from '@/hooks/use-custom-objects';
import { Card, PageHeader } from '@/components/ui/primitives';

export function CustomRecordDetailView({ slug, id }: { slug: string; id: string }) {
  const { data: record, isLoading } = useCustomRecord(slug, id);

  return (
    <div className="space-y-6">
      <Link
        href={`/objects/${slug}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Back to list
      </Link>

      <PageHeader title="Record Details" />

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm text-ink">Attributes</h3>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(record?.values ?? {}).map(([key, val]) => (
            <div key={key} className="border-b border-border/40 pb-2">
              <span className="text-xs text-ink-muted uppercase">{key}</span>
              <p className="font-medium text-sm text-ink">{String(val ?? '—')}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
```

Create `apps/web/src/app/(app)/objects/[slug]/[id]/page.tsx`:
```tsx
import { use } from 'react';
import { CustomRecordDetailView } from '@/components/objects/custom-record-detail-view';

export default function RecordDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params);
  return <CustomRecordDetailView slug={slug} id={id} />;
}
```

Modify `apps/web/src/components/customers/customer-detail-view.tsx` to render `<RelatedCustomRecords targetType="customer" targetId={customer.id} />` in a related records section.
Modify `apps/web/src/components/layout/app-shell.tsx` to fetch `useCustomObjects()` and render active custom object links under a collapsible "Custom Data" sidebar section.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test related-custom-records.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify web typecheck and commit**

```bash
pnpm --filter web typecheck
git add apps/web/src/app/\(app\)/objects apps/web/src/components/objects apps/web/src/components/customers/customer-detail-view.tsx apps/web/src/components/layout/app-shell.tsx
git commit -m "feat(web): implement record detail view, reverse relations tab and sidebar links"
```

---

### Task 11: End-to-End Build & Drift Verification

**Files:** None (monorepo verification)

- [ ] **Step 1: Run all unit test suites**
Run: `pnpm test`
Expected: All tests across `@saas/shared`, `@saas/api`, and `web` pass (1,566+ tests).

- [ ] **Step 2: Run full production build**
Run: `pnpm build`
Expected: `@saas/shared`, `@saas/api`, and `web` compile with zero errors and all static routes generated.

- [ ] **Step 3: Commit final verification**
```bash
git status
```
Verify clean git tree.
