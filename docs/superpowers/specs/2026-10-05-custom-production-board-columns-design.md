# Design Spec: User-Defined Custom Production Board Columns

**Date:** 2026-10-05  
**Topic:** User-Defined Custom Columns on Production Kanban Board  
**Status:** Approved by User  

---

## 1. Overview & Goals

The Relay CRM shop floor Production board (`/production`) currently features a 4-column Kanban board (`Planned`, `Released`, `In progress`, `Complete`). While this maps to standard work order statuses, manufacturing workflows frequently need custom stages (e.g., "Awaiting Material", "Quality Inspection (QC)", "Surface Treatment / Coating", "Packaging").

This feature enables operators and shop floor managers to:
1. Define, edit, recolor, reorder, and delete custom columns directly on the Kanban board via a `+ Add Column` UI.
2. Share the customized board layout across the entire company/organization.
3. Map every custom column to an underlying core status (`PLANNED`, `RELEASED`, `IN_PROGRESS`, `COMPLETE`), ensuring 100% financial inventory WIP, time tracking, cost variance reports, and ledger postings remain accurate.

---

## 2. Architecture & Data Model

### 2.1 Backend Table: `production_board_settings`
A single row per tenant stores the organization's customized Kanban layout:
* `id` (`uuid`, primary key)
* `tenant_id` (`uuid`, unique index, scoped to current organization)
* `columns` (`jsonb`, array of `ProductionBoardColumn` objects)
* `createdAt` / `updatedAt` (`timestamptz`)

### 2.2 Column Schema (`ProductionBoardColumn`)
```typescript
export interface ProductionBoardColumn {
  id: string;              // Unique identifier (e.g. "col_planned", "col_qc_inspection")
  name: string;            // Display title (e.g. "Quality Inspection (QC)")
  status: WorkOrderStatus; // Mapped core status: 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETE'
  color: string;           // Theme tag: 'slate' | 'blue' | 'amber' | 'purple' | 'emerald' | 'rose' | 'cyan'
  sequence: number;        // Display column index (0, 1, 2, ...)
  isDefault?: boolean;     // True for canonical fallback columns
}
```

### 2.3 Default Configuration Fallback
If an organization has not configured custom columns, the backend and frontend automatically fallback to the 4 canonical columns:
1. **Planned**: `id: 'planned'`, `name: 'Planned'`, `status: 'PLANNED'`, `color: 'slate'`, `sequence: 0`, `isDefault: true`
2. **Released**: `id: 'released'`, `name: 'Released'`, `status: 'RELEASED'`, `color: 'blue'`, `sequence: 1`, `isDefault: true`
3. **In progress**: `id: 'in_progress'`, `name: 'In progress'`, `status: 'IN_PROGRESS'`, `color: 'amber'`, `sequence: 2`, `isDefault: true`
4. **Complete**: `id: 'complete'`, `name: 'Complete'`, `status: 'COMPLETE'`, `color: 'emerald'`, `sequence: 3`, `isDefault: true`

### 2.4 Work Order Association & Zero Schema Drift
* Card placement is tracked in the existing JSONB column `WorkOrder.parameters.columnId`.
* **Automatic Fallback:** If a work order's `columnId` is unset or points to a deleted column, it resolves into the designated default column for its `workOrder.status`.
* **Accounting & Reporting Integrity:** All WIP inventory valuation, actual costing, and financial ledger postings continue to rely on the core `workOrder.status`.

---

## 3. API Endpoints & Business Logic

### 3.1 `GET /production/board/columns`
* **Permission:** `WORK_ORDER_READ`
* **Response:** `ProductionBoardColumn[]`
* **Logic:** Returns the tenant's saved `columns` from `production_board_settings`. If no record exists, returns the default 4 columns.

