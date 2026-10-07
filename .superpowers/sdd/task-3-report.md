# Task 3 Report: Backend Database Migration & TypeORM Entities (`apps/api`)

## Status: DONE

### Summary of Work
Implemented the database migration, TypeORM entity definitions, and Row-Level Security (RLS) policies for the Custom Objects & Dynamic Relationships Engine in `apps/api`.

### Created / Modified Files
1. **Migration**:
   - `apps/api/src/database/migrations/1789000000000-CreateCustomObjectsTables.ts`:
     - Creates tables: `custom_object_definitions`, `custom_attribute_definitions`, `custom_relationship_definitions`, `custom_records`, `custom_record_links`.
     - Creates composite unique constraints, foreign keys with cascade delete, and indexing (including GIN index on `custom_records.values`).
     - Enables and forces Row-Level Security (RLS) on all 5 tables with `tenant_isolation_policy` respecting `app.bypass_rls` and `app.current_tenant_id`.
     - Full rollback down migration to drop tables cleanly.
2. **TypeORM Entities**:
   - `apps/api/src/modules/custom-objects/entities/custom-object-definition.entity.ts`: Extends `TenantSoftDeletableEntity`, unique constraint on `(tenant_id, slug)`, one-to-many relations with attributes and relationships.
   - `apps/api/src/modules/custom-objects/entities/custom-attribute-definition.entity.ts`: Extends `TenantSoftDeletableEntity`, unique constraint on `(object_id, slug)`, jsonb columns for `default_value`, `options`, `validation_rules`.
   - `apps/api/src/modules/custom-objects/entities/custom-relationship-definition.entity.ts`: Extends `TenantSoftDeletableEntity`, unique constraint on `(source_object_id, slug)`, target configuration and cardinality.
   - `apps/api/src/modules/custom-objects/entities/custom-record.entity.ts`: Extends `TenantSoftDeletableEntity`, jsonb `values` dictionary.
   - `apps/api/src/modules/custom-objects/entities/custom-record-link.entity.ts`: Unique edge constraint on `(relationship_id, source_record_id, target_record_id)`, relations to definition and source record.
   - `apps/api/src/modules/custom-objects/entities/index.ts`: Barrel export file.
3. **Unit Tests**:
   - `apps/api/src/modules/custom-objects/entities/custom-objects.entities.spec.ts`: Unit tests validating entity instantiation and default attributes across all custom object entities.

### Verification & Testing
- **TDD Step 1 & 2**: Created unit test and verified initial test failure before entities were defined (failure confirmed: module not found).
- **TDD Step 4**: Ran unit tests with Jest after implementing entities:
  - Command: `pnpm --filter api test custom-objects.entities.spec.ts`
  - Output: 5/5 tests passing (100% pass rate).
- **TypeScript & Nest Build**: Ran `pnpm --filter api build` — build succeeded without errors.

### Commits
- `200fb10`: `feat(api): implement custom objects entities, RLS policies and migration`
