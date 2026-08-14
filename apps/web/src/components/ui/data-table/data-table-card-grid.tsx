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
            className={`flex flex-col justify-between rounded-2xl border p-4 transition-all ${
              isSelected
                ? 'border-brand bg-brand-soft/40 shadow-xs'
                : 'border-border/80 bg-surface hover:border-brand/40 hover:shadow-xs'
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