### 3.2 `PUT /production/board/columns`
* **Permission:** `WORK_ORDER_UPDATE`
* **Request Body:** `{ columns: ProductionBoardColumn[] }` (validated with Zod in `@saas/shared`)
* **Validation Rules:**
  * Must contain at least one column for each core status (`PLANNED`, `RELEASED`, `IN_PROGRESS`, `COMPLETE`).
  * For each core status, at least one column must be marked `isDefault: true`.
  * Column IDs must be unique strings (1-60 chars).
  * Column names must be non-empty strings (1-60 chars).
  * Allowed color values: `slate`, `blue`, `amber`, `purple`, `emerald`, `rose`, `cyan`.
* **Logic:** Atomically upserts the settings row for `tenant_id`.

### 3.3 `PATCH /work-orders/:id/column`
* **Permission:** `WORK_ORDER_UPDATE`
* **Request Body:** `{ columnId: string }`
* **Logic:**
  * Validates that `columnId` belongs to the tenant's current board columns.
  * If the destination column maps to a different core status than the work order's current status:
    * Releasing a `PLANNED` job to `RELEASED` or `IN_PROGRESS` performs standard release validation.
    * Completing a job requires `api.workOrders.complete()` to record good quantities and assert that no operations are running.
  * Sets `workOrder.parameters = { ...workOrder.parameters, columnId }`.
  * Updates `workOrder.status = destinationColumn.status`.
  * Saves and returns updated `WorkOrderDto`.

---

## 4. Frontend UI & User Experience

### 4.1 Kanban Header & `+ Add Column`
* In `apps/web/src/components/production/production-board.tsx` and `production-kanban.tsx`:
  * Fetch columns using `useQuery(['production-board-columns'])`.
  * Top bar features an `+ Add Column` button when user has `WORK_ORDER_UPDATE` permission.
  * Opens modal with:
    * Column Name (`Input`)
    * Core Status (`Select`: Planned, Released, In progress, Complete) with helper text explaining inventory/costing mapping
    * Color Picker (`Select` or color chips: Slate, Blue, Amber, Purple, Emerald, Rose, Cyan)
  * Submits via `useMutation` calling `PUT /production/board/columns`.

### 4.2 Column Header Actions Menu
Each column header includes:
* Color accent pill and column title.
* Work order count badge.
* Kebab menu (`...`) with options:
  * **Edit Column:** Rename title and change color.
  * **Move Left / Move Right:** Reorder column sequence.
  * **Delete Column:** Deletes column (disabled if it is the only default column for that core status). Active cards automatically fall back to the default column for that status.

### 4.3 Drag-and-Drop Card Distribution
* Cards are placed in column `C` if `wo.parameters?.columnId === C.id` OR (`!wo.parameters?.columnId && C.isDefault && C.status === wo.status`).
* Dropping card onto column calls `api.workOrders.updateColumn(id, targetColumnId)`.
* Dropping into a `COMPLETE` column opens the completion modal with quantity input and clock validation.

### 4.4 Slide-Over Detail Drawer
* `work-order-drawer.tsx` displays the active column badge in the drawer header.
* Operators can switch the column directly via a dropdown selector in the drawer.

---

## 5. Testing & Verification

1. **Unit Tests (Shared Package):**
   * Zod validation tests for `updateBoardColumnsSchema` (rejecting empty names, missing default status columns, invalid colors).
2. **Backend Unit Tests (API):**
   * `production.service.spec.ts`: test `getBoardColumns`, `updateBoardColumns`, `updateWorkOrderColumn`.
   * Test multi-tenant isolation and default column fallbacks.
3. **Frontend Unit Tests (Web):**
   * `production-board.spec.tsx` and `production-kanban.spec.tsx`:
     * Render dynamic custom columns.
     * Open and submit `+ Add Column` dialog.
     * Move left/right and edit column actions.
     * Card placement in custom column.
4. **CI Verification:**
   * Build `@saas/shared`, `api`, `web`.
   * Run all test suites across the monorepo.
