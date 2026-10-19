# UAE VAT 1/5 — Foundation: TRN, VAT status, treatments, branches, VAT settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Kerf the data every later UAE VAT feature stands on: TRN validation, customer/supplier VAT status and emirate, a VAT treatment on every tax code, branches with an emirate, per-tenant VAT settings (periods, start date), "UAE VAT mode", and UAE starter codes and rules.

**Architecture:** Pure rules (TRN, emirates, VAT status, treatments, period arithmetic, starter codes) live in one new shared module `packages/shared/src/tax/uae.ts`, used by zod schemas, the API and the web app. The API gets a `branches` table and a `vat_settings` table, one migration that also adds columns and backfills, a `BranchesService` in the organizations module and a `UaeVatService` in the tax module. Nothing changes for tenants not in UAE VAT mode.

**Tech Stack:** NestJS 11, TypeORM, Postgres 18 (RLS), zod 4, vitest (shared), jest (api), Next.js 16 + TanStack Query (web).

**Spec:** `docs/superpowers/specs/2026-10-19-uae-fta-vat-compliance-design.md` — sections 0 and 1. Plans 2–5 (documents & PDFs; ledger, reverse charge & imports; VAT201 & locking; FAF) follow and are written after this one lands.

## Global Constraints

- UAE VAT mode = `organization.country === 'AE'` **and** `isValidTrn(organization.taxId)` **and** `organization.baseCurrency === 'AED'`.
- TRN: exactly 15 digits after stripping spaces and dashes; stored digits-only. No leading-`100` check. No live lookup.
- Emirate codes in box order 1a–1g: `AUH, DXB, SHJ, AJM, UAQ, RAK, FUJ`.
- VAT status values: `REGISTERED`, `NOT_REGISTERED`, `OUTSIDE_UAE`.
- Treatments: `STANDARD, ZERO_RATED, EXEMPT, OUT_OF_SCOPE, REVERSE_CHARGE, BLOCKED, IMPORT_GOODS`. SALES may use STANDARD, ZERO_RATED, EXEMPT, OUT_OF_SCOPE, REVERSE_CHARGE. PURCHASE may use all seven (`BLOCKED` and `IMPORT_GOODS` are PURCHASE-only).
- Non-UAE tenants: existing behaviour must be byte-for-byte unchanged (existing tax tests stay green untouched).
- Permissions are added only in `packages/shared/src/rbac/permissions/credits.ts` (the directory that replaced `permissions.ts`).
- Schema changes go through one migration; FKs and CHECKs in the migration, not entities; new tables get the RLS `tenant_isolation_policy` exactly as in `1790200000000-JobCosting.ts`. `pnpm check:drift` must pass.
- After editing `packages/shared`, run `pnpm --filter @saas/shared build` before running API/web tests.
- Column naming: `customers` uses quoted camelCase columns (`"taxId"`), `suppliers`, `tax_codes` and new tables use snake_case. Match each table.

## Review Focus

1. **TRN typed with spaces or dashes** (`100-1234-5678-9012-3`, `100 123 456 789 012`) — accepted and stored as 15 digits; displayed back digits-only. Test in Task 1 and Task 2.
2. **An existing AE customer whose tax ID is legacy free text** (not a valid TRN) — the migration backfills it `NOT_REGISTERED` so nothing blocks; opening and saving it shows the TRN error inline so the user fixes or clears it. A loaded AE customer with a valid TRN must round-trip through the schema. Test in Task 2.
3. **Head-office emirate cannot be inferred** (region "Business Bay", city null) — emirate stays null, tenant still works, `UaeVatService.status()` lists "Head office has no emirate". Test in Task 5.
4. **Switching an AE tenant on with base currency USD** — refused with the explanatory message, nothing seeded. Test in Task 5.
5. **Seeding twice** (TRN saved, cleared, saved again; or a tenant who already created `SR`) — idempotent, no duplicate-key error, user-created codes untouched. Test in Task 5.

---

### Task 1: Shared UAE rules module

**Files:**
- Create: `packages/shared/src/tax/uae.ts`
- Create: `packages/shared/src/tax/uae.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './tax/uae';` after `./tax/tax`)

