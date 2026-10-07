'use client';

import React from 'react';
import { Table, Kanban, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ViewLayoutType } from '@saas/shared';

interface ViewToolbarProps {
  viewType: ViewLayoutType;
  onViewTypeChange: (type: ViewLayoutType) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onOpenFilter?: () => void;
  filterCount?: number;
  actionSlot?: React.ReactNode;
}

export function ViewToolbar({
  viewType,
  onViewTypeChange,
  search,
  onSearchChange,
  onOpenFilter,
  filterCount = 0,
  actionSlot,
}: ViewToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 px-1 mb-3">
      {/* Left: View Switcher & Search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border/60 bg-surface-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => onViewTypeChange('table')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              viewType === 'table' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Table className="size-3.5" />
            <span className="hidden sm:inline">Table</span>
          </button>
          <button
            type="button"
            onClick={() => onViewTypeChange('kanban')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              viewType === 'kanban' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Kanban className="size-3.5" />
            <span className="hidden sm:inline">Pipeline</span>
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="pl-8 pr-3 py-1 text-xs bg-surface border border-border/60 rounded-md outline-none focus:border-brand w-48 sm:w-64 transition-all"
          />
        </div>
      </div>

      {/* Right: Filters & Actions */}
      <div className="flex items-center gap-2">
        {onOpenFilter && (
          <Button variant="outline" size="sm" onClick={onOpenFilter} className="gap-1.5 text-xs">
            <SlidersHorizontal className="size-3.5" />
            <span>Filter</span>
            {filterCount > 0 && (
              <span className="bg-brand text-ink text-[10px] px-1.5 rounded-full font-bold">
                {filterCount}
              </span>
            )}
          </Button>
        )}
        {actionSlot}
      </div>
    </div>
  );
}
