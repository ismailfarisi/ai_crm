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
      <div className="space-y-3 p-4 border border-border/30 rounded-2xl bg-surface/85 backdrop-blur-xs shadow-[0_2px_12px_rgba(0,0,0,0.015)]">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className={`bg-surface/85 backdrop-blur-xs rounded-2xl border border-border/30 shadow-[0_2px_12px_rgba(0,0,0,0.015)] overflow-hidden ${className}`}>
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
            <thead className="border-b border-border/30 bg-surface-muted/30">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={`px-4 ${
                        density === 'compact' ? 'py-2' : 'py-3'
                      } text-xs font-semibold text-ink-muted/80 uppercase tracking-wider select-none`}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border/20 bg-transparent">
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-border/20 transition-colors ${
                    row.getIsSelected() ? 'bg-brand-soft/40' : 'hover:bg-surface-muted/20'
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
