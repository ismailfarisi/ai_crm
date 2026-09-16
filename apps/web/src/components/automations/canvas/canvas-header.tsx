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
        'h-14 border-b border-border bg-surface/95 backdrop-blur-sm px-4 flex items-center justify-between gap-4 z-30 select-none',
        className,
      )}
    >
      {/* Left section: Back button & Workflow title editor */}
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/automations"
          data-testid="back-to-automations-link"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
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
            className="text-sm font-bold text-ink bg-transparent border border-transparent hover:border-border focus:border-brand rounded-md px-2 py-1 focus:bg-surface focus:outline-none transition-all truncate"
          />

          <span
            data-testid="workflow-status-badge"
            className={clsx(
              'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0',
              status === 'ACTIVE'
                ? 'bg-success-soft text-success'
                : status === 'PAUSED'
                ? 'bg-brand-soft text-ink'
                : 'bg-surface-muted text-ink-muted',
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
            'p-1.5 rounded-lg border border-border transition-colors',
            canUndo
              ? 'text-ink hover:bg-surface-muted cursor-pointer'
              : 'text-ink-subtle border-border/40 cursor-not-allowed',
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
            'p-1.5 rounded-lg border border-border transition-colors',
            canRedo
              ? 'text-ink hover:bg-surface-muted cursor-pointer'
              : 'text-ink-subtle border-border/40 cursor-not-allowed',
          )}
          title="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="h-4 w-px bg-surface-muted mx-1" />

        <button
          type="button"
          data-testid="open-palette-btn"
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-muted hover:bg-surface-muted text-xs font-semibold text-ink transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5 text-brand" />
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
              ? 'border-success/40 bg-success-soft text-success'
              : 'border-border bg-surface text-ink-muted hover:bg-surface-muted',
          )}
        >
          <span
            className={clsx(
              'h-2 w-2 rounded-full',
              status === 'ACTIVE' ? 'bg-success animate-pulse' : 'bg-border-strong',
            )}
          />
          {status === 'ACTIVE' ? 'Active' : 'Inactive'}
        </button>

        {/* Test Run Drawer Button */}
        <button
          type="button"
          data-testid="open-test-run-btn"
          onClick={onOpenTestRun}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted text-xs font-semibold text-ink shadow-xs transition-colors cursor-pointer"
        >
          <Play className="h-3.5 w-3.5 text-brand fill-brand" />
          Test Run
        </button>

        {/* Save Workflow Button */}
        <button
          type="button"
          data-testid="save-workflow-btn"
          disabled={isSaving}
          onClick={onSave}
          className={clsx(
            'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-ink-inverted shadow-xs transition-all cursor-pointer',
            isDirty
              ? 'bg-brand hover:bg-brand-hover active:scale-95'
              : 'bg-brand-dark hover:bg-brand-dark',
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? 'Saving...' : isDirty ? 'Save Changes*' : 'Saved'}
        </button>
      </div>
    </header>
  );
}
