'use client';

import React, { useState } from 'react';
import { X, History } from 'lucide-react';
import clsx from 'clsx';
import { executionStatusLabel, triggerSourceLabel } from '@saas/shared';
import type { AutomationExecutionStatus } from '@saas/shared';
import { useAutomationExecutionsPage } from '@/hooks/use-automations';
import { formatRelative } from '@/lib/utils';
import { RunDetail, StatusChip, formatDuration, formatTime } from './run-detail';

const FILTERS: { label: string; status: AutomationExecutionStatus | null }[] = [
  { label: 'All', status: null },
  { label: executionStatusLabel('FAILED'), status: 'FAILED' },
  { label: executionStatusLabel('WAITING_APPROVAL'), status: 'WAITING_APPROVAL' },
  { label: executionStatusLabel('COMPLETED'), status: 'COMPLETED' },
];

export interface RunsDrawerProps {
  workflowId: string;
  onClose: () => void;
  className?: string;
}

export function RunsDrawer({ workflowId, onClose, className }: RunsDrawerProps) {
  const [status, setStatus] = useState<AutomationExecutionStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const runs = useAutomationExecutionsPage(workflowId, status);
  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <aside
      data-testid="runs-drawer"
      className={clsx(
        'w-[440px] border-l border-border bg-surface shadow-2xl flex flex-col h-full z-40 select-text',
        className,
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-border/40 bg-surface-muted/50">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-on-brand font-bold">
            <History className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-ink">Runs</h3>
            <p className="text-[10px] text-ink-muted">Every run of this automation, step by step</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="close-runs-drawer-btn"
          onClick={onClose}
          className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {selectedId ? (
          <RunDetail executionId={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter runs by status">
              {FILTERS.map((filter) => (
                <button
                  key={filter.label}
                  type="button"
                  aria-pressed={status === filter.status}
                  onClick={() => setStatus(filter.status)}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer',
                    status === filter.status
                      ? 'border-brand bg-brand-soft/60 text-ink'
                      : 'border-border bg-surface text-ink-muted hover:bg-surface-muted',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {runs.isLoading && <p className="text-xs text-ink-muted">Loading runs...</p>}
            {runs.isError && (
              <p role="alert" className="text-xs text-danger">
                Couldn&apos;t load runs.
              </p>
            )}
            {!runs.isLoading && !runs.isError && items.length === 0 && (
              <p className="text-xs text-ink-muted">No runs yet.</p>
            )}

            <ul className="space-y-1.5">
              {items.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    data-testid="run-row"
                    onClick={() => setSelectedId(run.id)}
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-lg border border-border bg-surface-muted hover:bg-surface text-left text-xs cursor-pointer"
                  >
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-ink" title={formatTime(run.startedAt)}>
                        {formatRelative(run.startedAt)}
                      </span>
                      <span className="text-[10px] text-ink-muted">
                        {triggerSourceLabel(run.triggerSource)}
                        {run.finishedAt && (
                          <span data-testid="run-duration">
                            {' · '}
                            {formatDuration(
                              Date.parse(run.finishedAt) - Date.parse(run.startedAt),
                            )}
                          </span>
                        )}
                      </span>
                      {run.errorMessage && (
                        <span className="text-[10px] text-danger truncate">{run.errorMessage}</span>
                      )}
                    </span>
                    <StatusChip status={run.status} />
                  </button>
                </li>
              ))}
            </ul>

            {runs.hasNextPage && (
              <button
                type="button"
                disabled={runs.isFetchingNextPage}
                onClick={() => runs.fetchNextPage()}
                className="w-full py-2 rounded-lg border border-border text-xs font-semibold text-ink hover:bg-surface-muted cursor-pointer disabled:opacity-60"
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