**Interfaces:**
- Produces:
  - `EMIRATES: readonly ['AUH','DXB','SHJ','AJM','UAQ','RAK','FUJ']`, `type Emirate`, `EMIRATE_NAMES: Record<Emirate, string>` (`'Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'`), `emirateFromText(text: string | null | undefined): Emirate | null` (matches code or name, case-insensitive, also `'abudhabi'`, `'rak'`, `'uaq'`).
  - `normaliseTrn(value: string | null | undefined): string | null` (strip `[\s-]`; null when empty), `isValidTrn(value: string | null | undefined): boolean`.
  - `VAT_STATUSES`, `type VatStatus`, `defaultVatStatus(country: string | null, taxId: string | null): VatStatus`.
  - `VAT_TREATMENTS`, `type VatTreatment`, `SALES_TREATMENTS: readonly VatTreatment[]`, `treatmentAllowed(kind: TaxKind, t: VatTreatment): boolean`, `treatmentIsReverseCharge(t: VatTreatment | null): boolean` (true for REVERSE_CHARGE and IMPORT_GOODS), `expectedUaeRate(kind: TaxKind, t: VatTreatment): number` (5 for STANDARD, BLOCKED, purchase REVERSE_CHARGE, IMPORT_GOODS; 0 otherwise).
  - `isUaeVatMode(org: { country: string | null; taxId: string | null; baseCurrency: string }): boolean`.
  - `UAE_STARTER_CODES: ReadonlyArray<{ code: string; name: string; rate: number; kind: TaxKind; treatment: VatTreatment }>` and `UAE_STARTER_RULES: ReadonlyArray<{ kind: TaxKind; country: string; code: string }>` with exactly the spec's values (SALES SR/ZR/EX/OS; PURCHASE SR/ZR/EX/BL/RC/IM; rules SALES AE→SR, SALES *→ZR, PURCHASE AE→SR, PURCHASE *→RC).
  - `type VatFrequency = 'MONTHLY' | 'QUARTERLY'`, `interface TaxPeriod { start: string; end: string }` (ISO `YYYY-MM-DD`, `end` inclusive), `periodContaining(anchor: string, freq: VatFrequency, date: string): TaxPeriod`, `isPeriodStart(anchor: string, freq: VatFrequency, date: string): boolean`, `nextPeriodStart(anchor: string, freq: VatFrequency, date: string): string` (start of the first period that begins strictly after `date`'s period start, i.e. the next full period).

- [ ] **Step 1: Write the failing tests** in `uae.test.ts`:

```ts
expect(normaliseTrn('100-1234-5678-9012-3')).toBe('100123456789012');
expect(normaliseTrn(' 100 123 456 789 012 ')).toBe('100123456789012');
expect(isValidTrn('10012345678901')).toBe(false);      // 14 digits
expect(isValidTrn('1001234567890123')).toBe(false);    // 16
expect(isValidTrn('10012345678901A')).toBe(false);
expect(isValidTrn('200123456789012')).toBe(true);      // no 100 prefix check
expect(defaultVatStatus('AE', '100123456789012')).toBe('REGISTERED');
expect(defaultVatStatus('AE', null)).toBe('NOT_REGISTERED');
expect(defaultVatStatus('AE', 'TRN pending')).toBe('NOT_REGISTERED');
expect(defaultVatStatus('GB', 'GB123')).toBe('OUTSIDE_UAE');
expect(defaultVatStatus(null, null)).toBe('NOT_REGISTERED');
expect(emirateFromText('Dubai')).toBe('DXB');
expect(emirateFromText('abu dhabi')).toBe('AUH');
expect(emirateFromText('RAK')).toBe('RAK');
expect(emirateFromText('Business Bay')).toBeNull();
expect(isUaeVatMode({ country: 'AE', taxId: '100123456789012', baseCurrency: 'AED' })).toBe(true);
expect(isUaeVatMode({ country: 'AE', taxId: '100123456789012', baseCurrency: 'USD' })).toBe(false);
expect(isUaeVatMode({ country: 'AE', taxId: null, baseCurrency: 'AED' })).toBe(false);
expect(treatmentAllowed('SALES', 'IMPORT_GOODS')).toBe(false);
expect(treatmentAllowed('SALES', 'BLOCKED')).toBe(false);
expect(treatmentAllowed('PURCHASE', 'IMPORT_GOODS')).toBe(true);
expect(expectedUaeRate('PURCHASE', 'REVERSE_CHARGE')).toBe(5);
expect(expectedUaeRate('SALES', 'REVERSE_CHARGE')).toBe(0);
// periods: quarterly anchored on 2026-02-01 → Feb–Apr, May–Jul, …
expect(periodContaining('2026-02-01', 'QUARTERLY', '2026-10-19')).toEqual({ start: '2026-08-01', end: '2026-10-31' });
expect(periodContaining('2026-02-01', 'QUARTERLY', '2026-01-15')).toEqual({ start: '2025-11-01', end: '2026-01-31' });
expect(periodContaining('2026-01-01', 'MONTHLY', '2028-02-29')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
expect(isPeriodStart('2026-02-01', 'QUARTERLY', '2026-05-01')).toBe(true);
expect(isPeriodStart('2026-02-01', 'QUARTERLY', '2026-06-01')).toBe(false);
expect(nextPeriodStart('2026-02-01', 'QUARTERLY', '2026-10-19')).toBe('2026-11-01');
expect(UAE_STARTER_CODES.filter((c) => c.kind === 'PURCHASE').map((c) => c.code)).toEqual(['SR', 'ZR', 'EX', 'BL', 'RC', 'IM']);
```

- [ ] **Step 2: Run** `pnpm --filter @saas/shared test -- uae` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `uae.ts`.** Period arithmetic works on `YYYY-MM-DD` strings via year/month integers only (no `Date` timezones). Periods tile backwards as well as forwards from the anchor. The anchor must be the 1st of a month; the functions throw `Error('A VAT period must start on the 1st of a month')` otherwise.
- [ ] **Step 4: Run** `pnpm --filter @saas/shared test -- uae` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tax): shared UAE VAT rules — TRN, emirates, VAT status, treatments, periods`.

### Task 2: Shared schemas, DTOs and the `tax:file` permission

**Files:**
- Modify: `packages/shared/src/schemas/customer.ts`, `packages/shared/src/schemas/supplier.ts`, `packages/shared/src/schemas/organization.ts`, `packages/shared/src/schemas/credits.ts` (`taxCodeSchema`), `packages/shared/src/types/api.ts` (`CustomerDto`), `packages/shared/src/purchasing/types.ts` (`SupplierDto`), `packages/shared/src/tax/tax.ts` (`TaxCodeDto`), `packages/shared/src/rbac/permissions/credits.ts`
- Create: `packages/shared/src/schemas/vat.ts` (+ export from `index.ts`), `packages/shared/src/schemas/vat.test.ts`
- Test: `packages/shared/src/schemas/customer.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Customer and supplier create/update schemas gain `emirate: Emirate | null` (nullish → null) and `vatStatus: VatStatus | null` (nullish → null; **no default** — the API decides, Task 6). A `superRefine` on both: when `country === 'AE'` and `taxId` is non-null, `taxId` must pass `isValidTrn`, error on path `['taxId']`: `'A UAE TRN is 15 digits'`; the transform then stores `normaliseTrn(taxId)`. When country is not AE, `emirate` is forced to null.
  - `updateOrganizationSchema`: same TRN rule when `country === 'AE'`.
  - `taxCodeSchema` gains `treatment: VatTreatment | null` (nullish → null) with a refine using `treatmentAllowed`.
  - `CustomerDto`/`SupplierDto` gain `emirate: Emirate | null; vatStatus: VatStatus`. `TaxCodeDto` gains `treatment: VatTreatment | null`.
  - `vat.ts`: `branchSchema` (`name` 1..120, `addressLine1/2` ≤200, `city` ≤120, `emirate: Emirate | null`, `isHeadOffice` default false, `invoicePrefix` null or `/^[A-Z0-9]{2,6}$/` upper-cased, `isActive` default true), `BranchDto` (those fields + `id`), `vatSettingsSchema` (`periodFrequency: VatFrequency`, `firstPeriodStart: 'YYYY-MM-DD'` on the 1st of a month, `registrationDate: 'YYYY-MM-DD'`, `vatStartDate: 'YYYY-MM-DD'`, `taxAgentName`, `taxAgencyName` ≤200 nullable, `tan`, `taan` ≤20 nullable; refine `isPeriodStart(firstPeriodStart, periodFrequency, vatStartDate)` with message `'The VAT start date must be the first day of a tax period'`; refine `vatStartDate >= firstPeriodStart`), `VatSettingsDto` (same fields), `UaeVatStatusDto { enabled: boolean; problems: string[]; settings: VatSettingsDto | null; suggestedVatStartDate: string | null }`.
  - Permission `TAX_PERMISSIONS.TAX_FILE = 'tax:file'`, description `'Mark a VAT return as filed, which locks its period, and reopen one filed by mistake'`, granted to `admin` only.

