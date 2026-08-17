'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Play,
  Activity,
  Plus,
  Undo2,
  Redo2,
  Check,
  Zap,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationWorkflowDto } from '@saas/shared';

export interface CanvasHeaderProps {
  workflow: AutomationWorkflowDto | null;
  workflowName: string;
  onNameChange: (name: string) => void;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  onStatusToggle: () => void;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onOpenTestRun: () => void;
  onOpenPalette: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  className?: string;
}

export function CanvasHeader({
  workflow,
  workflowName,
  onNameChange,
  status,
  onStatusToggle,
  isDirty,
  isSaving,
  onSave,
  onOpenTestRun,
  onOpenPalette,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  className,
}: CanvasHeaderProps) {
  return (
    <header
      data-testid="canvas-header"
      className={clsx(
        'h-14 border-b border-stone-200 bg-white/95 backdrop-blur-sm px-4 flex items-center justify-between gap-4 z-30 select-none',
        className,
      )}
    >
      {/* Left section: Back button & Workflow title editor */}
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/automations"
          data-testid="back-to-automations-link"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          <input
            type="text"
            data-testid="workflow-name-input"
            value={workflowName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Untitled Automation Workflow"
            className="text-sm font-bold text-stone-900 bg-transparent border border-transparent hover:border-stone-200 focus:border-amber-500 rounded-md px-2 py-1 focus:bg-white focus:outline-none transition-all truncate"
          />

          <span
            data-testid="workflow-status-badge"
            className={clsx(
              'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0',
              status === 'ACTIVE'
                ? 'bg-emerald-100 text-emerald-800'
                : status === 'PAUSED'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-stone-100 text-stone-600',
            )}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Middle section: Undo / Redo & Add Node */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid="undo-btn"
          disabled={!canUndo}
          onClick={onUndo}
          className={clsx(
            'p-1.5 rounded-lg border border-stone-200 transition-colors',
            canUndo
              ? 'text-stone-700 hover:bg-stone-100 cursor-pointer'
              : 'text-stone-300 border-stone-100 cursor-not-allowed',
          )}
          title="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          data-testid="redo-btn"
          disabled={!canRedo}
          onClick={onRedo}
          className={clsx(
            'p-1.5 rounded-lg border border-stone-200 transition-colors',
            canRedo
              ? 'text-stone-700 hover:bg-stone-100 cursor-pointer'
              : 'text-stone-300 border-stone-100 cursor-not-allowed',
          )}
          title="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="h-4 w-px bg-stone-200 mx-1" />

        <button
          type="button"
          data-testid="open-palette-btn"
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-semibold text-stone-700 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5 text-amber-600" />
          Add Node
        </button>
      </div>

      {/* Right section: Active toggle, Test Run, Save */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Active Toggle Switch */}
        <button
          type="button"
          data-testid="status-toggle-btn"
          onClick={onStatusToggle}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer',
            status === 'ACTIVE'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
          )}
        >
          <span
            className={clsx(
              'h-2 w-2 rounded-full',
              status === 'ACTIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-stone-300',
            )}
          />
          {status === 'ACTIVE' ? 'Active' : 'Inactive'}
        </button>

        {/* Test Run Drawer Button */}
        <button
          type="button"
          data-testid="open-test-run-btn"
          onClick={onOpenTestRun}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-800 shadow-xs transition-colors cursor-pointer"
        >
          <Play className="h-3.5 w-3.5 text-amber-600 fill-amber-600" />
          Test Run
        </button>

        {/* Save Workflow Button */}
        <button
          type="button"
          data-testid="save-workflow-btn"
          disabled={isSaving}
          onClick={onSave}
          className={clsx(
            'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white shadow-xs transition-all cursor-pointer',
            isDirty
              ? 'bg-amber-600 hover:bg-amber-700 active:scale-95'
              : 'bg-stone-800 hover:bg-stone-900',
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? 'Saving...' : isDirty ? 'Save Changes*' : 'Saved'}
        </button>
      </div>
    </header>
  );
}
