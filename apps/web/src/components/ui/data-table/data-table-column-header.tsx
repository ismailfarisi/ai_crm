'use client';

import React from 'react';
import { Column } from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

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
        className="flex items-center gap-1 text-xs font-medium text-ink-muted uppercase tracking-wider hover:text-ink transition-colors focus:outline-none focus:underline cursor-pointer"
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
