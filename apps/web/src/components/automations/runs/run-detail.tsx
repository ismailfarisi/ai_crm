'use client';

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { executionStatusLabel, triggerSourceLabel } from '@saas/shared';
import type { AutomationExecutionStatus } from '@saas/shared';
import { useAutomationExecution } from '@/hooks/use-automations';
import { ApprovalDecision } from './approval-decision';

export function StatusChip({ status }: { status: AutomationExecutionStatus }) {
  return (
    <span
      data-testid="run-status-chip"
      className={clsx(
        'px-2 py-0.5 rounded-md text-[11px] font-semibold shrink-0',
        status === 'COMPLETED' && 'bg-success-soft text-success',
        status === 'RUNNING' && 'bg-info-soft text-info',
        status === 'WAITING_APPROVAL' && 'bg-brand-soft text-ink',
        status === 'FAILED' && 'bg-danger-soft text-danger',
        (status === 'CANCELLED' || status === 'UNKNOWN') && 'bg-surface-muted text-ink-muted',
      )}
    >
      {executionStatusLabel(status)}
    </span>
  );
}

export function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

/** A run's length for people: "450 ms", "1.2 s", "3 min 4 s", "1 h 5 min". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1).replace(/\.0$/, '')} s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="p-2 rounded-lg bg-surface-muted text-ink font-mono text-[11px] overflow-x-auto max-h-56 border border-border-strong">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const HIDDEN_COPY = "You can't see the data in this run.";

export interface RunDetailProps {
  executionId: string;
  onBack: () => void;
}

export function RunDetail({ executionId, onBack }: RunDetailProps) {
  const { execution, isLoading } = useAutomationExecution(executionId);

  const back = (
    <button
      type="button"
      data-testid="run-detail-back"
      onClick={onBack}
      className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink cursor-pointer"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      All runs
    </button>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {back}
        <p className="text-xs text-ink-muted">Loading run...</p>
      </div>
    );
  }

  // A failed background poll keeps the run already on screen.
  if (!execution) {
    return (
      <div className="space-y-3">
        {back}
        <p role="alert" className="text-xs text-danger">
          Couldn&apos;t load this run.
        </p>
      </div>
    );
  }

  const steps = Object.entries(execution.nodeResults ?? {})
    .map(([nodeId, step]) => ({ nodeId, ...step }))
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  return (
    <div data-testid="run-detail" className="space-y-4">
      {back}

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <StatusChip status={execution.status} />
          <span className="text-xs text-ink-muted">{triggerSourceLabel(execution.triggerSource)}</span>
        </div>
        <p className="text-[11px] text-ink-muted">
          Started {formatTime(execution.startedAt)} · Finished {formatTime(execution.finishedAt)}
        </p>
        {execution.errorMessage && (
          <p role="alert" className="text-xs text-danger break-words">
            {execution.errorMessage}
          </p>
        )}
      </div>

      {(execution.pendingApprovals ?? []).map((approval) => (
        <ApprovalDecision
          key={approval.id}
          approval={approval}
          // The run refetches once decided and the card goes with it, so a
          // lost race is told in a toast that outlives the card.
          onDecided={(result) => {
            if (result.conflict) toast.info(result.conflict);
          }}
        />
      ))}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-ink">What started this run</p>
        {execution.dataHidden ? (
          <p className="text-xs text-ink-muted">{HIDDEN_COPY}</p>
        ) : (
          <details>
            <summary className="text-[11px] text-ink-muted cursor-pointer">Trigger payload</summary>
            <JsonBlock value={execution.triggerPayload} />
          </details>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-ink">Steps</p>
        {steps.length === 0 && execution.status === 'UNKNOWN' && (
          <p className="text-xs text-ink-muted">Details weren&apos;t recorded for this run.</p>
        )}
        <ol className="space-y-1.5">
          {steps.map((step) => (
            <li
              key={step.nodeId}
              data-testid="run-step"
              className="rounded-lg border border-border bg-surface-muted p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink truncate">
                  {step.label || step.type || step.nodeId}
                </span>
                <span className="text-[11px] font-mono text-ink-subtle shrink-0">
                  {step.durationMs !== undefined ? `${step.durationMs}ms` : ''}
                </span>
              </div>
              <p className="text-[11px] text-ink-muted">
                {step.type ?? '—'} · {step.status}
              </p>
              {step.error && <p className="text-[11px] text-danger break-words">{step.error}</p>}
              {!execution.dataHidden && (step.input !== undefined || step.output !== undefined) && (
                <details className="mt-1">
                  <summary className="text-[11px] text-ink-muted cursor-pointer">Input / Output</summary>
                  {step.input !== undefined && (
                    <>
                      <p className="text-[11px] font-semibold text-ink-muted mt-1">Input</p>
                      <JsonBlock value={step.input} />
                    </>
                  )}
                  {step.output !== undefined && (
                    <>
                      <p className="text-[11px] font-semibold text-ink-muted mt-1">Output</p>
                      <JsonBlock value={step.output} />
                    </>
                  )}
                </details>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
