'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export interface KanbanColumnDef {
  key: string;
  label: string;
  color?: string;
  badge?: string;
  summaryTotal?: string;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumnDef[];
  items: T[];
  getItemId: (item: T) => string;
  getStageKey: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onMoveStage: (itemId: string, nextStageKey: string) => Promise<void>;
  cardClassName?: string;
}

export function KanbanBoard<T>({
  columns,
  items,
  getItemId,
  getStageKey,
  renderCard,
  onMoveStage,
  cardClassName = '',
}: KanbanBoardProps<T>) {
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>({});

  const toggleCollapse = (key: string) => {
    setCollapsedCols((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
      {columns.map((col) => {
        const isCollapsed = collapsedCols[col.key];
        const colItems = items.filter((item) => getStageKey(item) === col.key);
        const isOver = dragOverColKey === col.key;

        return (
          <section
            key={col.key}
            aria-label={`${col.label} column`}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            }}
            onDragEnter={() => setDragOverColKey(col.key)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverColKey(null);
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOverColKey(null);
              const itemId = e.dataTransfer.getData('text/plain');
              if (itemId) {
                await onMoveStage(itemId, col.key);
              }
            }}
            className={`flex flex-col shrink-0 transition-all duration-200 rounded-xl border bg-surface/50 ${
              isCollapsed ? 'w-16' : 'w-76'
            } ${
              isOver ? 'border-brand ring-2 ring-brand/20 bg-brand/5' : 'border-border/60'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border/40">
              <button
                type="button"
                onClick={() => toggleCollapse(col.key)}
                className="flex items-center gap-1.5 font-semibold text-xs text-ink hover:text-brand"
              >
                {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {!isCollapsed && <span>{col.label}</span>}
              </button>
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium bg-surface-muted px-1.5 py-0.5 rounded-full text-ink-muted">
                  {colItems.length}
                </span>
              </div>
            </div>

            {/* Total metric */}
            {!isCollapsed && col.summaryTotal && (
              <div className="px-3 py-1.5 text-[11px] font-medium text-ink-subtle bg-surface-muted/30 border-b border-border/20">
                {col.summaryTotal}
              </div>
            )}

            {/* Cards List */}
            {!isCollapsed && (
              <div className="flex flex-col gap-2 p-2.5 min-h-[350px]">
                {colItems.map((item) => {
                  const itemId = getItemId(item);
                  return (
                    <div
                      key={itemId}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', itemId);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className={`cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow bg-surface border border-border/70 rounded-lg p-3 ${cardClassName}`}
                    >
                      {renderCard(item)}
                    </div>
                  );
                })}
                {colItems.length === 0 && (
                  <div className="h-24 flex items-center justify-center text-xs text-ink-subtle border border-dashed border-border/40 rounded-lg">
                    No items
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