- [ ] **Step 1: Write failing tests.** `customer.spec.ts`: AE + `'100-1234-5678-9012-3'` parses to `taxId: '100123456789012'`; AE + `'12345'` fails on `taxId` with `'A UAE TRN is 15 digits'`; GB + `'GB123456789'` passes unchanged; GB + `emirate: 'DXB'` outputs `emirate: null`; a full `CustomerDto`-shaped object with `vatStatus: 'REGISTERED'` re-parses (round-trip). `vat.test.ts`: `vatSettingsSchema` rejects `vatStartDate: '2026-12-01'` for quarterly anchor `2026-02-01` and accepts `'2026-11-01'`; `branchSchema` upper-cases `invoicePrefix: 'dxb'` → `'DXB'` and rejects `'D'`; `taxCodeSchema` rejects `{ kind: 'SALES', treatment: 'IMPORT_GOODS' }`.
- [ ] **Step 2: Run** `pnpm --filter @saas/shared test` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the schema changes, DTO fields and permission.
- [ ] **Step 4: Run** `pnpm --filter @saas/shared test && pnpm --filter @saas/shared build` — Expected: PASS, build clean. Then `pnpm --filter api exec tsc --noEmit` and `pnpm --filter web exec tsc --noEmit` and fix every compile error the new required DTO fields cause by adding them at the mapping site (`customers.service.ts` `toDto`, the supplier DTO mapper in `purchasing.service.ts`, `toTaxCodeDto` in `tax.service.ts`) — the columns themselves arrive in Task 3, so commit Tasks 2 and 3 together if the compile cannot pass alone.
- [ ] **Step 5: Commit** `feat(tax): UAE fields in shared schemas and DTOs; tax:file permission`.

