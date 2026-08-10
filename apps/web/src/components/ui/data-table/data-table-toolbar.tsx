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
import { Button } from '@/components/ui/button';
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
              className="text-xs cursor-pointer"
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
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink cursor-pointer"
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
                className="gap-1.5 text-xs cursor-pointer"
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
              className="gap-1.5 text-xs cursor-pointer"
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
                className="gap-1.5 text-xs cursor-pointer"
              >
                <Download className="size-3.5" />
                <span className="hidden sm:inline">Export</span>
              </Button>
              {showExportDropdown && (
                <div className="absolute right-0 mt-1 z-20 w-36 rounded-md border border-border bg-surface p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-surface-muted rounded cursor-pointer"
                  >
                    Export as CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJSON}
                    className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-surface-muted rounded cursor-pointer"
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
                className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
                  viewMode === 'table' ? 'bg-surface shadow-xs text-ink font-medium' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <TableIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('card')}
                title="Card View"
                className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
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
