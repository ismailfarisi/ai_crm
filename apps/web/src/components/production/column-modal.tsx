'use client';

import { useEffect, useState } from 'react';
import {
  BOARD_COLUMN_COLORS,
  type BoardColumnColor,
  type ProductionBoardColumn,
  type WorkOrderStatus,
} from '@saas/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';

export interface ColumnModalProps {
  open: boolean;
  onClose: () => void;
  column?: ProductionBoardColumn | null;
  onSave: (data: {
    name: string;
    status: WorkOrderStatus;
    color: BoardColumnColor;
  }) => Promise<void> | void;
  isSaving?: boolean;
}

export const COLUMN_COLOR_MAP: Record<
  BoardColumnColor,
  {
    bg: string;
    border: string;
    text: string;
    dot: string;
    badge: string;
    chip: string;
  }
> = {
  slate: {
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    text: 'text-slate-600 dark:text-slate-400',
    dot: 'bg-slate-500',
    badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
    chip: 'bg-slate-500 hover:bg-slate-600',
  },
  blue: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
    badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    chip: 'bg-blue-500 hover:bg-blue-600',
  },
  amber: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-500 hover:bg-amber-600',
  },
  purple: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    text: 'text-purple-600 dark:text-purple-400',
    dot: 'bg-purple-500',
    badge: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
    chip: 'bg-purple-500 hover:bg-purple-600',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-500 hover:bg-emerald-600',
  },
  rose: {
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    text: 'text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    chip: 'bg-rose-500 hover:bg-rose-600',
  },
  cyan: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    text: 'text-cyan-600 dark:text-cyan-400',
    dot: 'bg-cyan-500',
    badge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
    chip: 'bg-cyan-500 hover:bg-cyan-600',
  },
};

const STATUS_OPTIONS: { value: WorkOrderStatus; label: string }[] = [
  { value: 'PLANNED', label: 'Planned (Pre-production)' },
  { value: 'RELEASED', label: 'Released (Ready on floor)' },
  { value: 'IN_PROGRESS', label: 'In Progress (Active processing)' },
  { value: 'COMPLETE', label: 'Complete (Finished & Costed)' },
];

export function ColumnModal({
  open,
  onClose,
  column,
  onSave,
  isSaving = false,
}: ColumnModalProps) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<WorkOrderStatus>('IN_PROGRESS');
  const [color, setColor] = useState<BoardColumnColor>('purple');
  const [error, setError] = useState('');

  const isEditing = Boolean(column);

  useEffect(() => {
    if (column) {
      setName(column.name);
      setStatus(column.status);
      setColor(column.color);
    } else {
      setName('');
      setStatus('IN_PROGRESS');
      setColor('purple');
    }
    setError('');
  }, [column, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Column name is required');
      return;
    }
    if (trimmed.length > 60) {
      setError('Column name cannot exceed 60 characters');
      return;
    }

    try {
      await onSave({
        name: trimmed,
        status,
        color,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save column');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit Board Column' : 'Add Board Column'}
      description="Configure custom stage and map to the underlying manufacturing status."
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="column-modal-form"
            size="sm"
            loading={isSaving}
            disabled={!name.trim()}
          >
            {isEditing ? 'Save Changes' : 'Create Column'}
          </Button>
        </>
      }
    >
      <form
        id="column-modal-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <Input
          label="Column Title"
          placeholder="e.g. Quality Inspection (QC)"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          error={error}
          required
          autoFocus
        />

        <Select
          label="Core Status Mapping"
          value={status}
          onChange={(e) => setStatus(e.target.value as WorkOrderStatus)}
          options={STATUS_OPTIONS}
          hint="Determines inventory WIP accounting and job lifecycle transitions."
          disabled={Boolean(column)}
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink">
            Theme Color
          </label>
          <div
            className="flex flex-wrap items-center gap-2 pt-1"
            role="radiogroup"
            aria-label="Theme Color"
          >
            {BOARD_COLUMN_COLORS.map((col) => {
              const isSelected = color === col;
              const meta = COLUMN_COLOR_MAP[col];
              return (
                <button
                  key={col}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={col}
                  onClick={() => setColor(col)}
                  className={`size-7 rounded-full transition-all cursor-pointer ${meta.chip} ${
                    isSelected
                      ? 'ring-3 ring-accent ring-offset-2 ring-offset-surface scale-110'
                      : 'opacity-80 hover:opacity-100'
                  }`}
                />
              );
            })}
          </div>
          <p className="text-xs text-ink-subtle capitalize">
            Selected: <span className="font-semibold text-ink">{color}</span>
          </p>
        </div>
      </form>
    </Dialog>
  );
}
