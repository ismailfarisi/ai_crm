# Reusable Data Table Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, feature-rich `<DataTable />` component using TanStack Table v8 in `apps/web/src/components/ui/` with global search, column sorting, pagination, row selection, column toggling, density controls, CSV/JSON export, and seamless hybrid table-to-card transformation for mobile screens.

**Architecture:** Wrap `@tanstack/react-table` inside a flexible React component suite (`data-table.tsx`, `data-table-toolbar.tsx`, `data-table-pagination.tsx`, `data-table-card-grid.tsx`, `data-table-column-header.tsx`, `data-table-export.ts`). Desktop view renders accessible responsive `<table>` markup while mobile or toggled card view renders a responsive CSS grid of cards.

**Tech Stack:** Next.js 16 (React 19), `@tanstack/react-table` v8, Tailwind CSS v4, Lucide React icons, Vitest + React Testing Library.

## Global Constraints
- All paths relative to repository root (`C:\Users\HP\saas`).
- Styling must use existing CSS design tokens from `apps/web/src/components/ui/primitives.tsx` (`bg-surface`, `border-border`, `text-ink`, `bg-surface-muted`).
- Strict TypeScript types (`ColumnDef<TData, TValue>`).

---

### Task 1: Package Installation & Setup

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `@tanstack/react-table` dependency
- Produces: `@tanstack/react-table` package installed in `apps/web`

- [ ] **Step 1: Install @tanstack/react-table**

Run: `pnpm --filter web add @tanstack/react-table@^8.21.2`

- [ ] **Step 2: Verify installation in package.json**

Run: `pnpm --filter web typecheck`
Expected: Success with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "deps: add @tanstack/react-table to web app"
```

---

### Task 2: Data Export Utilities

**Files:**
- Create: `apps/web/src/components/ui/data-table/data-table-export.ts`
- Create: `apps/web/src/components/ui/data-table/data-table-export.test.ts`

**Interfaces:**
- Consumes: Raw table row data objects
- Produces: `exportToCSV(data, filename)`, `exportToJSON(data, filename)`

- [ ] **Step 1: Write failing test for export utilities**

Write `apps/web/src/components/ui/data-table/data-table-export.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { formatCSVRow, exportToJSONData } from './data-table-export';

