# Task 3 Report: Refactor TypeORM Entities & Domain Services to Standardized tenantId

**Date:** 2026-10-01  
**Branch:** `feat/postgres-rls-multitenancy`  
**Commit:** `9d9b26d` (`refactor: update entities and services to standardized tenantId`)  
**Status:** Completed & Verified  

---

## 1. Overview & Objective

Task 3 aligns the NestJS TypeORM domain model in `apps/api` with the column standardization database migration established in Task 2. Specifically, the legacy column name `organization_id` (and TypeORM property `organizationId`) has been refactored to `tenant_id` and property `tenantId` across all core tenant-partitioned entities, indexes, and service query builders.

The actor context model preserves `actor.organizationId` on `AuthenticatedUser` (reflecting JWT claims), while entity properties and database queries now reference `tenantId` uniformly.

---

## 2. Changes Implemented

### A. Base Entities (`apps/api/src/common/entities/base.entity.ts`)
- **`TenantBaseEntity`**: Abstract base entity extending `BaseEntity`, introducing `@Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string`.
- **`TenantSoftDeletableEntity`**: Abstract base entity extending `SoftDeletableEntity`, introducing `@Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string`.

### B. Core Tenant Entities
1. **`Contact` (`apps/api/src/modules/contacts/entities/contact.entity.ts`)**:
   - Extends `TenantSoftDeletableEntity`.
   - Updated `@JoinColumn({ name: 'tenant_id' })`.
   - Updated composite indexes to use `tenantId`.
2. **`Customer` (`apps/api/src/modules/customers/entities/customer.entity.ts`)**:
   - Extends `TenantSoftDeletableEntity`.
   - Updated `@JoinColumn({ name: 'tenant_id' })`.
   - Renamed indexes: `idx_customers_tenant_created` (`['tenantId', 'createdAt']`) and `uq_customers_tenant_company` (`['tenantId', 'companyName']`).
3. **`User` (`apps/api/src/modules/users/entities/user.entity.ts`)**:
   - Extends `TenantBaseEntity`.
   - Updated `@JoinColumn({ name: 'tenant_id' })`.
4. **`Team` (`apps/api/src/modules/teams/entities/team.entity.ts`)**:
   - Extends `TenantSoftDeletableEntity`.
   - Updated `@JoinColumn({ name: 'tenant_id' })`.
   - Renamed index: `idx_teams_tenant_name` (`['tenantId', 'name']`).
5. **`Role` (`apps/api/src/modules/rbac/entities/role.entity.ts`)**:
   - Extends `TenantBaseEntity`.
   - Updated `@JoinColumn({ name: 'tenant_id' })`.
   - Renamed index: `uq_roles_tenant_slug` (`['tenantId', 'slug']`).
6. **`Invitation` (`apps/api/src/modules/invitations/entities/invitation.entity.ts`)**:
   - Extends `TenantBaseEntity`.
   - Updated `@JoinColumn({ name: 'tenant_id' })`.
7. **`DocumentTemplate` (`apps/api/src/modules/document-templates/entities/document-template.entity.ts`)**:
   - Explicitly mapped `@Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string`.
   - Renamed index: `idx_document_templates_tenant` (`['tenantId', 'type']`).

### C. Domain Services & Repositories
- **`ContactsService`**: `findOrCreateForChannel`, `create`, and `scoped()` updated to filter and save `tenantId: actor.organizationId`.
- **`CustomersService` & `CustomerStatementService`**: Filter and query builders updated from `customer.organizationId` to `customer.tenantId`.
- **`TeamsService`**: `listTeams`, `getTeam`, `createTeam`, `deleteTeam`, `findTeam`, `findMemberInOrg`, and `ensureUniqueName` updated to query by `tenantId`.
- **`UsersService`**: `createUser`, `listMembers`, `findMember`, `findTeamInOrg`, and `isLastActiveOwner` updated to operate on `tenantId`.
- **`RbacService`**: `syncSystemRolesForAllOrganizations`, `provisionSystemRoles`, `resolveAccess`, `listRoles`, `findRole`, `createRole`, `findRolesByIds`, and `findRoleBySlug` updated to use `tenantId`.
- **`InvitationsService`**: `createInvitation`, `listPending`, `consume`, and `findPending` updated to use `tenantId`.
- **`DocumentTemplatesService`**: `findAll`, `findById`, `create`, `delete`, `setDefault`, `resolveForDocumentType`, and `unsetDefaultConflict` updated to use `tenantId`.

### D. Cross-Cutting & Consumer Updates
- **`TaxService`**: `partyForCustomer` queries customer by `customer.tenantId`.
- **`BillingService`**: `activeUsers` queries active users count by `tenantId`.
- **`AuthService`**: Session resolution and login audit logs updated to `user.tenantId`.
- **`JwtStrategy`**: Validates `user.tenantId` against payload.
- **`TokensService`**: Mints JWT payload using `user.tenantId`.
- **`Database Seeds (`run-seed.ts`)**: Sets `owner.tenantId` on seed user creation.

---

## 3. Verification & Test Results

### Build Verification
```bash
pnpm --filter api build
```
- **Exit Code**: 0 (Clean compilation, zero TypeScript errors)

### Unit & Integration Tests
```bash
pnpm --filter api test
```
- **Test Suites**: 70 passed, 70 total
- **Tests**: 794 passed, 794 total
- **Snapshots**: 0 total
- **Time**: 45.247 s

All tests in `CustomersService`, `CustomerStatementService`, `DocumentTemplatesService`, `InvitationsService`, `TokensService`, `RbacService`, and other modules pass with full assertion coverage.

---

## 4. Next Steps
Task 3 is complete. The system is ready to proceed to:
- **Task 4**: Database Migration for PostgreSQL Row-Level Security (RLS) policies on tenant-isolated tables.
