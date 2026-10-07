'use client';

import React, { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { TextCellEditor } from './cell-editors/text-cell-editor';

interface InlineEditableTableProps<TData> {
  data: TData[];
  columns: (ColumnDef<TData, any> & { isEditable?: boolean })[];
  onCellUpdate: (rowId: string, field: string, nextValue: any) => Promise<void>;
  rowIdKey?: keyof TData;
}

export function InlineEditableTable<TData extends Record<string, any>>({
  data,
  columns,
  onCellUpdate,
  rowIdKey = 'id',
}: InlineEditableTableProps<TData>) {
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="w-full overflow-x-auto border border-border/60 rounded-lg bg-surface">
      <table className="w-full text-left border-collapse text-xs">
        <thead className="bg-surface-muted/50 border-b border-border/60 text-ink-muted uppercase font-semibold text-[11px] tracking-wider">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-3 py-2.5">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border/40">
          {table.getRowModel().rows.map((row) => {
            const rowId = String(row.original[rowIdKey]);
            return (
              <tr key={row.id} className="hover:bg-surface-muted/30 transition-colors">
                {row.getVisibleCells().map((cell) => {
                  const field = cell.column.id;
                  const isEditing = editingCell?.rowId === rowId && editingCell?.field === field;
                  const isEditable = (cell.column.columnDef as any).isEditable;

                  return (
                    <td
                      key={cell.id}
                      className="px-3 py-2 text-ink align-middle"
                      onDoubleClick={() => {
                        if (isEditable) setEditingCell({ rowId, field });
                      }}
                    >
                      {isEditing ? (
                        <TextCellEditor
                          value={String(cell.getValue() ?? '')}
                          onCommit={async (next) => {
                            setEditingCell(null);
                            if (next !== cell.getValue()) {
                              await onCellUpdate(rowId, field, next);
                            }
                          }}
                          onCancel={() => setEditingCell(null)}
                        />
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