### Task 3: Migration and entities

**Files:**
- Create: `apps/api/src/database/migrations/1790400000000-UaeVatFoundation.ts`
- Create: `apps/api/src/modules/organizations/entities/branch.entity.ts`, `apps/api/src/modules/tax/entities/vat-settings.entity.ts`
- Modify: `apps/api/src/modules/customers/entities/customer.entity.ts`, `apps/api/src/modules/purchasing/entities/supplier.entity.ts`, `apps/api/src/modules/tax/entities/tax.entity.ts`, `apps/api/src/modules/audit/audit-subjects.ts`, the modules that register these entities (`organizations.module.ts`, `tax.module.ts`)
- Test: `apps/api/src/database/uae-vat-foundation-migration.spec.ts` (pattern: `uae-compliance-migration.spec.ts`)

**Interfaces:**
- Produces entities: `Branch` (`branches`: `id, tenant_id, name varchar(120), address_line1/2 varchar(200), city varchar(120), emirate varchar(3) null, is_head_office bool, invoice_prefix varchar(6) null, is_active bool, created_at, updated_at`; partial unique index `uq_branches_tenant_head_office` on `(tenant_id) WHERE is_head_office`; unique `(tenant_id, invoice_prefix)` where not null), `VatSettings` (`vat_settings`: `id, tenant_id unique, period_frequency varchar(10), first_period_start date, registration_date date, vat_start_date date, tax_agent_name, tax_agency_name varchar(200) null, tan, taan varchar(20) null, updated_at`). `Customer.emirate` (`"emirate"` varchar(3)), `Customer.vatStatus` (`"vatStatus"` varchar(16) not null default `'NOT_REGISTERED'`); `Supplier.emirate` (`emirate`), `Supplier.vatStatus` (`vat_status`); `TaxCode.treatment` (`treatment` varchar(20) null).
- CHECK constraints: emirate in the seven codes (all three tables); vat status in the three values; treatment in the seven values; `period_frequency IN ('MONTHLY','QUARTERLY')`.
- Backfill in `up()`:
  1. One head-office branch per organization: name `'Head office'`, address/city copied, `emirate` from a `CASE` over `lower(coalesce(region, city))` matching each emirate name and code (`'abu dhabi'|'auh'` → AUH, `'dubai'|'dxb'` → DXB, …), else null.
  2. Customers and suppliers: `OUTSIDE_UAE` where `upper(country) NOT IN ('AE')` and country is not null; `REGISTERED` where `upper(country) = 'AE'` and `regexp_replace(tax_id, '[\s-]', '', 'g') ~ '^[0-9]{15}$'` (and normalise the stored value to digits); otherwise `NOT_REGISTERED`.
  3. `tax_codes.treatment = 'ZERO_RATED'` where `code = 'ZERO' AND rate = 0`.
