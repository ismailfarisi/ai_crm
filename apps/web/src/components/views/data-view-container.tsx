'use client';

import React, { useState } from 'react';
import { useSavedViews } from '@/hooks/use-saved-views';
import { ViewToolbar } from './view-toolbar';
import type { ViewLayoutType } from '@saas/shared';

interface DataViewContainerProps {
  entityType: string;
  search: string;
  onSearchChange: (search: string) => void;
  children: (props: { viewType: ViewLayoutType }) => React.ReactNode;
  actionSlot?: React.ReactNode;
  onOpenFilter?: () => void;
  filterCount?: number;
}

export function DataViewContainer({
  entityType,
  search,
  onSearchChange,
  children,
  actionSlot,
  onOpenFilter,
  filterCount,
}: DataViewContainerProps) {
  const { views, activeView, setActiveViewId } = useSavedViews(entityType);
  const [viewType, setViewType] = useState<ViewLayoutType>('table');

  return (
    <div className="w-full flex flex-col">
      {/* Saved View Tabs */}
      {views.length > 0 && (
        <div className="flex items-center gap-1 border-b border-border/60 px-1 mb-2 overflow-x-auto scrollbar-none">
          {views.map((v) => {
            const isActive = activeView?.id === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setActiveViewId(v.id);
                  if (v.viewType) setViewType(v.viewType);
                }}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'border-brand text-brand font-semibold'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {v.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <ViewToolbar
        viewType={viewType}
        onViewTypeChange={setViewType}
        search={search}
        onSearchChange={onSearchChange}
        actionSlot={actionSlot}
        onOpenFilter={onOpenFilter}
        filterCount={filterCount}
      />

      {/* View Body */}
      <div className="w-full">
        {children({ viewType })}
      </div>
    </div>
  );
}
