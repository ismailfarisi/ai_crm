# Reusable Data Table Component Specification

## Overview
This specification details the design and implementation of a highly reusable, feature-rich `<DataTable />` component for the SaaS CRM platform (`apps/web`). The component wraps `@tanstack/react-table` to provide enterprise table capabilities (search, sort, filter, pagination, row selection, column toggling, density controls, export) while seamlessly converting table rows into responsive grid cards for mobile screens or on-demand card view.

## Core Requirements & Features

1. **Hybrid View Modes**:
   - **Auto Mode (`'auto'`)**: Automatically converts table display to Card Grid view on mobile viewports (`< 768px`).
   - **Manual Mode Toggle**: Provides a toolbar icon button allowing users to switch between Table View and Card Grid View on any screen size.
   - **Explicit View Control**: Supports default view mode configuration via props.

2. **Full Table Capabilities**:
   - **Global Search & Debounced Filter**: Instant search across text fields with debounced input.
   - **Sorting**: Single and multi-column header click sorting with visual directional arrows.
   - **Pagination**: Customizable page size options (10, 25, 50, 100), current item summary ("Showing 1 to 10 of 45 results"), and page navigation controls.
   - **Row Selection & Bulk Actions**: Checkboxes for selecting individual or all rows, triggering custom bulk action toolbars (e.g. bulk delete, bulk export).
   - **Column Visibility Toggles**: Dropdown menu to dynamically show or hide table columns.
   - **Density Control**: Toggle between comfortable and compact row padding.
   - **Export Capabilities**: Export currently filtered dataset to CSV or JSON formats.
   - **Loading & Empty States**: Integrated skeleton shimmer loading states and customizable empty state titles/descriptions/icons.

3. **Card Transformation**:
   - **Default Key-Value Card Layout**: Automatically renders records as cards using column headers as labels and cell content as values.
   - **Custom Card Renderer (`renderCard`)**: Supports custom render callbacks (`(item: TData) => React.ReactNode`) for rich custom card layouts.

---

## Component API Interface

```tsx
import { ColumnDef } from '@tanstack/react-table';
import React from 'react';

export type ViewMode = 'table' | 'card' | 'auto';

export interface DataTableProps<TData, TValue> {
  /** Column definitions following TanStack Table ColumnDef structure */
  columns: ColumnDef<TData, TValue>[];
  /** Array of data items to display */
  data: TData[];
  /** Unique key extractor for data items (defaults to 'id') */
  getRowId?: (row: TData) => string;
  /** Loading state flag */
  isLoading?: boolean;

  // View Mode Settings
  /** Initial view mode ('auto' switches at <768px) */
  defaultViewMode?: ViewMode;
  /** Optional custom card renderer for Mobile / Card view */
  renderCard?: (item: TData, isSelected: boolean, onToggleSelect: () => void) => React.ReactNode;
  /** Primary field name to use as title in auto-generated cards */
  cardTitleKey?: keyof TData;
  /** Secondary field name to use as subtitle in auto-generated cards */
  cardSubtitleKey?: keyof TData;

  // Feature Toggles
  enableSearch?: boolean;
  searchPlaceholder?: string;
  enableColumnToggles?: boolean;
  enableRowSelection?: boolean;
  enableDensityToggle?: boolean;
  enableExport?: boolean;
  enableViewToggle?: boolean;

  // Selection & Actions
  onRowSelect?: (selectedRows: TData[]) => void;
  toolbarActions?: React.ReactNode;
  bulkActions?: (selectedRows: TData[], clearSelection: () => void) => React.ReactNode;

  // Pagination
  pageSizeOptions?: number[];
  initialPageSize?: number;

  // Empty & Error States
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
  
  // Custom Styling
  className?: string;
}
```

---

## Technical Architecture & File Structure

```
apps/web/src/components/ui/
├── data-table.tsx                # Main reusable DataTable component
└── data-table/
    ├── data-table-toolbar.tsx     # Toolbar with search, filters, toggles & bulk actions
    ├── data-table-pagination.tsx  # Page controls, size selector & summary count
    ├── data-table-card-grid.tsx   # Card view container & default auto-generated card renderer
    ├── data-table-column-header.tsx # Header cell with sort trigger & direction icons
    └── data-table-export.ts       # CSV/JSON export helper utility functions
```

---

## UI/UX & Responsive Behavior

1. **Toolbar (`data-table-toolbar.tsx`)**:
   - Contains global search input on the left.
   - Bulk action banner pops up smoothly when `selectedRows.length > 0`.
   - Action button group on the right containing Column Visibility dropdown, Density toggle, Export dropdown, and View Switcher (`[Table] [Card]`).

2. **Desktop View (`<table>`)**:
   - `overflow-x-auto` wrapper ensuring horizontal scrolling on narrow tables.
   - Column headers with sort arrows (`▲` / `▼`).
   - Standard checkbox column for multi-row selection.

3. **Card View (`data-table-card-grid.tsx`)**:
   - Reflows rows into a responsive CSS grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`).
   - Cards display selection state with highlight borders when selected.
   - Headers, status badges, and cell values formatted clearly in key-value format.

---

## Verification & Testing Plan

1. **Type Checking & Linting**:
   - Run `pnpm --filter web typecheck` to verify TypeScript generic types.
2. **Integration Test / Sample Page**:
   - Refactor `apps/web/src/components/invoices/invoices-table.tsx` or `quotes-table.tsx` to use `<DataTable />`.
   - Test search, column sorting, pagination, row selection, column toggle, density toggle, CSV export, and view mode switching (Desktop Table vs Mobile Card).