- `AUDIT_SUBJECTS` gains `branches: { subject: 'BRANCH', entity: Branch }` and `'finance/vat-settings': { subject: 'VAT_SETTINGS', entity: VatSettings }`.

- [ ] **Step 1: Write the failing migration spec** asserting (as `uae-compliance-migration.spec.ts` does) that `up()` issues: `CREATE TABLE "branches"`, `CREATE TABLE "vat_settings"`, RLS `ENABLE`/`FORCE`/`CREATE POLICY tenant_isolation_policy` for both tables, the head-office `INSERT … SELECT … FROM "organizations"`, and that `down()` drops both tables and the added columns.
- [ ] **Step 2: Run** `pnpm --filter api test -- uae-vat-foundation-migration` — Expected: FAIL.
- [ ] **Step 3: Write the migration and entities.**
- [ ] **Step 4: Verify.** `pnpm --filter api test -- uae-vat-foundation-migration` PASS; then against a local DB: `pnpm db:reset && pnpm migration:run && pnpm seed && pnpm check:drift` — Expected: drift check passes with no new statements; `select count(*) from branches where is_head_office` equals the organization count.
- [ ] **Step 5: Commit** `feat(tax): branches, VAT settings, VAT status, emirate and treatment columns`.

### Task 4: Branches API

**Files:**
- Create: `apps/api/src/modules/organizations/branches.service.ts`, `branches.controller.ts`, `branches.service.spec.ts`
- Modify: `apps/api/src/modules/organizations/organizations.module.ts` (register + export `BranchesService`), `apps/api/src/modules/auth/auth.service.ts` (call `ensureHeadOffice` in the signup transaction right after `provisionChartOfAccounts`)

**Interfaces:**
- Consumes: `Branch`, `branchSchema`, `BranchDto`, `isUaeVatMode`.
- Produces `BranchesService`:
  - `list(tenantId: string): Promise<BranchDto[]>` (head office first, then name)
  - `create(tenantId: string, input: BranchPayload): Promise<BranchDto>`
  - `update(tenantId: string, id: string, input: BranchPayload): Promise<BranchDto>`
  - `headOffice(tenantId: string, manager?: EntityManager): Promise<Branch>` (throws `NotFoundException` if missing)
  - `ensureHeadOffice(tenantId: string, manager: EntityManager): Promise<Branch>` (idempotent; copies org address)
  - `missingEmirates(tenantId: string): Promise<BranchDto[]>` — active branches with `emirate = null`.
- Routes: `GET /branches` (`ORG_READ`), `POST /branches`, `PUT /branches/:id` (`ORG_UPDATE`). No delete — deactivate with `isActive: false`.
- Rules (service, each a `BadRequestException` with this message):
  - Setting `isHeadOffice: true` on one branch unsets it on the previous head office in the same transaction.
  - `'The head office cannot be deactivated'`; `'There must be a head office'` (unsetting the only one).
  - In UAE VAT mode, `emirate` is required: `'Pick the emirate this branch is in'`.
  - Duplicate prefix → `ConflictException('Another branch already uses the prefix DXB')`.

