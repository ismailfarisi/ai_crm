# Custom Objects & Dynamic Relationships Engine — Design Specification

- **Date:** 2026-10-06
- **Status:** Approved
- **Author:** Relay CRM Architecture Team
- **Target Implementation:** `apps/api`, `apps/web`, `packages/shared`

---

## 1. Context & Motivation

Relay CRM is an end-to-end operational CRM and ERP platform tailored for made-to-order manufacturing and high-touch commercial operations. While Relay excels in operational execution (BOM costing, shop-floor work orders, double-entry bookkeeping, and WhatsApp field agents), its data model historically relied strictly on rigid compile-time TypeORM entities (`Contact`, `Customer`, `Quote`, `Order`).

Modern revenue platforms like **Attio** and **Salesforce** provide tenants with the ability to define their own custom business entities (e.g., *Packaging Machinery*, *Distributor Agreements*, *Vehicle Fleets*, *Quality Certifications*) with dynamic attributes and relational links.

This specification details the architecture for Relay CRM's **Custom Objects & Dynamic Relationships Engine**, bringing Salesforce/Attio-grade data modeling flexibility to Relay while preserving its strict multi-tenant isolation, Postgres Row-Level Security (`NOBYPASSRLS`), audit logging, and transactional integrity.

---

## 2. Architecture Overview

The system adopts a **Metadata-Driven Universal Storage Pattern** optimized for PostgreSQL:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. METADATA LAYER (Tenant-Defined Schemas)                             │
├────────────────────────────────────────────────────────────────────────┤
│ • custom_object_definitions        (Object metadata, slugs, icons)     │
│ • custom_attribute_definitions     (Attribute types, validation rules) │
│ • custom_relationship_definitions  (Cardinality, target references)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Governs
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. DATA STORAGE LAYER (Universal Record Store)                         │
├────────────────────────────────────────────────────────────────────────┤
│ • custom_records                   (JSONB values, GIN-indexed, RLS)    │
│ • custom_record_links              (Bidirectional relationship joins)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Bridges to
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. CORE OPERATIONAL ENTITIES (Relay ERP Spine)                         │
├────────────────────────────────────────────────────────────────────────┤
│ • customers, contacts, quotes, orders, work_orders, purchase_orders    │
└────────────────────────────────────────────────────────────────────────┘
```

### Architectural Tenets:
1. **Zero Runtime DDL:** Creating objects or fields never executes `CREATE TABLE` or `ALTER TABLE`. All definitions are stored as relational metadata, eliminating schema migration locks and connection pool fragmentation.
2. **Sub-Millisecond GIN Indexing:** Record values are stored in a typed PostgreSQL `jsonb` column backed by an inverted Generalized Inverted Index (`GIN`), enabling fast JSON containment queries (`@>`).
3. **Defense-in-Depth RLS:** All custom object tables inherit `TenantSoftDeletableEntity` and enforce PostgreSQL Row-Level Security under the non-superuser `NOBYPASSRLS` role.
4. **Transparent Audit Logging:** Relay's global `AuditInterceptor` automatically photographs record creation, updates, and diffs.

---

## 3. Database Schema & TypeORM Entities

### 3.1. `custom_object_definitions`
Defines the custom entity type for a tenant.
```sql
CREATE TABLE custom_object_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(80) NOT NULL,
    singular_name VARCHAR(80) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    icon VARCHAR(40) NOT NULL DEFAULT 'Box',
    description TEXT,
    primary_attribute_slug VARCHAR(80) NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_custom_objects_tenant_slug UNIQUE (tenant_id, slug)
);
CREATE INDEX idx_custom_objects_tenant ON custom_object_definitions (tenant_id, is_archived);
```

### 3.2. `custom_attribute_definitions`
Defines fields belonging to a custom object.
```sql
CREATE TYPE custom_attribute_type AS ENUM (
    'text', 'number', 'boolean', 'date', 'datetime',
    'select', 'multiselect', 'currency', 'url', 'email', 'phone'
);

