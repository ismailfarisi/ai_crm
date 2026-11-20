'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Play,
  History,
  Activity,
  Plus,
  Undo2,
  Redo2,
  Check,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationWorkflowDto } from '@saas/shared';

export interface CanvasHeaderProps {
  workflow: AutomationWorkflowDto | null;
  workflowName: string;
  onNameChange: (name: string) => void;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  /** Asks to activate or deactivate; the page confirms and saves it. */
  onStatusToggle: () => void;
  /** Disables Activate, with the reason as its title (e.g. an invalid schedule). */
  statusBlockedReason?: string | null;
  /**
   * Runs before Back navigates. Call `event.preventDefault()` to stay, e.g. to
   * ask about unsaved changes first.
   */
  onBackClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  isDirty: boolean;
  isSaving: boolean;
  /** Changes save themselves (while the automation is off); Save is only a fallback. */
  autosave?: boolean;
  /** Blocks Save (e.g. a trigger editor holds invalid input); explained by the title. */
  saveBlockedReason?: string | null;
  onSave: () => void;
  onOpenTestRun: () => void;
  onOpenRuns?: () => void;
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
  statusBlockedReason,
  onBackClick,
  isDirty,
  isSaving,
  autosave = false,
  saveBlockedReason,
  onSave,
  onOpenTestRun,
  onOpenRuns,
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
        'min-h-14 border-b border-border bg-surface/95 backdrop-blur-sm px-4 flex flex-col justify-center z-30 select-none',
        className,
      )}
    >
      {/* Wraps onto a second line when the screen is too narrow for every button, instead of overlapping. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
      {/* Left section: Back button & Workflow title editor */}
      <div className="flex flex-1 items-center gap-3 min-w-60">
        <Link
          href="/automations"
          data-testid="back-to-automations-link"
          aria-label="Back to automations"
          onClick={onBackClick}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex flex-1 items-center gap-2 min-w-0">
          <input
            type="text"
            data-testid="workflow-name-input"
            value={workflowName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Name this automation"
            aria-label="Automation name"
            className="min-w-0 flex-1 text-sm font-semibold text-ink bg-transparent border border-transparent hover:border-border focus:border-brand rounded-md px-2 py-1 focus:bg-surface focus:outline-none transition truncate"
          />

          <span
            data-testid="workflow-status-badge"
            className={clsx(
              'px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0',
              status === 'ACTIVE'
                ? 'bg-success-soft text-success'
                : status === 'PAUSED'
                ? 'bg-brand-soft text-ink'
                : 'bg-surface-muted text-ink-muted',
            )}
          >
            {status === 'ACTIVE' ? 'On' : status === 'PAUSED' ? 'Paused' : 'Off (draft)'}
          </span>
        </div>
      </div>

      {/* Middle section: Undo / Redo & Add Node */}
      <div className="flex shrink-0 items-center gap-1.5">
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
          aria-label="Undo"
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
          aria-label="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="h-4 w-px bg-surface-muted mx-1" />

        <button
          type="button"
          data-testid="open-palette-btn"
          onClick={onOpenPalette}
          className="flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-muted hover:bg-surface-muted text-xs font-semibold text-ink transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5 text-brand" />
          Add a step
        </button>
      </div>

      {/* Right section: Active toggle, Test Run, Save */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {/* Activate / Deactivate: an explicit action, confirmed and saved by the page */}
        <button
          type="button"
          data-testid="status-toggle-btn"
          onClick={onStatusToggle}
          disabled={status !== 'ACTIVE' && !!statusBlockedReason}
          title={status !== 'ACTIVE' ? (statusBlockedReason ?? undefined) : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted text-xs font-semibold text-ink shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            aria-hidden
            className={clsx('h-2 w-2 rounded-full', status === 'ACTIVE' ? 'bg-border-strong' : 'bg-success')}
          />
          {status === 'ACTIVE' ? 'Turn off' : 'Turn on'}
        </button>

        {/* Runs Drawer Button */}
        <button
          type="button"
          data-testid="open-runs-btn"
          onClick={onOpenRuns}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted text-xs font-semibold text-ink shadow-xs transition-colors cursor-pointer"
        >
          <History className="h-3.5 w-3.5 text-brand" />
          Past runs
        </button>

        {/* Test Run Drawer Button */}
        <button
          type="button"
          data-testid="open-test-run-btn"
          onClick={onOpenTestRun}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted text-xs font-semibold text-ink shadow-xs transition-colors cursor-pointer"
        >
          <Play className="h-3.5 w-3.5 text-brand fill-brand" />
          Try it
        </button>

        {/* Save Workflow Button */}
        <button
          type="button"
          data-testid="save-workflow-btn"
          disabled={isSaving || !!saveBlockedReason}
          title={saveBlockedReason ?? undefined}
          onClick={onSave}
          className={clsx(
            'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
            isDirty
              ? 'bg-brand text-on-brand hover:bg-brand-hover active:scale-95'
              : 'border border-border bg-surface text-ink-muted hover:bg-surface-muted',
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? 'Saving…' : isDirty ? (autosave && !saveBlockedReason ? 'Saving soon…' : 'Save changes') : 'Saved'}
        </button>
      </div>
      </div>
      {/* On its own line: beside the buttons it squeezed the name and the undo buttons on a narrow screen. */}
      {workflow?.status === 'ACTIVE' && isDirty && (
        <p data-testid="owner-warning" className="pb-1.5 text-right text-[11px] text-ink-muted leading-tight">
          This automation is on, so changes wait for you to save. Saving makes you its owner: steps run with your permissions.
        </p>
      )}
    </header>
  );
}
