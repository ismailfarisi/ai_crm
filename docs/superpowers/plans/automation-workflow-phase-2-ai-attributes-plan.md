# Phase 2 Implementation Plan: Attio-Style Dynamic AI Attributes in Object Studio

This plan guides the implementation of **Phase 2: Dynamic AI Attributes in Object Studio**, extending Relay CRM's Custom Objects engine with automated, event-driven LLM computations.

---

## Proposed Tasks Breakdown

### Task 1: Shared Schemas & DTO Contracts for AI Attributes
- **Files to modify**:
  - `packages/shared/src/schemas/custom-object.ts`
  - `packages/shared/src/automations/types.ts`
  - `packages/shared/src/schemas/custom-object.spec.ts`
- **Scope**:
  - Define `AiComputeConfig` interface (`promptTemplate`, `model`, `systemPrompt`, `dependentAttributes`, `outputType`, `temperature`).
  - Extend `CustomAttributeDefinitionDto`, `CreateCustomAttributeDto`, `UpdateCustomAttributeDto` with `isAiComputed: boolean` and `aiComputeConfig?: AiComputeConfig | null`.
  - Add validation using Zod for `aiComputeConfig` (ensuring `promptTemplate` is non-empty and `dependentAttributes` is an array of strings).
  - Add `metadata?: { isAiEnrichment?: boolean }` to `CrmDomainEvent`.

---

### Task 2: TypeORM Entity Extension & Migration
- **Files to modify / create**:
  - `apps/api/src/modules/custom-objects/entities/custom-attribute-definition.entity.ts`
  - `apps/api/src/database/migrations/<timestamp>-add-ai-attributes-to-custom-definitions.ts`
  - `apps/api/src/modules/custom-objects/entities/custom-objects.entities.spec.ts`
- **Scope**:
  - Add `@Column({ name: 'is_ai_computed', type: 'boolean', default: false }) isAiComputed: boolean;`.
  - Add `@Column({ name: 'ai_compute_config', type: 'jsonb', nullable: true }) aiComputeConfig: AiComputeConfig | null;`.
  - Create TypeORM migration with PostgreSQL commands `ADD COLUMN is_ai_computed boolean NOT NULL DEFAULT false`, `ADD COLUMN ai_compute_config jsonb`.
  - Run `migration:run` and verify `check:drift` passes with zero schema drift.

---

### Task 3: Background AI Attribute Enrichment Service & Loop Shielding
- **Files to create / modify**:
  - `apps/api/src/modules/custom-objects/services/ai-attribute-enrichment.service.ts` (create)
  - `apps/api/src/modules/custom-objects/services/ai-attribute-enrichment.service.spec.ts` (create)
  - `apps/api/src/modules/custom-objects/services/custom-records.service.ts`
  - `apps/api/src/modules/custom-objects/custom-objects.module.ts`
- **Scope**:
  - Create `AiAttributeEnrichmentService` implementing `OnModuleInit` and `OnModuleDestroy`.
  - Subscribe to `CrmEventBusService`.
  - In `handleDomainEvent(event: CrmDomainEvent)`:
    - Skip if `event.metadata?.isAiEnrichment` is true (loop shield).
    - Skip if `event.entityType !== 'custom_object'`.
    - Fetch attribute definitions for object slug with `isAiComputed = true`.
    - For each computed attribute: check if `event.snapshot.changedFields` intersects with `aiComputeConfig.dependentAttributes`.
    - If match: interpolate prompt template with `event.snapshot.after` values.
    - Reserve token budget with `RedisBudgetGuardService`.
    - Call LLM model provider (`AiCompletionService` / Anthropic / OpenAI).
    - Save updated value into `record.values[attr.slug]` using `updateComputedAttribute` passing `metadata: { isAiEnrichment: true }`.

---

### Task 4: Object Studio UI — AI Attribute Configuration Drawer
- **Files to create / modify**:
  - `apps/web/src/components/custom-objects/attribute-drawer.tsx`
  - `apps/web/src/components/custom-objects/ai-prompt-editor.tsx` (create)
  - `apps/web/src/components/custom-objects/ai-attribute-test-modal.tsx` (create)
- **Scope**:
  - Add "AI Computed Property" switch to the attribute definition modal.
  - When enabled, display:
    - Prompt template textarea with dynamic variable insertion chips (`{{ deal_value }}`, `{{ company_name }}`).
    - Dependent attributes multi-select checkboxes.
    - "Test on Sample Record" preview drawer allowing administrators to test the LLM prompt against existing records and preview the computed output.

---

### Task 5: End-to-End Integration Verification & CI Passing
- **Scope**:
  - Run `pnpm build` across shared, api, and web.
  - Run `pnpm test` ensuring all unit and integration tests pass.
  - Run `pnpm check:drift` confirming zero database schema drift.
  - Push branch and verify all GitHub Actions CI checks green.
