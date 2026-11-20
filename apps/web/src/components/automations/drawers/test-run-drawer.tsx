'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Layers,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationWorkflowDto, AutomationExecutionDto, AutomationNode } from '@saas/shared';
import { findCrmEvent } from '../crm-events';
import { eventFieldsFor, sampleDataFor, sampleTriggerFor } from '../event-data';
import { plainStepName } from '../step-wording';

export interface TestRunDrawerProps {
  workflow: AutomationWorkflowDto | null;
  /** The event that starts the automation; the sample data is that event's. */
  triggerEvent?: string | null;
  /** The steps on the canvas, to show results under their names. */
  nodes?: AutomationNode[];
  onExecuteTest: (payload: Record<string, any>) => Promise<AutomationExecutionDto | null>;
  onGetExecution?: (executionId: string) => Promise<AutomationExecutionDto>;
  onClose: () => void;
  className?: string;
}

const RUN_STATUS_WORDS: Record<string, string> = {
  COMPLETED: 'Finished',
  RUNNING: 'Running…',
  WAITING_APPROVAL: 'Waiting for approval',
  FAILED: 'Failed',
  CANCELLED: 'Stopped',
};

/** "0.4 s", "12 s", "3 min". */
function formatTook(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** The agent action a WAITING step is paused on, if any. */
function pendingActionOf(step: { output?: unknown }): unknown {
  const output = step.output as { pendingAction?: unknown } | null | undefined;
  return output?.pendingAction;
}

export function TestRunDrawer({
  workflow,
  triggerEvent = null,
  nodes,
  onExecuteTest,
  onGetExecution,
  onClose,
  className,
}: TestRunDrawerProps) {
  const fields = eventFieldsFor(triggerEvent);
  // The sample values, by field. Reset whenever another event is chosen.
  const [sample, setSample] = useState<Record<string, string | number>>(() => sampleDataFor(triggerEvent));
  // Set while the data is being edited as JSON instead of in the form.
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [sampleEvent, setSampleEvent] = useState(triggerEvent);
  if (sampleEvent !== triggerEvent) {
    setSampleEvent(triggerEvent);
    setSample(sampleDataFor(triggerEvent));
    setRawJson(null);
  }
  const stepNames = new Map((nodes ?? []).map((n) => [n.id, plainStepName(n.type, n.data?.label)]));
  const nameOf = (nodeId: string) => stepNames.get(nodeId) ?? nodeId;

  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<AutomationExecutionDto | null>(null);
  const [selectedNodeResultKey, setSelectedNodeResultKey] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !executionResult ||
      executionResult.status !== 'RUNNING' ||
      !onGetExecution
    ) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const latest = await onGetExecution(executionResult.id);
        if (cancelled) return;
        setPollingError(null);
        setExecutionResult(latest);
        if (latest.status === 'WAITING_APPROVAL') {
          const waitingNodeId = Object.keys(latest.nodeResults).find(
            (nodeId) => latest.nodeResults[nodeId].status === 'WAITING',
          );
          if (waitingNodeId) setSelectedNodeResultKey(waitingNodeId);
        }
      } catch (error) {
        if (!cancelled) {
          clearInterval(interval);
          setPollingError(
            error instanceof Error
              ? error.message
              : 'Could not check on the test. Close this panel and open Past runs to see it.',
          );
        }
      } finally {
        inFlight = false;
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [executionResult, onGetExecution]);

  const handleRun = async () => {
    // The same shape a real event arrives in, so `$trigger.payload.…` reads
    // the same in a test as in a real run.
    let payload: Record<string, unknown> = sampleTriggerFor(triggerEvent, sample);
    if (rawJson !== null) {
      try {
        payload = JSON.parse(rawJson);
        setJsonError(null);
      } catch {
        setJsonError('This isn’t valid JSON yet. Fix it, or go back to the form.');
        return;
      }
    }

    setIsRunning(true);
    setPollingError(null);
    try {
      const res = await onExecuteTest(payload);
      setExecutionResult(res);
      if (res?.nodeResults && Object.keys(res.nodeResults).length > 0) {
        setSelectedNodeResultKey(Object.keys(res.nodeResults)[0]);
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <aside
      data-testid="test-run-drawer"
      className={clsx(
        'w-[440px] border-l border-border bg-surface shadow-2xl flex flex-col h-full z-40 select-text',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/40 bg-surface-muted/50">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-ink font-semibold">
            <Play className="h-4 w-4 fill-surface" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-ink">Try it out</h3>
            <p className="text-[11px] text-ink-muted">Runs every step once with sample data, for real</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="close-test-drawer-btn"
          aria-label="Close"
          onClick={onClose}
          className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Sample data: a form of the event's fields, or JSON for those who want it */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink">
              {findCrmEvent(triggerEvent) ? `Sample: ${findCrmEvent(triggerEvent)?.label}` : 'Sample data'}
            </span>
            <button
              type="button"
              data-testid="toggle-test-json-btn"
              onClick={() => {
                setJsonError(null);
                setRawJson(rawJson === null ? JSON.stringify(sampleTriggerFor(triggerEvent, sample), null, 2) : null);
              }}
              className="text-[11px] text-ink-muted hover:underline cursor-pointer"
            >
              {rawJson === null ? 'Edit as JSON' : 'Back to the form'}
            </button>
          </div>

          {rawJson !== null ? (
            <textarea
              rows={10}
              data-testid="test-payload-input"
              aria-label="Sample data as JSON"
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              className="w-full rounded-lg border border-border p-2.5 font-mono text-[11px] text-ink bg-surface-muted focus:bg-surface focus:border-brand focus:outline-none resize-none leading-relaxed"
            />
          ) : fields.length > 0 ? (
            <div data-testid="test-sample-form" className="space-y-1.5 rounded-lg border border-border bg-surface-muted/40 p-2.5">
              {fields.map((field) => (
                <label key={field.key} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-[11px] text-ink-muted">
                  <span className="truncate">{field.label}</span>
                  <input
                    data-testid={`test-sample-${field.key}`}
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={sample[field.key] ?? ''}
                    onChange={(e) =>
                      setSample((prev) => ({
                        ...prev,
                        [field.key]:
                          field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                  />
                </label>
              ))}
            </div>
          ) : (
            <p data-testid="test-sample-none" className="rounded-lg bg-surface-muted px-2.5 py-2 text-[11px] text-ink-muted">
              This automation doesn’t start from a Kerf event, so there is no sample data to fill in.
            </p>
          )}
          {jsonError && (
            <p role="alert" className="text-[11px] text-danger">
              {jsonError}
            </p>
          )}
          <p className="text-[11px] text-ink-subtle">
            A test does what the steps say: emails are sent and records are changed. Waits are not shortened.
          </p>
        </div>

        {/* Action Button */}
        <button
          type="button"
          data-testid="execute-test-btn"
          disabled={isRunning}
          onClick={handleRun}
          className={clsx(
            'w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-on-brand shadow-sm flex items-center justify-center gap-2 transition cursor-pointer',
            isRunning
              ? 'bg-brand cursor-not-allowed'
              : 'bg-brand hover:bg-brand-hover active:scale-[0.99]',
          )}
        >
          {isRunning ? (
            <>
              <RotateCcw className="h-3.5 w-3.5 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-current" />
              Run a test
            </>
          )}
        </button>

        {/* Execution Results View */}
        {executionResult && (
          <div data-testid="execution-result-section" className="space-y-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">What happened</span>
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-md text-[11px] font-semibold',
                  executionResult.status === 'COMPLETED' && 'bg-success-soft text-success',
                  executionResult.status === 'RUNNING' && 'bg-info-soft text-info',
                  executionResult.status === 'WAITING_APPROVAL' && 'bg-brand-soft text-ink',
                  executionResult.status === 'FAILED' && 'bg-danger-soft text-danger',
                )}
              >
                {RUN_STATUS_WORDS[executionResult.status] ?? executionResult.status}
              </span>
            </div>

            {/* Step-by-Step Node Results Timeline */}
            {executionResult.status === 'WAITING_APPROVAL' &&
              Object.values(executionResult.nodeResults).some(
                (result) =>
                  result.status === 'WAITING' &&
                  pendingActionOf(result),
              ) && (
                <div
                  data-testid="pending-agent-approval"
                  className="rounded-lg border border-brand/40 bg-brand-soft/40 p-3 space-y-1.5"
                >
                  <p className="text-xs font-semibold text-ink">
                    Waiting for someone to approve
                  </p>
                  <pre className="text-[11px] text-ink-muted font-mono whitespace-pre-wrap break-words">
                    {JSON.stringify(
                      pendingActionOf(
                        Object.values(executionResult.nodeResults).find(
                          (result) =>
                            result.status === 'WAITING' && pendingActionOf(result),
                        )!,
                      ),
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}
            {pollingError && (
              <p role="alert" className="text-xs text-danger">
                {pollingError}
              </p>
            )}

            {/* Step-by-Step Node Results Timeline */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-ink-muted">Steps</span>
              <div className="space-y-1.5">
                {Object.entries(executionResult.nodeResults || {}).map(([nodeId, res]) => (
                  <button
                    key={nodeId}
                    type="button"
                    data-testid={`step-trace-${nodeId}`}
                    onClick={() => setSelectedNodeResultKey(nodeId)}
                    className={clsx(
                      'w-full flex items-center justify-between p-2 rounded-lg border text-left text-xs transition cursor-pointer',
                      selectedNodeResultKey === nodeId
                        ? 'border-brand bg-brand-soft/60 font-semibold'
                        : 'border-border bg-surface-muted hover:bg-surface-muted',
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {res.status === 'SUCCESS' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                      ) : res.status === 'WAITING' ? (
                        <Clock className="h-3.5 w-3.5 text-brand shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
                      )}
                      <span className="truncate">{nameOf(nodeId)}</span>
                    </div>
                    <span className="text-[11px] font-mono text-ink-subtle shrink-0">
                      {res.durationMs !== undefined ? formatTook(res.durationMs) : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Node Details */}
            {selectedNodeResultKey && executionResult.nodeResults?.[selectedNodeResultKey] && (
              <div className="space-y-2 pt-2">
                <label className="text-[11px] font-semibold text-ink flex items-center gap-1">
                  <Terminal className="h-3 w-3 text-ink-muted" />
                  Result of: {nameOf(selectedNodeResultKey)}
                </label>
                <pre
                  data-testid="selected-node-output-json"
                  className="p-2.5 rounded-lg bg-surface-muted text-ink font-mono text-[11px] overflow-x-auto max-h-56 border border-border-strong"
                >
                  {JSON.stringify(
                    executionResult.nodeResults[selectedNodeResultKey].output ||
                      executionResult.nodeResults[selectedNodeResultKey].input ||
                      executionResult.nodeResults[selectedNodeResultKey],
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
