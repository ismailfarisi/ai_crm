# Spreadsheet-Like Views with Inline Editing & Kanban Pipelines — Design Specification

- **Date:** 2026-10-06
- **Status:** Approved
- **Author:** Relay CRM Architecture Team
- **Target Implementation:** `apps/web/src/components/views/`, `apps/api/src/modules/saved-views/`, `packages/shared/src/views/`

---

## 1. Executive Summary & Goals

Relay CRM's existing list interfaces rely on standard, read-only data tables where any update requires opening a modal dialog or navigating to a separate record detail page. In contrast, modern sales platforms like **Attio** and **Airtable** provide fluid spreadsheet-style inline editing and visual drag-and-drop Kanban pipelines.

This specification defines the architecture for a reusable **Data View Engine** in Relay CRM featuring:
1. **Spreadsheet-Grade Inline Cell Editing:** Direct in-place editing of text, numbers, dates, statuses, and assigned owners with instant optimistic updates and automatic error rollbacks.
2. **Interactive Drag-and-Drop Kanban Pipelines:** Visual progression of deals and leads powered by native HTML5 Drag and Drop (harmonized with Relay's existing production board), displaying column metrics (card counts, total revenue) with enforced commercial approval signals.
3. **Saved Views & Compound Filters:** Persistent view presets (tabs) stored in PostgreSQL with shareable URL parameters, compound `AND`/`OR` filter builders, and self-service column customization.
4. **Immediate Rollout to Quotes & Contacts:** Pre-configured view presets for sales quotes and customer leads, architected to plug cleanly into Customers, Orders, and Custom Objects with zero code duplication.

---

## 2. Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│ UI LAYER (apps/web)                                                    │
├────────────────────────────────────────────────────────────────────────┤
│ <DataViewContainer>                                                    │
│  ├── View Switcher Toolbar (Table vs. Kanban, Filter Popover, Columns) │
│  ├── Saved View Tabs ([All Quotes] [Active Pipeline] [+ New View])     │
│  │                                                                     │
│  ├── Layout 1: <InlineEditableTable>                                   │
│  │    └── Extends TanStack Table with inline cell editors              │
│  │    └── Optimistic TanStack Query mutations (0ms perceived latency)  │
│  │                                                                     │
│  └── Layout 2: <KanbanBoard>                                           │
│       └── Zero-dependency native HTML5 drag-and-drop (React 19 native) │
│       └── Dynamic column metrics (e.g. stage revenue sum)              │
│       └── Commercial approval guard & signal confirmation modals       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Syncs state & presets
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ BACKEND SERVICES & PERSISTENCE (apps/api)                              │
├────────────────────────────────────────────────────────────────────────┤
│ • SavedViewsModule (/api/v1/saved-views)                               │
│ • Database Table: `saved_views` (tenant_id, user_id, config: jsonb)    │
│ • Existing Entity Endpoints: PATCH /quotes/:id, PATCH /contacts/:id    │
│ • Workflow Signals: POST /quotes/:id/signal (APPROVE / REJECT)         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema (`saved_views`)

To persist named views across sessions and enable team sharing, a lightweight `saved_views` table is introduced:

```sql
CREATE TYPE view_layout_type AS ENUM ('table', 'kanban');

CREATE TABLE saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(40) NOT NULL, -- 'quotes', 'contacts', 'customers', or custom object slug
    name VARCHAR(80) NOT NULL,
    view_type view_layout_type NOT NULL DEFAULT 'table',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_shared BOOLEAN NOT NULL DEFAULT FALSE, -- True = visible to entire organization
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_saved_views_tenant_entity ON saved_views (tenant_id, entity_type, is_shared);
CREATE INDEX idx_saved_views_user ON saved_views (tenant_id, user_id);
```

### JSONB Configuration Schema (`config`)
```json
{
  "columns": [
    { "key": "quoteNumber", "visible": true, "width": 140 },
    { "key": "title", "visible": true, "width": 260 },
    { "key": "customerName", "visible": true, "width": 200 },
    { "key": "status", "visible": true, "width": 160 },
    { "key": "totalAmount", "visible": true, "width": 140 },
    { "key": "createdAt", "visible": false }
  ],
  "filters": [
    { "field": "status", "operator": "in", "value": ["DRAFT", "AWAITING_APPROVAL"] },
    { "field": "totalAmount", "operator": "gte", "value": 10000 }
  ],
  "sort": { "field": "totalAmount", "direction": "desc" },
  "kanban": {
    "groupField": "status",
    "collapsedColumns": ["REJECTED"]
  }
}
```

---

## 4. REST API Endpoints (`/api/v1/saved-views`)

* `GET    /saved-views?entityType=:type` — Lists all views accessible to the user (personal views + organization shared views).
* `POST   /saved-views` — Creates a new saved view preset.
* `PATCH  /saved-views/:id` — Updates view configuration, layout type, columns, filters, or sharing status.
* `DELETE /saved-views/:id` — Deletes a saved view (restricted to the view owner or an organization Admin).

---

## 5. Inline Editable Table Architecture

The inline editable table extends Relay’s existing TanStack Table (`@tanstack/react-table`):

### 5.1. Cell Editors by Field Type
1. **`BadgeSelectCell`:** Clicking the status badge opens a compact floating popover. Choosing an option updates the record immediately without opening a modal.
2. **`TextCell` & `NumberCell`:** Clicking or pressing `Enter` transitions the cell into an active input. Pressing `Enter` or blurring commits; `Escape` cancels.
3. **`CurrencyCell`:** Renders formatted currency (`$ 45,000.00`). Editing strips formatting during input and reapplies upon commit.
4. **`DateCell`:** Displays relative or formatted dates (`Oct 14, 2026`). Clicking opens a compact datepicker popover.
5. **`OwnerCell`:** Displays avatar + name. Clicking shows a search-filtered dropdown of assignable team members.

### 5.2. Optimistic Mutation Engine (TanStack Query)
1. **Instant UI Update:** When a cell commits, `useMutation.onMutate` immediately snapshots the current query cache and writes the new value into local state (**0ms perceived latency**).
2. **Background Sync:** Fires `PATCH /api/v1/:entity/:id` in the background.
3. **Error Rollback:** If the API rejects the update (e.g. 403 Forbidden, 422 Validation Error):
   * The cell displays a brief red outline/shake animation.
   * TanStack Query restores the previous cache snapshot.
   * A toast notification displays the error reason.

### 5.3. Keyboard Navigation
* **`Arrow Keys` (`↑ ↓ ← →`):** Navigate cell focus across rows and columns.
* **`Enter`:** Enter edit mode for text/numeric fields; commit and advance to the cell below.
* **`Tab` / `Shift+Tab`:** Move forward or backward across editable cells in the current row.
* **`Escape`:** Discard changes and exit edit mode.

---

## 6. Kanban Board Engine (Native HTML5 Drag and Drop)

Harmonized with Relay's existing `ProductionKanban` architecture (`apps/web/src/components/production/production-kanban.tsx`), the general-purpose Kanban engine uses **native HTML5 Drag and Drop** (`draggable={true}`, `onDragStart`, `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop`). This guarantees:
- **Zero External Dependencies:** Eliminates third-party DnD library bloat and avoids React 19 / Next.js 16 SSR hydration conflicts.
- **Consistent Design System:** Shares the exact visual tokens, card spacing, drop target highlighting (`dragOverColId`), and color schemes established in the production board.

### 6.1. Anatomy & Column Aggregations
* **Columns:** Group records by an enum status field (`status`).
* **Column Metrics:** Header calculates:
  * Count of cards in the stage: `AWAITING APPROVAL (3)`
  * Sum of numeric values (e.g. Total Quote Revenue: `$182,400`)
* **Column Collapsing:** Users can collapse secondary stages (e.g., `REJECTED`, `CHURNED`) to maximize screen width.

### 6.2. Workflow Validation & Confirmation Signals
Commercial stage transitions enforce business rules during drag-and-drop:
* **Standard Progression:** Moving `DRAFT` ➔ `AWAITING_APPROVAL` updates status optimistically.
* **Approval Signal:** Moving a quote into `APPROVED` requires `quote:approve` permission and triggers an approval modal:
  > *"Approve Quote QT-2026-074 for $68,000? This will lock pricing and allow production work orders to be generated."*
  On confirmation, dispatches `POST /api/v1/quotes/:id/signal` (`action: 'APPROVE'`).
* **Rejection Handling:** Moving to `REJECTED` prompts for a rejection reason before finalizing.
* **Illegal Reversal:** Moving an `APPROVED` quote back to `DRAFT` is blocked. The card snaps back to its origin column with an informative warning.

---

## 7. View Toolbar, Compound Filters & Column Chooser

### 7.1. View Toolbar Controls
* **Layout Switcher:** Toggle buttons between `[ ⊞ Table ]` and `[ ▥ Kanban ]`.
* **Search Input:** Debounced text search filtering across primary text fields.
* **Filter Popover (`[Filter (N) ▼]`):**
  * Multi-rule compound filtering: `[ Field ] [ Operator ] [ Value ]`
  * Operators: `equals`, `not equals`, `contains`, `greater than`, `less than`, `is any of`, `is empty`.
* **Column Chooser (`[Columns (N/Total) ▼]`):** (Table mode only)
  * Check/uncheck fields to toggle visibility.
  * Drag-to-reorder horizontal column order.
  * Drag column edges in header to resize widths.
* **"Save View" Status:** Lights up when the active view configuration deviates from the saved preset.

---

## 8. Entity Rollout: Quotes & Contacts

### 8.1. Quotes Rollout (`/quotes`)
* **Pre-Seeded Views:**
  1. `All Quotes` — Table view, sorted by `createdAt:desc`.
  2. `Active Pipeline` — Kanban view, displaying `DRAFT` and `AWAITING_APPROVAL`.
  3. `High-Value Deals` — Table view, filtered by `totalAmount >= 25000`.
  4. `Confirmed Quotes` — Table view, filtered by `status = APPROVED`.
* **Kanban Columns:** `Quotation (Draft)` ➔ `Awaiting Approval` ➔ `Quotation Confirmed` ➔ `Rejected` (Collapsible).

### 8.2. Contacts Rollout (`/contacts`)
* **Pre-Seeded Views:**
  1. `All Contacts` — Table view.
  2. `Lead Pipeline` — Kanban view grouped by `status`.
  3. `My Contacts` — Filtered by `ownerId = currentUser.id`.
  4. `Customers` — Filtered by `status = customer`.
* **Kanban Columns:** `Lead` ➔ `Qualified` ➔ `Customer` ➔ `Churned / Archived`.

---

## 9. Security, RBAC & Scoping

1. **Permission Enforcement:**
   * Editing cells adheres to existing permissions (`quote:update`, `contact:update`). If a user lacks the permission, cell editing is disabled.
   * Quote approvals require `quote:approve`.
2. **Saved View Authorization:**
   * Private views are only visible to their creator.
   * Shared views (`is_shared: true`) are readable by all tenant members, but editable only by the author or tenant Admins.
   * `tenant_id` is strictly enforced on all queries under Postgres RLS.

---

## 10. Verification & Testing Strategy

1. **Unit Tests:**
   * Cell editor components: assert commit, cancel on `Escape`, and arrow key traversal.
   * Optimistic mutation hook: assert immediate cache update and rollback behavior on mock network 500/403.
   * Filter evaluator: verify compound `AND`/`OR` filtering across numbers, dates, and enums.
2. **Integration & E2E Tests:**
   * Quotes Kanban: Drag quote card from `AWAITING_APPROVAL` to `APPROVED`, confirm approval modal opens, confirm signal dispatches, and card persists in `APPROVED`.
   * Contacts Spreadsheet: Edit company name inline, press `Enter`, reload page, and confirm persisted update.
   * Saved Views: Create a view with custom filters and hidden columns, save as shared, switch users, and verify shared view renders identically.