CREATE TABLE custom_attribute_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    object_id UUID NOT NULL REFERENCES custom_object_definitions(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    type custom_attribute_type NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    is_unique BOOLEAN NOT NULL DEFAULT FALSE,
    is_searchable BOOLEAN NOT NULL DEFAULT TRUE,
    default_value JSONB,
    options JSONB, -- Array of { label: string, value: string, color?: string }
    validation_rules JSONB, -- { min?: number, max?: number, pattern?: string }
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_custom_attributes_object_slug UNIQUE (object_id, slug)
);
CREATE INDEX idx_custom_attributes_object ON custom_attribute_definitions (object_id, sort_order);
```

### 3.3. `custom_records`
Stores the actual instance records for any custom object.
```sql
CREATE TABLE custom_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    object_id UUID NOT NULL REFERENCES custom_object_definitions(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    values JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_custom_records_tenant_obj ON custom_records (tenant_id, object_id, created_at DESC);
CREATE INDEX idx_custom_records_owner ON custom_records (tenant_id, owner_id);
CREATE INDEX idx_custom_records_values_gin ON custom_records USING GIN (values);
```

### 3.4. `custom_relationship_definitions`
Defines relationship rules between objects.
```sql
CREATE TYPE relationship_target_type AS ENUM ('custom_object', 'core_entity');
CREATE TYPE relationship_core_entity AS ENUM ('customer', 'contact', 'quote', 'order', 'work_order', 'purchase_order');
CREATE TYPE relationship_cardinality AS ENUM ('many_to_one', 'many_to_many');

CREATE TABLE custom_relationship_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    source_object_id UUID NOT NULL REFERENCES custom_object_definitions(id) ON DELETE CASCADE,
    target_type relationship_target_type NOT NULL,
    target_object_id UUID REFERENCES custom_object_definitions(id) ON DELETE CASCADE,
    target_core_entity relationship_core_entity,
    name VARCHAR(80) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    cardinality relationship_cardinality NOT NULL DEFAULT 'many_to_one',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_custom_rel_source_slug UNIQUE (source_object_id, slug)
);
```

### 3.5. `custom_record_links`
The join table instantiating relationship links between records.
```sql
CREATE TABLE custom_record_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    relationship_id UUID NOT NULL REFERENCES custom_relationship_definitions(id) ON DELETE CASCADE,
    source_record_id UUID NOT NULL REFERENCES custom_records(id) ON DELETE CASCADE,
    target_type relationship_target_type NOT NULL,
    target_record_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_record_links_unique_edge UNIQUE (relationship_id, source_record_id, target_record_id)
);
CREATE INDEX idx_record_links_source ON custom_record_links (tenant_id, relationship_id, source_record_id);
CREATE INDEX idx_record_links_target ON custom_record_links (tenant_id, target_record_id);
```

---

## 4. API Endpoints & Contracts

### 4.1. Metadata Endpoints (`/api/v1/custom-objects`)
* `GET    /custom-objects` — List all active custom objects for the current tenant.
* `POST   /custom-objects` — Create a new custom object definition.
* `GET    /custom-objects/:slug` — Retrieve an object definition with its attributes & relationships.
* `PATCH  /custom-objects/:slug` — Update name, singular name, icon, description, or primary attribute.
* `DELETE /custom-objects/:slug` — Soft-delete / archive an object definition.
* `POST   /custom-objects/:slug/attributes` — Create an attribute definition.
* `PATCH  /custom-objects/:slug/attributes/:attrSlug` — Update attribute definition.
* `DELETE /custom-objects/:slug/attributes/:attrSlug` — Soft-delete an attribute definition.
* `POST   /custom-objects/:slug/relationships` — Create a relationship definition.
* `DELETE /custom-objects/:slug/relationships/:relSlug` — Delete a relationship definition.

### 4.2. Record Data Endpoints (`/api/v1/objects/:slug/records`)
* `GET    /objects/:slug/records` — Query records with pagination, filtering, and sorting.
  * Query parameters: `page`, `limit`, `search`, `sortBy`, `sortOrder`, `filter[attrSlug]=val`.
* `POST   /objects/:slug/records` — Create a record with dynamic schema validation.
* `GET    /objects/:slug/records/:id` — Get record by ID with resolved relationship summaries.
* `PATCH  /objects/:slug/records/:id` — Update record values.
* `DELETE /objects/:slug/records/:id` — Soft-delete record.
* `POST   /objects/:slug/records/:id/links` — Link record to another custom or core record.
* `DELETE /objects/:slug/records/:id/links/:linkId` — Unlink record.
* `GET    /objects/links/reverse` — Reverse lookup: find all custom records linked to a core entity (`?targetType=customer&targetId=:id`).

---

## 5. Dynamic Validation & Query Engine

### 5.1. Dynamic Zod Validation (`RecordValidationService`)
Because attributes are defined at runtime, incoming record payloads are validated dynamically:
1. Active attributes for `object_id` are loaded from cache (cached in Redis / memory for 60s, invalidated on attribute mutation).
2. The service dynamically builds a Zod object schema:
   * `text`: `z.string().trim().max(rules?.max ?? 255)`
   * `number` / `currency`: `z.number().min(rules?.min ?? -Infinity).max(rules?.max ?? Infinity)`
   * `boolean`: `z.boolean()`
   * `date` / `datetime`: `z.string().datetime()`
   * `select`: `z.string().refine(val => options.includes(val))`
   * `multiselect`: `z.array(z.string()).refine(vals => vals.every(v => options.includes(v)))`
3. Applies nullish transformation: empty strings are converted to `null`.
4. Rejects undeclared attributes to prevent unstructured JSON clutter.

### 5.2. Query Compilation
The `CustomRecordsQueryService` translates REST query parameters into optimal PostgreSQL queries:
* **Equality & Containment:** Uses `values @> '{"field": "value"}'::jsonb`.
* **Range Filters:** Uses `(values->>'num_field')::numeric >= :min`.
* **Search:** Searches across attributes flagged with `is_searchable: true` or the `primary_attribute_slug` using ILIKE / full-text indexing.

---

## 6. Bidirectional Relationships & Core Entity Bridge

When custom records link to core entities (`Customer`, `Quote`, `Contact`, `WorkOrder`):
1. **Batched Summary Resolution:** The `CoreEntityBridgeService` fetches related records in batched queries:
   * `customer`: Resolves `{ id, companyName, email, phone, city }`
   * `quote`: Resolves `{ id, quoteNumber, title, status, totalAmount, currency }`
   * `contact`: Resolves `{ id, firstName, lastName, email }`
   * `work_order`: Resolves `{ id, orderNumber, status, plannedQuantity }`
2. **Reverse Integration on Core Pages:**
   * On `/customers/[id]`, a `<RelatedCustomRecords targetType="customer" targetId={id} />` component queries `GET /objects/links/reverse?targetType=customer&targetId=:id` and renders a tab of linked custom objects (e.g., all *Equipment* installed at the customer's site).

---

## 7. RBAC & Security Enforcement

Permissions adhere strictly to Relay's single source of truth in `packages/shared/src/rbac/permissions/custom-objects.ts`:

```ts
export const CUSTOM_OBJECT_PERMISSIONS = {
  CUSTOM_OBJECT_MANAGE: 'custom_object:manage',
  CUSTOM_RECORD_READ: 'custom_record:read',
  CUSTOM_RECORD_READ_ALL: 'custom_record:read_all',
  CUSTOM_RECORD_CREATE: 'custom_record:create',
  CUSTOM_RECORD_UPDATE: 'custom_record:update',
  CUSTOM_RECORD_DELETE: 'custom_record:delete',
  CUSTOM_RECORD_EXPORT: 'custom_record:export',
} as const;
```

### Role Grants:
* **Owner & Admin:** Full schema management (`custom_object:manage`) and wildcard record access (`custom_record:*`).
* **Manager:** `custom_record:read_all`, `create`, `update`, `delete`, `export`. Cannot modify schema definitions.
* **Member (Sales Rep / Operator):** `custom_record:read`, `create`, `update`. Read and edit access is scoped to records they own (`owner_id = user.id` or unassigned).
* **Viewer:** `custom_record:read` (read-only access to own/assigned records).

### Scoped Access Enforcement:
All record queries invoke `CustomRecordsService.scoped(actor)`:
1. Strictly injects `tenantId = actor.organizationId`.
2. Enforces ownership condition `(owner_id = :userId OR owner_id IS NULL)` unless actor holds `custom_record:read_all`.

---

## 8. Web UI & UX Architecture

The Next.js 16 frontend integrates custom objects seamlessly:
1. **Dynamic Navigation:** `apps/web/src/components/layout/sidebar.tsx` fetches active custom objects on layout load and renders them under an expandable **"Custom Data"** section with custom Lucide icons.
2. **Object Studio (`/settings/objects`):** An administrative builder for creating objects, adding attributes via a slide-over drawer, and defining relationships.
3. **Record Table View (`/objects/[slug]`):** High-density table featuring dynamic columns, column visibility toggles, instant search, and status filters.
4. **Record Detail View (`/objects/[slug]/[id]`):** Dual-pane interface with attribute inspector on the left and tabbed contextual panels (Relationships, Audit Log) on the right.
5. **Core Record Tabs:** Customer, Quote, and Contact detail views gain a "Related Records" tab displaying linked custom objects.

---

## 9. Error Handling & Edge Cases

| Scenario | System Behavior |
| :--- | :--- |
| **Deleting an attribute that contains data** | Attribute is soft-deleted. Existing values in `custom_records.values` remain preserved in JSONB history but are omitted from UI and future validation. |
| **Slug collision** | Prevented by database unique index `(tenant_id, slug)`. The API returns a `409 Conflict` with a user-friendly error message. |
| **Deleted core entity** | TypeORM subscribers on `Customer`, `Quote`, etc., automatically clean up corresponding links in `custom_record_links`. |
| **Concurrent schema updates** | Cache invalidation triggers immediate re-compilation of the Zod validation schema on the next request. |

---

## 10. Verification Strategy

1. **Unit Tests:**
   * Dynamic Zod compiler tests with valid/invalid types for all 11 attribute types.
   * `CustomRecordsService.scoped()` tests asserting tenant and ownership isolation.
2. **API E2E Tests:**
   * Full lifecycle: Create object definition -> Add attributes -> Define relationship -> Insert records -> Query with JSONB filters -> Link to core Customer -> Soft-delete.
3. **Database Drift Verification:**
   * Execute `pnpm migration:generate` and assert zero unexpected drift.
   * Run `pnpm check:drift` and `pnpm check:books` to ensure financial ledger integrity remains 100% unaffected.