- [ ] **Step 1: Write failing tests** in `branches.service.spec.ts` (repo mocks as in `tax.service.spec.ts`): making branch B head office unsets A; deactivating head office throws the message above; UAE-mode tenant creating a branch with `emirate: null` throws; non-UAE tenant may; `ensureHeadOffice` called twice saves once.
- [ ] **Step 2: Run** `pnpm --filter api test -- branches.service` — Expected: FAIL.
- [ ] **Step 3: Implement** service, controller, module wiring, signup call.
- [ ] **Step 4: Run** `pnpm --filter api test -- branches.service auth.service` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tax): branches API`.

### Task 5: VAT settings, UAE VAT mode and starter codes

**Files:**
- Create: `apps/api/src/modules/tax/uae-vat.service.ts`, `uae-vat.service.spec.ts`
- Modify: `apps/api/src/modules/tax/tax.controller.ts`, `tax.module.ts`, `tax.service.ts` (`assertCodeShape`, `toTaxCodeDto`), `apps/api/src/modules/organizations/organizations.service.ts` (`update`), `apps/api/src/modules/auth/auth.service.ts` (signup default currency)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces `UaeVatService`:
  - `isEnabled(tenantId: string): Promise<boolean>`
  - `status(tenantId: string): Promise<UaeVatStatusDto>` — `problems` lists, in order: `'Set the country to United Arab Emirates'`, `'Add your 15-digit TRN'`, `'Your base currency is <X>. UAE VAT returns are in AED, and the base currency cannot change once anything is posted.'`, `'<Branch name> has no emirate'` (one per branch), `'Set your VAT periods and start date'` (no settings row). `enabled` = `isUaeVatMode(org)`; `suggestedVatStartDate` = `nextPeriodStart(...)` of today when settings exist, else null.
  - `getSettings(tenantId: string): Promise<VatSettingsDto | null>`, `saveSettings(tenantId: string, input: VatSettingsPayload): Promise<VatSettingsDto>` — refuses (`BadRequestException`) unless `isUaeVatMode(org)`, with the first `problems` entry as the message. (`vatStartDate` becoming immutable once a return exists is added in plan 4, which introduces returns.)
  - `seedStarterCodes(tenantId: string, manager?: EntityManager): Promise<void>` — inserts `UAE_STARTER_CODES` with `ON CONFLICT DO NOTHING` on `uq_tax_codes_tenant_kind_code`, then `UAE_STARTER_RULES` resolving codes by `(kind, code)` with `ON CONFLICT DO NOTHING` on `uq_tax_rules_tenant_match`; sets `is_reverse_charge = treatmentIsReverseCharge(treatment)`.
- `OrganizationsService.update`: after applying the patch, if the result is `country AE` + valid TRN and `baseCurrency !== 'AED'`, throw `BadRequestException` with the currency message above (nothing saved). If the save moved the tenant into UAE VAT mode, call `seedStarterCodes` in the same transaction.
- Signup: `baseCurrency: input.baseCurrency ?? (input.country === 'AE' ? 'AED' : 'USD')`.
- `TaxService.assertCodeShape(tenantId, input)` becomes async and, in UAE VAT mode only: requires `treatment` (`'Choose a VAT treatment for this code'`); rejects a treatment not allowed for the kind; requires `rate === expectedUaeRate(kind, treatment)` (`'<treatment> codes are charged at <n>%'`); sets `isReverseCharge = treatmentIsReverseCharge(treatment)` for PURCHASE and `treatment === 'REVERSE_CHARGE'` for SALES. Outside UAE mode the existing check (`reverse charge must be 0%`) is unchanged.
- Routes (all under `/finance`): `GET vat/status` (`TAX_READ`), `GET vat-settings` (`TAX_READ`), `PUT vat-settings` (`TAX_MANAGE`).

- [ ] **Step 1: Write failing tests** in `uae-vat.service.spec.ts`: USD-base AE tenant with TRN → `status().enabled === false` and `problems[0]` starts `'Your base currency is USD.'`; head office with null emirate appears in `problems`; `seedStarterCodes` run twice issues the same `ON CONFLICT DO NOTHING` inserts and does not throw when `SR` already exists; `saveSettings` on a non-UAE tenant throws. In `organizations.service.spec.ts`: setting a valid TRN on an AE/USD org throws and does not call `save`; on an AE/AED org it saves and calls `seedStarterCodes`. In `tax.service.spec.ts`: UAE tenant creating PURCHASE `RC` at 5% with treatment `REVERSE_CHARGE` succeeds with `isReverseCharge: true`; SALES `STANDARD` at 20% fails with `'STANDARD codes are charged at 5%'`; the existing EU tests are untouched and still pass.
- [ ] **Step 2: Run** `pnpm --filter api test -- uae-vat organizations.service tax.service` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `pnpm --filter api test` — Expected: whole API suite green.
- [ ] **Step 5: Commit** `feat(tax): UAE VAT mode, VAT settings and starter codes`.

### Task 6: Customer and supplier VAT status on the API

**Files:**
- Modify: `apps/api/src/modules/customers/customers.service.ts`, `apps/api/src/modules/purchasing/purchasing.service.ts` (`createSupplier`, `updateSupplier`, DTO mapper)
- Modify: `packages/shared/src/tax/uae.ts` (add `resolveVatStatus`), `packages/shared/src/tax/uae.test.ts`
- Test: `customers.service.spec.ts`, `purchasing.service.spec.ts`

**Interfaces:**
- Produces in shared: `resolveVatStatus(current: { country: string | null; taxId: string | null; vatStatus: VatStatus | null } | null, patch: { country?: string | null; taxId?: string | null; vatStatus?: VatStatus | null }): VatStatus` — an explicit `patch.vatStatus` wins; otherwise, on create or when `country` or `taxId` changes, `defaultVatStatus(next country, next taxId)`; otherwise `current.vatStatus`.
- Both services call it on create and update and store the result.

- [ ] **Step 1: Write failing tests.** Shared: create with AE + valid TRN → `REGISTERED`; update of a `REGISTERED` customer that only changes `phone` keeps `REGISTERED`; explicit `vatStatus: 'REGISTERED'` with no TRN is kept (the user override that later blocks issuing); changing country to `GB` → `OUTSIDE_UAE`. API: `customers.service` create with no `vatStatus` stores `REGISTERED` for AE + TRN; same for `createSupplier`.
- [ ] **Step 2: Run** `pnpm --filter @saas/shared test -- uae && pnpm --filter api test -- customers.service purchasing.service` — Expected: FAIL.
- [ ] **Step 3: Implement**, rebuild shared.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tax): customer and supplier VAT status`.