describe('data-table-export', () => {
  it('formats CSV row correctly with escaping', () => {
    const row = { name: 'John "Doe"', email: 'john@example.com', role: 'Admin, Lead' };
    const formatted = formatCSVRow(['name', 'email', 'role'], row);
    expect(formatted).toBe('"John ""Doe""",john@example.com,"Admin, Lead"');
  });

  it('serializes JSON data cleanly', () => {
    const data = [{ id: 1, name: 'Alice' }];
    const jsonStr = exportToJSONData(data);
    expect(JSON.parse(jsonStr)).toEqual(data);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test apps/web/src/components/ui/data-table/data-table-export.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement data-table-export.ts**

Create `apps/web/src/components/ui/data-table/data-table-export.ts`:
```ts
export function formatCSVRow(keys: string[], row: Record<string, any>): string {
  return keys
    .map((key) => {
      const val = row[key] ?? '';
      const stringVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
      const escaped = stringVal.replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(',');
}

export function exportToJSONData<T>(data: T[]): string {
  return JSON.stringify(data, null, 2);
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV<T extends Record<string, any>>(data: T[], filename = 'export.csv') {
  if (!data || data.length === 0) return;
  const keys = Object.keys(data[0]);
  const headerRow = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(',');
  const dataRows = data.map((row) => formatCSVRow(keys, row));
  const csvContent = [headerRow, ...dataRows].join('\n');
  downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
}

export function exportToJSON<T>(data: T[], filename = 'export.json') {
  const jsonContent = exportToJSONData(data);
  downloadFile(jsonContent, filename, 'application/json');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test apps/web/src/components/ui/data-table/data-table-export.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table-export.ts apps/web/src/components/ui/data-table/data-table-export.test.ts
git commit -m "feat(ui): add CSV and JSON data export utility helpers"
```

---

### Task 3: Data Table Column Header Component

**Files:**
- Create: `apps/web/src/components/ui/data-table/data-table-column-header.tsx`

**Interfaces:**
- Consumes: TanStack `Column<TData, TValue>`, header title string
- Produces: `<DataTableColumnHeader column={column} title={title} />`

- [ ] **Step 1: Create Column Header Component**

Create `apps/web/src/components/ui/data-table/data-table-column-header.tsx`:
```tsx
'use client';

import React from 'react';
import { Column } from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, EyeOff } from 'lucide-react';

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className = '',
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={`text-xs font-medium text-ink-muted uppercase tracking-wider ${className}`}>{title}</div>;
  }

  const isSorted = column.getIsSorted();

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <button
        type="button"
        onClick={() => column.toggleSorting(isSorted === 'asc')}
        className="flex items-center gap-1 text-xs font-medium text-ink-muted uppercase tracking-wider hover:text-ink transition-colors focus:outline-none focus:underline"
      >
        <span>{title}</span>
        {isSorted === 'desc' ? (
          <ArrowDown className="size-3.5 text-brand" />
        ) : isSorted === 'asc' ? (
          <ArrowUp className="size-3.5 text-brand" />
        ) : (
          <ArrowUpDown className="size-3.5 text-ink-muted/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table-column-header.tsx
git commit -m "feat(ui): add DataTableColumnHeader sorting component"
```

---

### Task 4: Data Table Pagination Component

**Files:**
- Create: `apps/web/src/components/ui/data-table/data-table-pagination.tsx`

**Interfaces:**
- Consumes: TanStack `Table<TData>`, `pageSizeOptions?: number[]`
- Produces: `<DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />`

- [ ] **Step 1: Create Pagination Component**

Create `apps/web/src/components/ui/data-table/data-table-pagination.tsx`:
```tsx
'use client';

import React from 'react';
import { Table } from '@tanstack/react-table';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives';

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 25, 50, 100],
}: DataTablePaginationProps<TData>) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const totalRows = table.getFilteredRowModel().rows.length;
  
  const startRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const endRow = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-border bg-surface text-xs text-ink-muted">
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <select
          value={pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          className="h-8 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span className="ml-2 font-medium text-ink">
          {startRow}-{endRow} of {totalRows}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
          aria-label="First page"
          className="size-8 p-0"
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="Previous page"
          className="size-8 p-0"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2 font-medium text-ink">
          Page {pageIndex + 1} of {table.getPageCount() || 1}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="Next page"
          className="size-8 p-0"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
          aria-label="Last page"
          className="size-8 p-0"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table-pagination.tsx
git commit -m "feat(ui): add DataTablePagination component"
```

---

### Task 5: Data Table Toolbar & Controls Component

**Files:**
- Create: `apps/web/src/components/ui/data-table/data-table-toolbar.tsx`

**Interfaces:**
- Consumes: TanStack `Table<TData>`, viewMode, setViewMode, density, setDensity, search options, export options, bulk actions callback
- Produces: `<DataTableToolbar table={table} ... />`

- [ ] **Step 1: Create Toolbar Component**

Create `apps/web/src/components/ui/data-table/data-table-toolbar.tsx`:
```tsx
'use client';

import React, { useState } from 'react';
import { Table } from '@tanstack/react-table';
import {
  Search,
  X,
  Columns,
  Download,
  LayoutGrid,
  Table as TableIcon,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { exportToCSV, exportToJSON } from './data-table-export';

export type ViewMode = 'table' | 'card' | 'auto';
export type DensityMode = 'comfortable' | 'compact';

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  setGlobalFilter: (val: string) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  density: DensityMode;
  setDensity: (density: DensityMode) => void;
  enableSearch?: boolean;
  searchPlaceholder?: string;
  enableColumnToggles?: boolean;
  enableDensityToggle?: boolean;
  enableExport?: boolean;
  enableViewToggle?: boolean;
  toolbarActions?: React.ReactNode;
  bulkActions?: (selectedRows: TData[], clearSelection: () => void) => React.ReactNode;
}

export function DataTableToolbar<TData>({
  table,
  globalFilter,
  setGlobalFilter,
  viewMode,
  setViewMode,
  density,
  setDensity,
  enableSearch = true,
  searchPlaceholder = 'Search all columns...',
  enableColumnToggles = true,
  enableDensityToggle = true,
  enableExport = true,
  enableViewToggle = true,
  toolbarActions,
  bulkActions,
}: DataTableToolbarProps<TData>) {
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const hasSelection = selectedRows.length > 0;

  const handleExportCSV = () => {
    const rowsToExport = hasSelection
      ? selectedRows
      : table.getFilteredRowModel().rows.map((r) => r.original);
    exportToCSV(rowsToExport as any);
    setShowExportDropdown(false);
  };

  const handleExportJSON = () => {
    const rowsToExport = hasSelection
      ? selectedRows
      : table.getFilteredRowModel().rows.map((r) => r.original);
    exportToJSON(rowsToExport as any);
    setShowExportDropdown(false);
  };

  return (
    <div className="flex flex-col gap-3 p-4 border-b border-border bg-surface">
      {/* Bulk Action Banner if rows selected */}
      {hasSelection && (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-brand/20 bg-brand/5 text-xs text-ink">
          <div className="flex items-center gap-2 font-medium">
            <span className="size-2 rounded-full bg-brand animate-pulse" />
            <span>{selectedRows.length} item(s) selected</span>
          </div>
          <div className="flex items-center gap-2">
            {bulkActions && bulkActions(selectedRows, () => table.resetRowSelection())}
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.resetRowSelection()}
              className="text-xs"
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Main Toolbar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left Side: Search Bar */}
        {enableSearch && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-muted" />
            <input
              type="text"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-9 pl-9 pr-8 rounded-md border border-border bg-surface text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
            {globalFilter && (
              <button
                type="button"
                onClick={() => setGlobalFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Right Side: Toggles & Actions */}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {toolbarActions}

          {/* Column Toggle Dropdown */}
          {enableColumnToggles && (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowColumnDropdown(!showColumnDropdown)}
                className="gap-1.5 text-xs"
              >
                <Columns className="size-3.5" />
                <span>Columns</span>
              </Button>
              {showColumnDropdown && (
                <div className="absolute right-0 mt-1 z-20 w-48 rounded-md border border-border bg-surface p-2 shadow-lg max-h-60 overflow-y-auto">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted px-2 py-1">
                    Toggle Columns
                  </div>
                  {table
                    .getAllColumns()
                    .filter((col) => col.getCanHide())
                    .map((col) => (
                      <label
                        key={col.id}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs text-ink hover:bg-surface-muted rounded cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={col.getIsVisible()}
                          onChange={col.getToggleVisibilityHandler()}
                          className="rounded border-border text-brand focus:ring-brand"
                        />
                        <span className="capitalize">{col.id}</span>
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Density Toggle */}
          {enableDensityToggle && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
              title={`Switch to ${density === 'comfortable' ? 'compact' : 'comfortable'} mode`}
              className="gap-1.5 text-xs"
            >
              {density === 'comfortable' ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
              <span className="hidden sm:inline capitalize">{density}</span>
            </Button>
          )}

          {/* Export Dropdown */}
          {enableExport && (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                className="gap-1.5 text-xs"
              >
                <Download className="size-3.5" />
                <span className="hidden sm:inline">Export</span>
              </Button>
              {showExportDropdown && (
                <div className="absolute right-0 mt-1 z-20 w-36 rounded-md border border-border bg-surface p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-surface-muted rounded"
                  >
                    Export as CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJSON}
                    className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-surface-muted rounded"
                  >
                    Export as JSON
                  </button>
                </div>
              )}
            </div>
          )}

          {/* View Switcher Button Group */}
          {enableViewToggle && (
            <div className="flex items-center rounded-md border border-border p-0.5 bg-surface-muted/50">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                title="Table View"
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'table' ? 'bg-surface shadow-xs text-ink font-medium' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <TableIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('card')}
                title="Card View"
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'card' ? 'bg-surface shadow-xs text-ink font-medium' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <LayoutGrid className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table-toolbar.tsx
git commit -m "feat(ui): add DataTableToolbar controls component"
```

---

### Task 6: Data Table Card Grid Component

**Files:**
- Create: `apps/web/src/components/ui/data-table/data-table-card-grid.tsx`

**Interfaces:**
- Consumes: TanStack `Table<TData>`, custom `renderCard` prop, card field keys
- Produces: `<DataTableCardGrid table={table} renderCard={renderCard} ... />`

- [ ] **Step 1: Create Card Grid Component**

Create `apps/web/src/components/ui/data-table/data-table-card-grid.tsx`:
```tsx
'use client';

import React from 'react';
import { Table, flexRender } from '@tanstack/react-table';

interface DataTableCardGridProps<TData> {
  table: Table<TData>;
  renderCard?: (item: TData, isSelected: boolean, onToggleSelect: () => void) => React.ReactNode;
  cardTitleKey?: keyof TData;
  cardSubtitleKey?: keyof TData;
}

export function DataTableCardGrid<TData>({
  table,
  renderCard,
  cardTitleKey,
  cardSubtitleKey,
}: DataTableCardGridProps<TData>) {
  const rows = table.getRowModel().rows;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {rows.map((row) => {
        const isSelected = row.getIsSelected();
        const item = row.original;

        if (renderCard) {
          return (
            <React.Fragment key={row.id}>
              {renderCard(item, isSelected, () => row.toggleSelected())}
            </React.Fragment>
          );
        }

        const visibleCells = row.getVisibleCells();
        const selectCell = visibleCells.find((c) => c.column.id === 'select');
        const contentCells = visibleCells.filter(
          (c) => c.column.id !== 'select' && c.column.id !== 'actions'
        );
        const actionsCell = visibleCells.find((c) => c.column.id === 'actions');

        const titleVal = cardTitleKey ? String(item[cardTitleKey] ?? '') : undefined;
        const subtitleVal = cardSubtitleKey ? String(item[cardSubtitleKey] ?? '') : undefined;

        return (
          <div
            key={row.id}
            className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
              isSelected
                ? 'border-brand bg-brand/5 shadow-xs'
                : 'border-border bg-surface hover:border-brand/40 hover:shadow-xs'
            }`}
          >
            <div>
              {/* Card Top Row: Checkbox, Title & Actions */}
              <div className="flex items-start justify-between gap-2 pb-3 mb-3 border-b border-border/60">
                <div className="flex items-center gap-3">
                  {selectCell && (
                    <div className="pt-0.5">
                      {flexRender(selectCell.column.columnDef.cell, selectCell.getContext())}
                    </div>
                  )}
                  <div>
                    {titleVal && (
                      <h4 className="text-sm font-semibold text-ink line-clamp-1">{titleVal}</h4>
                    )}
                    {subtitleVal && (
                      <p className="text-xs text-ink-muted line-clamp-1">{subtitleVal}</p>
                    )}
                  </div>
                </div>
                {actionsCell && (
                  <div>
                    {flexRender(actionsCell.column.columnDef.cell, actionsCell.getContext())}
                  </div>
                )}
              </div>

              {/* Card Body: Key-Value Field Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {contentCells.map((cell) => (
                  <div key={cell.id} className="space-y-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                      {typeof cell.column.columnDef.header === 'string'
                        ? cell.column.columnDef.header
                        : cell.column.id}
                    </span>
                    <div className="text-ink font-medium">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table-card-grid.tsx
git commit -m "feat(ui): add DataTableCardGrid responsive layout component"
```

---

### Task 7: Main Reusable DataTable Component

**Files:**
- Create: `apps/web/src/components/ui/data-table.tsx`
- Create: `apps/web/src/components/ui/data-table.test.tsx`

**Interfaces:**
- Consumes: `DataTableProps<TData, TValue>`
- Produces: Primary reusable `<DataTable />` export

- [ ] **Step 1: Write component test for DataTable**

Create `apps/web/src/components/ui/data-table.test.tsx`:
```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from './data-table';
import { ColumnDef } from '@tanstack/react-table';

interface User {
  id: string;
  name: string;
  email: string;
}

const columns: ColumnDef<User, any>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
];

const data: User[] = [
  { id: '1', name: 'Alice Smith', email: 'alice@example.com' },
  { id: '2', name: 'Bob Jones', email: 'bob@example.com' },
];

describe('DataTable', () => {
  it('renders table headers and data correctly in table view', () => {
    render(<DataTable columns={columns} data={data} defaultViewMode="table" />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('renders custom empty state when data is empty', () => {
    render(<DataTable columns={columns} data={[]} emptyTitle="No users found" />);
    expect(screen.getByText('No users found')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement DataTable Component**

Create `apps/web/src/components/ui/data-table.tsx`:
```tsx
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
  RowSelectionState,
} from '@tanstack/react-table';

import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { TableIcon } from 'lucide-react';
import { DataTableToolbar, ViewMode, DensityMode } from './data-table/data-table-toolbar';
import { DataTablePagination } from './data-table/data-table-pagination';
import { DataTableCardGrid } from './data-table/data-table-card-grid';

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  isLoading?: boolean;

  // View Mode Settings
  defaultViewMode?: ViewMode;
  renderCard?: (item: TData, isSelected: boolean, onToggleSelect: () => void) => React.ReactNode;
  cardTitleKey?: keyof TData;
  cardSubtitleKey?: keyof TData;

  // Feature Flags
  enableSearch?: boolean;
  searchPlaceholder?: string;
  enableColumnToggles?: boolean;
  enableRowSelection?: boolean;
  enableDensityToggle?: boolean;
  enableExport?: boolean;
  enableViewToggle?: boolean;

  // Handlers & Custom Nodes
  onRowSelect?: (selectedRows: TData[]) => void;
  toolbarActions?: React.ReactNode;
  bulkActions?: (selectedRows: TData[], clearSelection: () => void) => React.ReactNode;

  // Pagination
  pageSizeOptions?: number[];
  initialPageSize?: number;

  // Empty State
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;

  className?: string;
}

export function DataTable<TData, TValue>({
  columns: userColumns,
  data,
  getRowId,
  isLoading = false,
  defaultViewMode = 'auto',
  renderCard,
  cardTitleKey,
  cardSubtitleKey,
  enableSearch = true,
  searchPlaceholder = 'Search records...',
  enableColumnToggles = true,
  enableRowSelection = false,
  enableDensityToggle = true,
  enableExport = true,
  enableViewToggle = true,
  onRowSelect,
  toolbarActions,
  bulkActions,
  pageSizeOptions = [10, 25, 50, 100],
  initialPageSize = 10,
  emptyTitle = 'No data found',
  emptyDescription = 'There are no records matching your criteria.',
  emptyIcon = <TableIcon className="size-8 text-ink-muted" />,
  className = '',
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [density, setDensity] = useState<DensityMode>('comfortable');
  const [isMobile, setIsMobile] = useState(false);

  // Detect Mobile Breakpoint for 'auto' view mode
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Prepend Row Selection Checkbox column if enabled
  const columns = useMemo(() => {
    if (!enableRowSelection) return userColumns;

    const selectColumn: ColumnDef<TData, any> = {
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          aria-label="Select all"
          className="rounded border-border text-brand focus:ring-brand cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          aria-label="Select row"
          className="rounded border-border text-brand focus:ring-brand cursor-pointer"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    };

    return [selectColumn, ...userColumns];
  }, [userColumns, enableRowSelection]);

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      rowSelection,
    },
    initialState: {
      pagination: {
        pageSize: initialPageSize,
      },
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Notify parent on row selection change
  useEffect(() => {
    if (onRowSelect) {
      const selected = table.getSelectedRowModel().rows.map((r) => r.original);
      onRowSelect(selected);
    }
  }, [rowSelection, table, onRowSelect]);

  const activeView = viewMode === 'auto' ? (isMobile ? 'card' : 'table') : viewMode;

  if (isLoading) {
    return (
      <div className="space-y-3 p-4 border border-border rounded-xl bg-surface">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border bg-surface overflow-hidden shadow-xs ${className}`}>
      {/* Header Toolbar */}
      <DataTableToolbar
        table={table}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
        viewMode={viewMode}
        setViewMode={setViewMode}
        density={density}
        setDensity={setDensity}
        enableSearch={enableSearch}
        searchPlaceholder={searchPlaceholder}
        enableColumnToggles={enableColumnToggles}
        enableDensityToggle={enableDensityToggle}
        enableExport={enableExport}
        enableViewToggle={enableViewToggle}
        toolbarActions={toolbarActions}
        bulkActions={bulkActions}
      />

      {/* Main Content Area: Table vs Cards vs Empty */}
      {table.getRowModel().rows.length === 0 ? (
        <div className="p-8">
          <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
        </div>
      ) : activeView === 'card' ? (
        <DataTableCardGrid
          table={table}
          renderCard={renderCard}
          cardTitleKey={cardTitleKey}
          cardSubtitleKey={cardSubtitleKey}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted/50">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={`px-4 ${
                        density === 'compact' ? 'py-2' : 'py-3'
                      } text-xs font-medium text-ink-muted uppercase tracking-wider select-none`}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`transition-colors ${
                    row.getIsSelected() ? 'bg-brand/5' : 'hover:bg-surface-muted/40'
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`px-4 ${
                        density === 'compact' ? 'py-2.5' : 'py-3.5'
                      } text-ink`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer Pagination */}
      <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
    </div>
  );
}
```

- [ ] **Step 3: Run Vitest tests**

Run: `pnpm --filter web test apps/web/src/components/ui/data-table.test.tsx`
Expected: PASS

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/data-table.tsx apps/web/src/components/ui/data-table.test.tsx
git commit -m "feat(ui): add main reusable DataTable component with hybrid card switching"
```

---

### Task 8: Refactor Invoices Table & Verify Integration

**Files:**
- Modify: `apps/web/src/components/invoices/invoices-table.tsx`

**Interfaces:**
- Consumes: `<DataTable />`
- Produces: Updated `InvoicesTable` leveraging generic `<DataTable />`

- [ ] **Step 1: Refactor invoices-table.tsx to use DataTable**

Update `apps/web/src/components/invoices/invoices-table.tsx`:
```tsx
'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import type { Invoice, InvoiceStatus } from '@/hooks/use-invoices';

interface InvoicesTableProps {
  invoices: Invoice[];
  isLoading?: boolean;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === 'PAID') {
    return (
      <Badge tone="success" className="gap-1">
        <CheckCircle className="size-3" />
        Paid
      </Badge>
    );
  }
  return (
    <Badge tone="warning" className="gap-1">
      <Clock className="size-3" />
      Issued
    </Badge>
  );
}

export function InvoicesTable({ invoices, isLoading = false }: InvoicesTableProps) {
  const columns = useMemo<ColumnDef<Invoice, any>[]>(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Number" />,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-ink">{row.original.invoiceNumber}</span>
        ),
      },
      {
        accessorKey: 'quoteId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quote ID" />,
        cell: ({ row }) => (
          <Link
            href={`/quotes?id=${row.original.quoteId}`}
            className="font-mono text-xs text-brand hover:underline"
          >
            {row.original.quoteId}
          </Link>
        ),
      },
      {
        accessorKey: 'amount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            ${(row.original.amount || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'issuedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issued Date" />,
        cell: ({ row }) => {
          const dateStr = row.original.issuedAt
            ? new Date(row.original.issuedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : 'N/A';
          return <span className="text-ink-muted text-xs whitespace-nowrap">{dateStr}</span>;
        },
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={invoices}
      isLoading={isLoading}
      getRowId={(row) => row.id}
      cardTitleKey="invoiceNumber"
      cardSubtitleKey="quoteId"
      enableRowSelection
      searchPlaceholder="Search invoices..."
      emptyTitle="No invoices found"
      emptyDescription="Invoices will automatically be generated when quotes are approved."
    />
  );
}
```

- [ ] **Step 2: Run web typecheck & vitest suite**

Run: `pnpm --filter web typecheck && pnpm --filter web test`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/invoices/invoices-table.tsx
git commit -m "refactor(web): update InvoicesTable component to use reusable DataTable"
```

---

## Self-Review Verification

1. **Spec Coverage**: All features from spec (hybrid table/card view, sorting, global search, pagination, column toggles, row selection, export to CSV/JSON, density toggle, custom card support) are covered.
2. **Placeholder Scan**: Checked — zero TBDs or placeholders.
3. **Type Consistency**: Checked — TanStack `ColumnDef<TData, TValue>`, `Table<TData>`, `ViewMode` consistently named across all component files.