### Task 7: Web — customer and supplier forms, tax codes

**Files:**
- Modify: `apps/web/src/components/customers/customer-form-dialog.tsx`, `apps/web/src/components/purchasing/supplier-form-dialog.tsx`, `apps/web/src/components/finance/tax/tax-view.tsx`
- Test: `apps/web/src/components/customers/customer-form-dialog.test.tsx` (create; follow the testing setup used by `quote-components.test.tsx`)

**Interfaces:**
- Consumes: shared schemas/DTOs (Task 2), `EMIRATE_NAMES`, `defaultVatStatus`, `VAT_TREATMENTS`.
- Behaviour:
  - When country is `AE`: show an **Emirate** select (seven options, `EMIRATE_NAMES`) and label the tax field **TRN** with helper text `'15 digits, as on the FTA certificate'`. Otherwise hide emirate and keep the label **Tax ID**.
  - **VAT status** select (`Registered in the UAE`, `Not registered`, `Outside the UAE`). Whenever country or tax ID changes and the user has not touched the select in this dialog session, set it to `defaultVatStatus(country, taxId)`. When status is `REGISTERED` and the TRN is empty, show an inline warning: `'Invoices to this customer cannot be issued until a TRN is added.'` (supplier: `'VAT on this supplier's bills cannot be recovered until a TRN is added.'`).
  - Tax view: a **Treatment** column, and a Treatment select in the code dialog listing only `treatmentAllowed` values for the chosen kind; required when the org is in UAE VAT mode (from `GET /finance/vat/status`).

- [ ] **Step 1: Write failing test:** render the customer dialog, pick country `United Arab Emirates`, type `100 123 456 789 012` → VAT status shows `Registered in the UAE` and the Emirate select is visible; switch country to `United Kingdom` → Emirate hidden, status `Outside the UAE`.
- [ ] **Step 2: Run** `pnpm --filter web test -- customer-form-dialog` — Expected: FAIL.
- [ ] **Step 3: Implement** (API client: add `api.tax.vatStatus()` in `apps/web/src/lib/api/endpoints/credits.ts` next to `api.tax.codes`, and `useUaeVatStatus()` in `apps/web/src/hooks/use-credits.ts`).
- [ ] **Step 4: Run** `pnpm --filter web test -- customer-form-dialog && pnpm --filter web exec tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tax): VAT status, emirate and TRN on customer and supplier forms`.

### Task 8: Web — Branches and VAT settings pages

**Files:**
- Create: `apps/web/src/app/(app)/settings/branches/page.tsx`, `apps/web/src/components/settings/branches-view.tsx`, `apps/web/src/components/finance/tax/vat-settings-card.tsx`
- Modify: `apps/web/src/lib/nav.ts` (a **Branches** entry after Company, `ORG_READ`), `apps/web/src/components/finance/tax/tax-view.tsx` (render `VatSettingsCard` at the top when org country is AE), `apps/web/src/lib/api/endpoints/platform.ts` or the endpoint file holding `organization` (add `api.branches.list/create/update`), `apps/web/src/hooks/use-organization.ts` (`useBranches`, `useSaveBranch`), `apps/web/src/lib/api/endpoints/credits.ts` + `use-credits.ts` (`vatSettings`, `saveVatSettings`)
- Test: `apps/web/src/components/finance/tax/vat-settings-card.test.tsx`

**Interfaces:**
- `BranchesView`: table (name, emirate, prefix, head office, active) and an add/edit dialog driven by `branchSchema`. Hidden behind nothing — single-office tenants see one row and never need it (spec anti-goal 4: no branch picker appears anywhere for them).
- `VatSettingsCard`: when `status.enabled === false`, lists `status.problems` with links (Company settings, Branches). When enabled: the settings form (`vatSettingsSchema`); `vatStartDate` prefilled with `status.suggestedVatStartDate`; copy under it: `'Kerf prepares returns from this period on. Earlier periods are treated as filed outside Kerf.'`

- [ ] **Step 1: Write failing test:** `VatSettingsCard` with a status `{ enabled: false, problems: ['Add your 15-digit TRN'] }` renders that problem and no form; with `enabled: true, settings: null, suggestedVatStartDate: '2026-11-01'` renders the form with start date `2026-11-01`.
- [ ] **Step 2: Run** `pnpm --filter web test -- vat-settings-card` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test -- vat-settings-card && pnpm --filter web exec tsc --noEmit` — Expected: PASS. Then run the app (`pnpm dev`), sign in as the seeded owner, set country AE / currency AED tenant TRN, set VAT settings, and confirm the starter codes appear on Finance → Tax.
- [ ] **Step 5: Commit** `feat(tax): branches and VAT settings screens`.

### Task 9: Flags and wrap-up

**Files:**
- Modify: `docs/FLAGS.md` (under `## Tax`)

- [ ] **Step 1: Add FLAGS entries:** "UAE tenants on a non-AED base currency cannot enter UAE VAT mode — open"; "Domestic reverse charge (gold, diamonds, hydrocarbons, phones/computers/tablets to resellers) not modelled — open"; "Advance payments before an invoice create no tax point — open"; "Records retention: documents must be kept 5 years (15 for real estate); any future deletion or archival must respect it".
- [ ] **Step 2: Run** `pnpm --filter @saas/shared test && pnpm --filter api test && pnpm --filter web test && pnpm check:drift` — Expected: all green.
- [ ] **Step 3: Commit** `docs(tax): UAE VAT flags`.
